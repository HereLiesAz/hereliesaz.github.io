import argparse
import os
import json
import numpy as np
import cv2
import torch
from pathlib import Path
from PIL import Image

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
            # We assume the checkpoint needs to be downloaded manually or is already there.
            # For now, we'll try to load it if it exists, otherwise warn.
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
        """
        image: numpy array (H, W, 3)
        Returns: list of masks (dict with 'segmentation', 'area', 'bbox', etc.)
        """
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
        """
        image_pil: PIL Image
        Returns: depth map as numpy array
        """
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
            return np.zeros(768) # Mock dimension
        
        inputs = self.processor(images=image, return_tensors="pt").to(self.device)
        with torch.no_grad():
            outputs = self.model(**inputs)
        
        # Use mean of last hidden state as global descriptor
        # Alternatively use [CLS] token if available
        return outputs.last_hidden_state.mean(dim=1).cpu().numpy().flatten()


class GraphBuilder:
    def __init__(self):
        self.nodes = []
        # We will store embeddings separately to compute distance matrix
        self.embeddings = []
        self.ids = []

    def add_node(self, image_id, metadata, embedding):
        self.nodes.append({"id": image_id, **metadata})
        self.embeddings.append(embedding)
        self.ids.append(image_id)

    def build_graph(self, similarity_threshold=0.85):
        if not self.embeddings:
            return {"nodes": [], "edges": []}
        
        embeddings_matrix = np.array(self.embeddings)
        
        # Normalize embeddings
        norms = np.linalg.norm(embeddings_matrix, axis=1, keepdims=True)
        # Avoid division by zero
        norms[norms == 0] = 1e-10
        normalized_embeddings = embeddings_matrix / norms
        
        # Compute cosine similarity
        similarity_matrix = np.dot(normalized_embeddings, normalized_embeddings.T)
        
        edges = []
        num_nodes = len(self.ids)
        
        for i in range(num_nodes):
            # Self-loop is 1.0, ignore
            # Find top K or threshold
            for j in range(num_nodes):
                if i == j:
                    continue
                score = similarity_matrix[i, j]
                if score > similarity_threshold:
                    edges.append({
                        "source": self.ids[i],
                        "target": self.ids[j],
                        "weight": float(score),
                        "type": "similarity"
                    })
        
        return {"nodes": self.nodes, "edges": edges}


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
        
        # Load Image
        try:
            image_pil = Image.open(img_path).convert("RGB")
            image_np = np.array(image_pil)
        except Exception as e:
            print(f"Error loading image {img_path}: {e}")
            continue

        # 1. Segmentation
        masks = segmenter.segment(image_np)
        print(f"Found {len(masks)} segments.")

        # 2. Depth Estimation
        depth_map = depth_estimator.estimate(image_pil)
        
        # 3. Process Shards (Combine Mask + Depth)
        shards_data = []
        if masks and depth_map is not None:
             # Resize depth map to match image if necessary
             if depth_map.shape != image_np.shape[:2]:
                 depth_map = cv2.resize(depth_map, (image_np.shape[1], image_np.shape[0]))

             for i, mask_data in enumerate(masks):
                 mask = mask_data['segmentation']
                 # Calculate average depth for this shard
                 avg_depth = np.mean(depth_map[mask])
                 
                 # Get bbox
                 x, y, w, h = mask_data['bbox']
                 
                 # Store shard info
                 shards_data.append({
                     "id": i,
                     "bbox": [x, y, w, h],
                     "area": mask_data['area'],
                     "depth": float(avg_depth),
                     # Polygonal approximation could be added here
                 })
        
        # 4. Feature Extraction (Global for now, can be per-shard later)
        embedding = feature_extractor.extract(image_pil)
        
        # Save processed data
        output_file = output_dir / f"{image_id}.json"
        with open(output_file, 'w') as f:
            json.dump({
                "id": image_id,
                "shards": shards_data,
                # "embedding": embedding.tolist() # Optional: save embedding to file
            }, f, indent=2)
            
        # Add to graph builder
        graph_builder.add_node(image_id, {"processed": True}, embedding)

    # 5. Build Graph
    print("\nBuilding Graph...")
    graph = graph_builder.build_graph()
    
    graph_file = output_dir.parent / "graph.json" # usually public/graph.json
    with open(graph_file, 'w') as f:
        json.dump(graph, f, indent=2)
    
    print(f"Done. Graph saved to {graph_file}")

if __name__ == "__main__":
    main()
