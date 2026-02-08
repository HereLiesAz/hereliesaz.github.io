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

# Try to import dependencies
try:
    from segment_anything import sam_model_registry, SamAutomaticMaskGenerator
    SAM_AVAILABLE = True
except ImportError:
    SAM_AVAILABLE = False
    print("Warning: segment_anything not found. Please install it.")

try:
    # ZoeDepth might be imported differently depending on installation
    from zoedepth.models.builder import build_model
    from zoedepth.utils.config import get_config
    ZOEDEPTH_AVAILABLE = True
except ImportError:
    ZOEDEPTH_AVAILABLE = False
    # Will try torch.hub as fallback

try:
    from transformers import AutoImageProcessor, AutoModel
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False
    print("Warning: transformers not found. Please install it.")


class Segmenter:
    def __init__(self, model_type="vit_h", checkpoint="sam_vit_h_4b8939.pth", device="cuda"):
        self.device = device if torch.cuda.is_available() else "cpu"
        if SAM_AVAILABLE:
            print(f"Loading SAM model ({model_type}) on {self.device}...")
            if os.path.exists(checkpoint):
                self.sam = sam_model_registry[model_type](checkpoint=checkpoint)
                self.sam.to(device=self.device)
                self.mask_generator = SamAutomaticMaskGenerator(
                    model=self.sam,
                    points_per_side=32,
                    pred_iou_thresh=0.88,
                    stability_score_thresh=0.95,
                    crop_n_layers=1,
                    crop_n_points_downscale_factor=2,
                    min_mask_region_area=100,
                )
            else:
                print(f"Warning: SAM checkpoint {checkpoint} not found. Skipping segmentation.")
                self.mask_generator = None
        else:
            self.mask_generator = None

    def segment(self, image):
        if not self.mask_generator:
            return []
        print("Generating masks...")
        masks = self.mask_generator.generate(image)
        return masks


class DepthEstimator:
    def __init__(self, model_name="ZoeD_N", device="cuda"):
        self.device = device if torch.cuda.is_available() else "cpu"
        self.model = None
        
        print(f"Loading ZoeDepth model ({model_name}) on {self.device}...")
        if ZOEDEPTH_AVAILABLE:
            try:
                conf = get_config(model_name, "infer")
                self.model = build_model(conf).to(self.device)
                self.model.eval()
            except Exception as e:
                print(f"Failed to load ZoeDepth from package: {e}")
        
        if self.model is None:
            try:
                print("Attempting to load ZoeDepth via torch.hub...")
                self.model = torch.hub.load("isl-org/ZoeDepth", model_name, pretrained=True).to(self.device).eval()
                print("Loaded ZoeDepth from torch.hub")
            except Exception as e:
                print(f"Failed to load ZoeDepth from torch.hub: {e}")

    def estimate(self, image_pil):
        if self.model is None:
            return None
        with torch.no_grad():
            depth = self.model.infer_pil(image_pil)
        return depth


class FeatureExtractor:
    def __init__(self, model_name="facebook/dinov2-base", device="cuda"):
        self.device = device if torch.cuda.is_available() else "cpu"
        self.processor = None
        self.model = None
        
        if TRANSFORMERS_AVAILABLE:
            print(f"Loading Feature Extractor ({model_name}) on {self.device}...")
            try:
                self.processor = AutoImageProcessor.from_pretrained(model_name)
                self.model = AutoModel.from_pretrained(model_name).to(self.device)
            except Exception as e:
                print(f"Failed to load Feature Extractor: {e}")

    def extract(self, image):
        """
        image: PIL Image or numpy array
        Returns: feature vector (numpy array)
        """
        if self.model is None or self.processor is None:
            return np.zeros(768) 
        
        inputs = self.processor(images=image, return_tensors="pt").to(self.device)
        with torch.no_grad():
            outputs = self.model(**inputs)
        
        return outputs.last_hidden_state.mean(dim=1).cpu().numpy().flatten()


