import argparse
import json
import os
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image
from tqdm import tqdm

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
        if not SAM_AVAILABLE:
            print("Warning: segment_anything not found.")
            return
        if not os.path.exists(checkpoint):
            print(f"[*] Downloading {checkpoint}...")
            torch.hub.download_url_to_file(
                f"https://dl.fbaipublicfiles.com/segment_anything/{checkpoint}",
                checkpoint,
            )
        print(f"Loading SAM model ({model_type}) on {self.device}...")
        sam = sam_model_registry[model_type](checkpoint=checkpoint)
        sam.to(device=self.device)
        self.mask_generator = SamAutomaticMaskGenerator(
            model=sam,
            points_per_side=32,
            pred_iou_thresh=0.88,
            stability_score_thresh=0.95,
            crop_n_layers=1,
            crop_n_points_downscale_factor=2,
            min_mask_region_area=200,
        )

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
        except Exception as exc:
            print(f"Failed to load ZoeDepth: {exc}. Falling back to MiDaS.")
            self.model = torch.hub.load("intel-isl/MiDaS", "DPT_Large").to(self.device).eval()

    def estimate(self, image_pil):
        with torch.no_grad():
            if hasattr(self.model, "infer_pil"):
                depth = self.model.infer_pil(image_pil)
            else:
                img_np = np.array(image_pil)
                img_tensor = (
                    torch.from_numpy(img_np)
                    .permute(2, 0, 1)
                    .unsqueeze(0)
                    .float()
                    .to(self.device)
                    / 255.0
                )
                depth = self.model(img_tensor).squeeze().cpu().numpy()
        d_min, d_max = float(depth.min()), float(depth.max())
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
            self.model = AutoModel.from_pretrained(model_name).to(self.device).eval()

    def extract(self, image_pil):
        if self.model is None or self.processor is None:
            return np.zeros(384, dtype=np.float32)
        inputs = self.processor(images=image_pil, return_tensors="pt").to(self.device)
        with torch.no_grad():
            outputs = self.model(**inputs)
        return outputs.last_hidden_state.mean(dim=1).cpu().numpy().flatten().astype(np.float32)


class PareidoliaGraphBuilder:
    def __init__(self):
        self.nodes = []
        self.node_shards = {}

    def add_node(self, node_id, metadata, shards):
        self.nodes.append({"id": node_id, **metadata})
        self.node_shards[node_id] = shards

    def build(self, threshold=0.82):
        print("\n[*] Building Pareidolia Graph...")
        edges = []
        node_ids = list(self.node_shards)
        for src_id in node_ids:
            for tgt_id in node_ids:
                if src_id == tgt_id:
                    continue
                src_shards = self.node_shards[src_id]
                tgt_shards = self.node_shards[tgt_id]
                if not src_shards or not tgt_shards:
                    continue
                src_embs = np.asarray([s["embedding"] for s in src_shards], dtype=np.float32)
                tgt_embs = np.asarray([s["embedding"] for s in tgt_shards], dtype=np.float32)
                src_embs /= np.linalg.norm(src_embs, axis=1, keepdims=True) + 1e-8
                tgt_embs /= np.linalg.norm(tgt_embs, axis=1, keepdims=True) + 1e-8
                sims = src_embs @ tgt_embs.T
                best_idx = np.unravel_index(np.argmax(sims), sims.shape)
                best_score = float(sims[best_idx])
                if best_score <= threshold:
                    continue
                s_shard = src_shards[best_idx[0]]
                t_shard = tgt_shards[best_idx[1]]
                edges.append({
                    "source": src_id,
                    "target": tgt_id,
                    "source_shard": int(best_idx[0]),
                    "target_shard": int(best_idx[1]),
                    "s_nx": s_shard.get("nx", 0),
                    "s_ny": s_shard.get("ny", 0),
                    "s_depth": s_shard.get("depth", 0),
                    "t_nx": t_shard.get("nx", 0),
                    "t_ny": t_shard.get("ny", 0),
                    "t_depth": t_shard.get("depth", 0),
                    "weight": best_score,
                })
        pruned = []
        for node_id in node_ids:
            outgoing = [edge for edge in edges if edge["source"] == node_id]
            outgoing.sort(key=lambda edge: edge["weight"], reverse=True)
            pruned.extend(outgoing[:2])
        return {"nodes": self.nodes, "edges": pruned}


