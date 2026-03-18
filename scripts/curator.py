import argparse
import os
import json
import numpy as np
import cv2
import torch
import shutil
import urllib.request
from pathlib import Path
from PIL import Image
from scipy.spatial.distance import cdist
from tqdm import tqdm

# Try to import dependencies
try:
    from segment_anything import sam_model_registry, SamAutomaticMaskGenerator
    SAM_AVAILABLE = True
except ImportError:
    SAM_AVAILABLE = False

try:
    from transformers import AutoImageProcessor, AutoModel
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False


class Segmenter:
    def __init__(self, model_type="vit_b", checkpoint="sam_vit_b_01ec64.pth", device="cuda"):
        self.device = device if torch.cuda.is_available() else "cpu"
        self.mask_generator = None
        
        if SAM_AVAILABLE:
            if not os.path.exists(checkpoint):
                print(f"[*] Downloading {checkpoint}...")
                torch.hub.download_url_to_file(
                    f"https://dl.fbaipublicfiles.com/segment_anything/{checkpoint}",
                    checkpoint
                )
            
            print(f"Loading SAM model ({model_type}) on {self.device}...")
            sam = sam_model_registry[model_type](checkpoint=checkpoint)
            sam.to(device=self.device)
            
            # THE "STROKE" SETTINGS
            self.mask_generator = SamAutomaticMaskGenerator(
                model=sam,
                points_per_side=32,
                pred_iou_thresh=0.88,
                stability_score_thresh=0.95,
                crop_n_layers=1,
                crop_n_points_downscale_factor=2,
                min_mask_region_area=200, # Avoid tiny noise
            )
        else:
            print("Warning: segment_anything not found.")

    def segment(self, image):
        if not self.mask_generator:
            return []
        return self.mask_generator.generate(image)


class DepthEstimator:
    def __init__(self, device="cuda"):
        self.device = device if torch.cuda.is_available() else "cpu"
        print(f"Loading ZoeDepth on {self.device}...")
        try:
            self.model = torch.hub.load("isl-org/ZoeDepth", "ZoeD_N", pretrained=True).to(self.device).eval()
        except Exception as e:
            print(f"Failed to load ZoeDepth: {e}. Falling back to MiDaS.")
            self.model = torch.hub.load("intel-isl/MiDaS", "DPT_Large").to(self.device).eval()

    def estimate(self, image_pil):
        if self.model is None:
            return None
        with torch.no_grad():
            # ZoeDepth has a direct infer_pil method
            if hasattr(self.model, 'infer_pil'):
                depth = self.model.infer_pil(image_pil)
            else:
                # Fallback for MiDaS or other models
                img_np = np.array(image_pil)
                img_tensor = torch.from_numpy(img_np).permute(2, 0, 1).unsqueeze(0).float().to(self.device) / 255.0
                depth = self.model(img_tensor).squeeze().cpu().numpy()
        
        # Normalize 0-1
        d_min, d_max = depth.min(), depth.max()
        if d_max > d_min:
            depth = (depth - d_min) / (d_max - d_min)
        return depth


class FeatureExtractor:
    def __init__(self, model_name="facebook/dinov2-small", device="cuda"):
        self.device = device if torch.cuda.is_available() else "cpu"
        self.processor = None
        self.model = None
        
        if TRANSFORMERS_AVAILABLE:
            print(f"Loading DINOv2 ({model_name}) on {self.device}...")
            self.processor = AutoImageProcessor.from_pretrained(model_name)
            self.model = AutoModel.from_pretrained(model_name).to(self.device)

    def extract(self, image_pil):
        if self.model is None or self.processor is None:
            return np.zeros(384) # DINOv2-small dimension
        
        inputs = self.processor(images=image_pil, return_tensors="pt").to(self.device)
        with torch.no_grad():
            outputs = self.model(**inputs)
        return outputs.last_hidden_state.mean(dim=1).cpu().numpy().flatten()