class PareidoliaDetector:
    def __init__(self):
        self.cascade_file = "haarcascade_frontalface_alt2.xml"
        self.cascade_url = "https://raw.githubusercontent.com/opencv/opencv/master/data/haarcascades/haarcascade_frontalface_alt2.xml"
        self.face_cascade = None
        self._setup()

    def _setup(self):
        if not os.path.exists(self.cascade_file):
            print(f"Downloading Haar Cascade from {self.cascade_url}...")
            try:
                urllib.request.urlretrieve(self.cascade_url, self.cascade_file)
            except Exception as e:
                print(f"Failed to download cascade: {e}")
                return
        
        try:
            self.face_cascade = cv2.CascadeClassifier(self.cascade_file)
        except Exception as e:
            print(f"Failed to load Cascade Classifier: {e}")

    def detect(self, image_np):
        """
        Runs face detection on an image patch.
        Returns: True if face detected, else False.
        """
        if self.face_cascade is None:
            return False
        
        # Convert to gray
        if len(image_np.shape) == 3:
            gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)
        else:
            gray = image_np
            
        faces = self.face_cascade.detectMultiScale(
            gray, 
            scaleFactor=1.05, 
            minNeighbors=3, 
            minSize=(20, 20)
        )
        
        return len(faces) > 0


class GraphBuilder:
    def __init__(self):
        self.nodes = []
        # Store embeddings: { node_id: [ { shard_idx, embedding, is_face } ] }
        self.node_data = {} 

    def add_node(self, image_id, metadata, shards):
        self.nodes.append({"id": image_id, **metadata})
        self.node_data[image_id] = shards

    def build_graph(self, similarity_threshold=0.85):
        edges = []
        node_ids = list(self.node_data.keys())
        
        print(f"Calculating similarity matrix for {len(node_ids)} nodes...")
        
        # We need to compare shards of Node A to shards of Node B.
        # This is expensive (N_nodes * N_shards)^2.
        # Optimization: Only compare "Face" shards to "Non-Face" shards (Pareidolia Fulcrum)
        # OR: Aggregate embeddings? No, we want specific links.
        # Let's collect ALL shards that are either Faces or significantly large/salient.
        
        # For prototype, let's take the "Global" embedding of the image + the embedding of any "Face" shards.
        # Flatten the list: [ (node_id, shard_idx, embedding, is_face) ]
        
        flat_shards = []
        for nid in node_ids:
            # Add global image (shard -1) - we don't have it explicitly stored here, but we could.
            # Let's rely on the shards we passed.
            for s in self.node_data[nid]:
                # Optimization: Only keep faces or large shards to reduce graph density
                # For now, keep faces and maybe random 5 others?
                # Let's keep all faces, and the largest 5 non-faces.
                if s.get('is_face') or s.get('area', 0) > 5000: # Threshold for 'large'
                     flat_shards.append({
                         'node': nid,
                         'shard_idx': s['id'],
                         'embedding': s['embedding'],
                         'is_face': s.get('is_face', False)
                     })
        
        if not flat_shards:
            return {"nodes": self.nodes, "edges": []}

        # Create matrix
        embeddings = np.array([fs['embedding'] for fs in flat_shards])
        
        # Normalize
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms[norms == 0] = 1e-10
        norm_embeddings = embeddings / norms
        
        # Compute similarities (Cosine)
        # 1 - cosine distance = cosine similarity
        dists = cdist(norm_embeddings, norm_embeddings, metric='cosine')
        sims = 1.0 - dists
        
        num_items = len(flat_shards)
        print(f"Comparing {num_items} salient shards...")

        for i in range(num_items):
            for j in range(num_items):
                if i == j: continue
                
                src = flat_shards[i]
                tgt = flat_shards[j]
                
                if src['node'] == tgt['node']: continue # Skip intra-image edges
                
                score = sims[i, j]
                
                # Pareidolia Logic:
                # If Source is a Cloud (not face) and Target IS a Face -> Boost connection!
                # This creates the "Fulcrum" where a cloud looks like a face.
                is_pareidolia = False
                if not src['is_face'] and tgt['is_face']:
                    if score > 0.7: # Lower threshold for pareidolia matches
                        is_pareidolia = True
                        score += 0.2 # Boost
                
                if score > similarity_threshold:
                    edges.append({
                        "source": src['node'],
                        "target": tgt['node'],
                        "source_shard": src['shard_idx'],
                        "target_shard": tgt['shard_idx'],
                        "weight": float(score),
                        "type": "pareidolia" if is_pareidolia else "similarity"
                    })

        # Deduplicate edges (keep best between two nodes)
        # Map (src, tgt) -> max_weight_edge
        best_edges = {}
        for e in edges:
            key = (e['source'], e['target'])
            if key not in best_edges or e['weight'] > best_edges[key]['weight']:
                best_edges[key] = e
        
        final_edges = list(best_edges.values())
        print(f"Generated {len(final_edges)} edges.")
        
        return {"nodes": self.nodes, "edges": final_edges}


