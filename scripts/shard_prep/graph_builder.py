import numpy as np

GRAPH_SCHEMA_VERSION = 2   # marks incompatibility with old graph.json files
_SIMILARITY_THRESHOLD = 0.75
_FALLBACK_WEIGHT      = 0.5


def _patch_index_to_uv(patch_idx: int, n_patches_side: int) -> list[float]:
    """Convert a flat patch index to normalised UV coordinates."""
    row = patch_idx // n_patches_side
    col = patch_idx  % n_patches_side
    u = (col + 0.5) / n_patches_side
    v = (row + 0.5) / n_patches_side
    return [round(float(u), 4), round(float(v), 4)]


def extract_dino_embeddings(img_rgb: np.ndarray) -> np.ndarray:
    """
    Extract patch-level DINOv2 embeddings for one image.

    Returns: float32 array of shape [n_patches, 1024], L2-normalised.
    Requires: transformers library and internet access for first run.
    """
    from transformers import AutoImageProcessor, AutoModel
    import torch

    processor = AutoImageProcessor.from_pretrained('facebook/dinov2-large')
    model     = AutoModel.from_pretrained('facebook/dinov2-large')
    model.eval()

    from PIL import Image
    pil_img = Image.fromarray(img_rgb)
    inputs  = processor(images=pil_img, return_tensors='pt')

    with torch.no_grad():
        outputs = model(**inputs)

    # patch_embeddings shape: [1, n_patches, 1024] (exclude CLS token)
    patch_emb = outputs.last_hidden_state[0, 1:, :].numpy().astype(np.float32)

    # L2 normalise
    norms = np.linalg.norm(patch_emb, axis=1, keepdims=True)
    return patch_emb / (norms + 1e-8)


def build_graph(nodes: list[dict], embeddings: dict[str, np.ndarray]) -> dict:
    """
    Build the pareidolia similarity graph.

    Args:
        nodes:      List of node dicts (id, image, title, totalCount)
        embeddings: Dict mapping node id → [n_patches, dim] embedding array

    Returns:
        graph dict with 'nodes' and 'edges' lists matching the spec schema.
    """
    edges = []
    ids   = [n['id'] for n in nodes]
    n     = len(ids)

    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            emb_a = embeddings[ids[i]]  # [P, D]
            emb_b = embeddings[ids[j]]  # [P, D]

            # Cosine similarity matrix [P, P]
            sim_matrix = emb_a @ emb_b.T

            best_idx = int(np.argmax(sim_matrix))
            pa = best_idx // sim_matrix.shape[1]
            pb = best_idx  % sim_matrix.shape[1]
            best_sim = float(sim_matrix[pa, pb])

            n_patches_side = int(round(emb_a.shape[0] ** 0.5))

            if best_sim >= _SIMILARITY_THRESHOLD:
                weight  = round(best_sim, 4)
                s_uv    = _patch_index_to_uv(pa, n_patches_side)
                t_uv    = _patch_index_to_uv(pb, n_patches_side)
            else:
                weight  = _FALLBACK_WEIGHT
                s_uv    = [0.5, 0.5]
                t_uv    = [0.5, 0.5]

            edges.append({
                'source': ids[i],
                'target': ids[j],
                'weight': weight,
                's_uv':   s_uv,
                't_uv':   t_uv,
            })

    return {
        'schemaVersion': GRAPH_SCHEMA_VERSION,
        'nodes': nodes,
        'edges': edges,
    }