class PareidoliaGraphBuilder:
    def __init__(self):
        self.nodes = []
        self.node_shards = {} # id -> [shards]

    def add_node(self, node_id, metadata, shards):
        self.nodes.append({"id": node_id, **metadata})
        self.node_shards[node_id] = shards

    def build(self, threshold=0.82):
        print("\n[*] Building Pareidolia Graph...")
        edges = []
        node_ids = list(self.node_shards.keys())
        
        # Collect all "semantic" shards (large or specifically flagged)
        # For simplicity, we compare all shards from Node A to all from Node B
        # But we prioritize matches where "abstract" matches "meaningful"
        
        for i, src_id in enumerate(node_ids):
            for j, tgt_id in enumerate(node_ids):
                if i == j: continue
                
                src_shards = self.node_shards[src_id]
                tgt_shards = self.node_shards[tgt_id]
                
                # Extract embeddings
                src_embs = np.array([s['embedding'] for s in src_shards])
                tgt_embs = np.array([s['embedding'] for s in tgt_shards])
                
                # Normalize embs for Cosine Similarity
                src_embs /= np.linalg.norm(src_embs, axis=1, keepdims=True) + 1e-8
                tgt_embs /= np.linalg.norm(tgt_embs, axis=1, keepdims=True) + 1e-8
                
                # Similarity Matrix
                sims = np.dot(src_embs, tgt_embs.T)
                
                # Find the best shard-to-shard match
                best_idx = np.unravel_index(np.argmax(sims), sims.shape)
                best_score = float(sims[best_idx])
                
                if best_score > threshold:
                    edges.append({
                        "source": src_id,
                        "target": tgt_id,
                        "source_shard": int(best_idx[0]),
                        "target_shard": int(best_idx[1]),
                        "weight": best_score
                    })
        
        # Prune: Keep only the best outgoing edge per node for a clean path, 
        # or top 3 for branching. Let's do top 2.
        pruned_edges = []
        for nid in node_ids:
            node_edges = [e for e in edges if e['source'] == nid]
            node_edges.sort(key=lambda x: x['weight'], reverse=True)
            pruned_edges.extend(node_edges[:2])
            
        return {"nodes": self.nodes, "edges": pruned_edges}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="assets/raw")
    parser.add_argument("--output", default="public/data")
    parser.add_argument("--checkpoint", default="sam_vit_b_01ec64.pth")
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    # Initialize
    segmenter = Segmenter(checkpoint=args.checkpoint, device=device)
    depth_engine = DepthEstimator(device=device)
    feature_engine = FeatureExtractor(device=device)
    graph_builder = PareidoliaGraphBuilder()

    in_dir = Path(args.input)
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    images = sorted([f for f in in_dir.iterdir() if f.suffix.lower() in ['.jpg', '.png', '.webp']])
    
    for img_path in tqdm(images, desc="Processing Art"):
        image_id = img_path.stem
        img_pil = Image.open(img_path).convert("RGB")
        img_np = np.array(img_pil)
        h, w = img_np.shape[:2]

        # 1. Segment
        masks = segmenter.segment(img_np)
        
        # 2. Depth
        depth_map = depth_engine.estimate(img_pil)
        if depth_map.shape != (h, w):
            depth_map = cv2.resize(depth_map, (w, h))

        shards = []
        for i, m in enumerate(masks):
            # Extract Shard Details
            bbox = [int(v) for v in m['bbox']]
            x, y, sw, sh = bbox
            
            mask = m['segmentation']
            avg_depth = np.mean(depth_map[mask])
            
            # Feature Extraction (Crop and process)
            shard_crop = img_pil.crop((x, y, x+sw, y+sh))
            emb = feature_engine.extract(shard_crop)
            
            shards.append({
                "id": i,
                "bbox": bbox,
                "depth": float(avg_depth),
                "embedding": emb,
                "area": float(m['area'])
            })

        # --- Binary Packaging ---
        num_shards = len(shards)
        bin_pos = np.zeros((num_shards, 3), dtype=np.float32)
        bin_uv = np.zeros((num_shards, 4), dtype=np.float32)
        bin_scale = np.zeros((num_shards, 1), dtype=np.float32)
        
        aspect = w / h
        world_h = 10.0
        world_w = world_h * aspect

        for i, s in enumerate(shards):
            x, y, sw, sh = s['bbox']
            # Normalized Pos (-0.5 to 0.5)
            nx = (x + sw/2) / w - 0.5
            ny = -((y + sh/2) / h - 0.5)
            
            bin_pos[i] = [nx * world_w, ny * world_h, s['depth'] * 2.0]
            bin_uv[i] = [x/w, y/h, sw/w, sh/h]
            bin_scale[i] = [sw/w * world_w]

        # Save Binary
        bin_pos.tofile(out_dir / f"{image_id}_pos.bin")
        bin_uv.tofile(out_dir / f"{image_id}_uv.bin")
        bin_scale.tofile(out_dir / f"{image_id}_scale.bin")

        # Save JSON (no embeddings)
        clean_shards = []
        for s in shards:
            sc = s.copy()
            del sc['embedding']
            clean_shards.append(sc)
            
        with open(out_dir / f"{image_id}.json", 'w') as f:
            json.dump({"id": image_id, "shards": clean_shards, "res": [w, h]}, f)
            
        # Add to graph
        graph_builder.add_node(image_id, {"file": img_path.name}, shards)

    # Build and Save Graph
    graph = graph_builder.build()
    with open(out_dir.parent / "graph.json", 'w') as f:
        json.dump(graph, f, indent=2)

    print(f"\n[+] Pipeline Complete. Assets saved to {out_dir}")

if __name__ == "__main__":
    main()
