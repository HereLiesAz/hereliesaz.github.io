import os
import json
from pathlib import Path

def rebuild():
    data_dir = Path("/home/az/StudioProjects/HereLiesAzdotCom/public/data")
    files = sorted([f for f in data_dir.glob("*.json") if not f.name.endswith(".jpg.json")])
    
    # Filter for high-density files
    dense_files = []
    for f in files:
        if f.stat().st_size > 500000: # > 500KB
            dense_files.append(f)
            
    print(f"Found {len(dense_files)} dense paintings.")
    
    nodes = []
    edges = []
    
    # Use top 20 for a smooth experience
    selection = dense_files[:20]
    
    for i, f in enumerate(selection):
        node_id = f.stem
        nodes.append({
            "id": node_id,
            "file": f.name,
            "title": f"Void Artwork {i+1}"
        })
        
        # Linear sequence
        if i < len(selection) - 1:
            edges.append({
                "source": node_id,
                "target": selection[i+1].stem,
                "source_shard": 500, # Testing anchor
                "target_shard": 500,
                "weight": 1.0
            })
            
    # Loop back
    if len(selection) > 1:
        edges.append({
            "source": selection[-1].stem,
            "target": selection[0].stem,
            "source_shard": 500,
            "target_shard": 500,
            "weight": 1.0
        })
        
    graph = {"nodes": nodes, "edges": edges}
    
    graph_path = Path("/home/az/StudioProjects/HereLiesAzdotCom/public/graph.json")
    with open(graph_path, 'w') as f:
        json.dump(graph, f, indent=2)
        
    print(f"Rebuilt graph.json with {len(nodes)} nodes.")

if __name__ == "__main__":
    rebuild()