def main():
    parser = argparse.ArgumentParser(description="Curator: The Art Processing Pipeline")
    parser.add_argument("--input", type=str, default="assets/raw", help="Input directory")
    parser.add_argument("--output", type=str, default="public/data", help="Output directory")
    parser.add_argument("--device", type=str, default="cuda", help="Device (cuda/cpu)")
    parser.add_argument("--checkpoint", type=str, default="sam_vit_h_4b8939.pth", help="SAM Checkpoint path")
    args = parser.parse_args()

    device = args.device if torch.cuda.is_available() and args.device == "cuda" else "cpu"
    print(f"Running on {device}")

    # Initialize modules
    segmenter = Segmenter(checkpoint=args.checkpoint, device=device)
    depth_estimator = DepthEstimator(device=device)
    feature_extractor = FeatureExtractor(device=device)
    ghost_hunter = PareidoliaDetector()
    graph_builder = GraphBuilder()

    input_dir = Path(args.input)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_dir.exists():
        print(f"Input directory {input_dir} does not exist.")
        return

    image_files = sorted([f for f in input_dir.iterdir() if f.suffix.lower() in ['.jpg', '.jpeg', '.png', '.webp']])
    
    for img_path in image_files:
        print(f"\nProcessing {img_path.name}...")
        image_id = img_path.stem
        
        try:
            image_pil = Image.open(img_path).convert("RGB")
            image_np = np.array(image_pil)
        except Exception as e:
            print(f"Error loading image {img_path}: {e}")
            continue

        # Copy to output
        dest_image_path = output_dir / img_path.name
        if not dest_image_path.exists():
            try:
                shutil.copy2(img_path, dest_image_path)
            except Exception as e:
                print(f"Failed to copy image: {e}")

        # 1. Segmentation
        masks = segmenter.segment(image_np)
        print(f"Found {len(masks)} segments.")

        # 2. Depth Estimation
        depth_map = depth_estimator.estimate(image_pil)
        
        # 3. Process Shards
        shards_data = []
        if masks and depth_map is not None:
             if depth_map.shape != image_np.shape[:2]:
                 depth_map = cv2.resize(depth_map, (image_np.shape[1], image_np.shape[0]))

             for i, mask_data in enumerate(masks):
                 # BBox: [x, y, w, h]
                 x, y, w, h = [int(v) for v in mask_data['bbox']]
                 
                 # Skip tiny shards
                 if w < 10 or h < 10: continue

                 # Crop Shard
                 # We crop the image to the bbox to extract features and check for faces
                 shard_crop = image_np[y:y+h, x:x+w]
                 shard_crop_pil = Image.fromarray(shard_crop)
                 
                 # Feature Extract
                 embedding = feature_extractor.extract(shard_crop_pil)
                 
                 # Face Detect
                 is_face = ghost_hunter.detect(shard_crop)
                 
                 # Average Depth
                 mask = mask_data['segmentation']
                 avg_depth = np.mean(depth_map[mask])
                 
                 # Store info
                 shards_data.append({
                     "id": i,
                     "bbox": [x, y, w, h],
                     "area": float(mask_data['area']),
                     "depth": float(avg_depth),
                     "is_face": bool(is_face),
                     "embedding": embedding # Passed to GraphBuilder, but maybe not saved to JSON to save space?
                 })

        # Save processed data (excluding embeddings to keep JSON light, or include if needed)
        output_file = output_dir / f"{image_id}.json"
        
        resolution = [image_np.shape[1], image_np.shape[0]]
        file_name = img_path.name
        
        # Prepare serializable data
        json_shards = []
        for s in shards_data:
            s_copy = s.copy()
            del s_copy['embedding'] # Remove numpy array
            json_shards.append(s_copy)

        with open(output_file, 'w') as f:
            json.dump({
                "id": image_id,
                "shards": json_shards,
                "resolution": resolution,
                "file": file_name,
            }, f, indent=2)
            
        # Add to graph builder (keep embeddings here)
        graph_builder.add_node(image_id, {
            "processed": True,
            "shard_count": len(shards_data),
            "resolution": resolution,
            "file": file_name 
        }, shards_data)

    # 5. Build Graph
    print("\nBuilding Graph...")
    graph = graph_builder.build_graph()
    
    graph_file = output_dir.parent / "graph.json" 
    with open(graph_file, 'w') as f:
        json.dump(graph, f, indent=2)
    
    print(f"Done. Graph saved to {graph_file}")

if __name__ == "__main__":
    main()