def main():
    parser = argparse.ArgumentParser(description="Build semantic SAM/depth/DINO shard data.")
    parser.add_argument("--input", default="public/assets", help="source image directory")
    parser.add_argument("--output", default="public/data", help="output data directory")
    parser.add_argument("--checkpoint", default="sam_vit_b_01ec64.pth")
    parser.add_argument("--device", choices=("cuda", "cpu"), default=None)
    parser.add_argument("--limit", type=int, default=0, help="0 processes every image")
    args = parser.parse_args()

    in_dir = Path(args.input)
    out_dir = Path(args.output)
    if not in_dir.is_dir():
        raise SystemExit(f"Input directory does not exist: {in_dir}")
    out_dir.mkdir(parents=True, exist_ok=True)

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    segmenter = Segmenter(checkpoint=args.checkpoint, device=device)
    depth_engine = DepthEstimator(device=device)
    feature_engine = FeatureExtractor(device=device)
    graph_builder = PareidoliaGraphBuilder()

    extensions = {".jpg", ".jpeg", ".png", ".webp"}
    images = sorted(path for path in in_dir.iterdir() if path.suffix.lower() in extensions)
    if args.limit > 0:
        images = images[:args.limit]
    if not images:
        raise SystemExit(f"No supported images found in {in_dir}")

    failures = 0
    for img_path in tqdm(images, desc="Processing Art"):
        try:
            image_id = img_path.stem
            img_pil = Image.open(img_path).convert("RGB")
            img_np = np.array(img_pil)
            h, w = img_np.shape[:2]
            masks = segmenter.segment(img_np)
            depth_map = depth_engine.estimate(img_pil)
            if depth_map.shape != (h, w):
                depth_map = cv2.resize(depth_map, (w, h))

            shards = []
            for i, mask_data in enumerate(masks):
                bbox = [int(v) for v in mask_data["bbox"]]
                x, y, sw, sh = bbox
                mask = mask_data["segmentation"]
                avg_depth = float(np.mean(depth_map[mask]))
                shard_crop = img_pil.crop((x, y, x + sw, y + sh))
                embedding = feature_engine.extract(shard_crop)
                nx = (x + sw / 2) / w - 0.5
                ny = -((y + sh / 2) / h - 0.5)
                shards.append({
                    "id": i,
                    "bbox": bbox,
                    "depth": avg_depth,
                    "embedding": embedding,
                    "area": float(mask_data["area"]),
                    "nx": float(nx),
                    "ny": float(ny),
                })

            num_shards = len(shards)
            bin_pos = np.zeros((num_shards, 3), dtype=np.float32)
            bin_uv = np.zeros((num_shards, 4), dtype=np.float32)
            bin_scale = np.zeros((num_shards, 1), dtype=np.float32)
            aspect = w / h
            world_h = 10.0
            world_w = world_h * aspect

            for i, shard in enumerate(shards):
                x, y, sw, sh = shard["bbox"]
                bin_pos[i] = [shard["nx"] * world_w, shard["ny"] * world_h, shard["depth"] * 2.0]
                bin_uv[i] = [x / w, y / h, sw / w, sh / h]
                bin_scale[i] = [sw / w * world_w]

            bin_pos.tofile(out_dir / f"{image_id}_pos.bin")
            bin_uv.tofile(out_dir / f"{image_id}_uv.bin")
            bin_scale.tofile(out_dir / f"{image_id}_scale.bin")

            clean_shards = []
            for shard in shards:
                clean = shard.copy()
                del clean["embedding"]
                clean_shards.append(clean)
            with (out_dir / f"{image_id}.json").open("w", encoding="utf-8") as handle:
                json.dump({"id": image_id, "shards": clean_shards, "res": [w, h]}, handle)
            graph_builder.add_node(image_id, {"file": img_path.name}, shards)
        except Exception as exc:
            failures += 1
            print(f"[!] Failed {img_path.name}: {exc}")

    graph = graph_builder.build()
    with (out_dir.parent / "graph.json").open("w", encoding="utf-8") as handle:
        json.dump(graph, handle, indent=2)

    print(f"\n[+] Pipeline complete. Assets saved to {out_dir}; failures={failures}")
    if failures == len(images):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
