import json
import numpy as np
import pytest
from shard_prep.graph_builder import build_graph, GRAPH_SCHEMA_VERSION

def make_fake_nodes(n=3):
    return [
        {
            'id': f'painting_{i}',
            'image': f'painting_{i}.jpg',
            'title': f'Painting {i}',
            'totalCount': 100,
        }
        for i in range(n)
    ]

def make_fake_embeddings(n=3, n_patches=196, dim=1024):
    """Random unit-normalised patch embeddings."""
    emb = np.random.randn(n, n_patches, dim).astype(np.float32)
    norms = np.linalg.norm(emb, axis=2, keepdims=True)
    return emb / (norms + 1e-8)

def test_graph_has_nodes_and_edges_keys():
    nodes = make_fake_nodes(2)
    embeddings = {n['id']: emb for n, emb in zip(nodes, make_fake_embeddings(2))}
    graph = build_graph(nodes, embeddings)
    assert 'nodes' in graph
    assert 'edges' in graph

def test_all_nodes_preserved():
    nodes = make_fake_nodes(3)
    embeddings = {n['id']: emb for n, emb in zip(nodes, make_fake_embeddings(3))}
    graph = build_graph(nodes, embeddings)
    assert len(graph['nodes']) == 3

def test_edge_schema():
    nodes = make_fake_nodes(3)
    embeddings = {n['id']: emb for n, emb in zip(nodes, make_fake_embeddings(3))}
    graph = build_graph(nodes, embeddings)
    for edge in graph['edges']:
        assert 'source' in edge
        assert 'target' in edge
        assert 'weight' in edge
        assert 's_uv' in edge and len(edge['s_uv']) == 2
        assert 't_uv' in edge and len(edge['t_uv']) == 2
        assert 0.0 <= edge['weight'] <= 1.0
        assert edge['source'] != edge['target']

def test_edge_weight_range():
    nodes = make_fake_nodes(4)
    embeddings = {n['id']: emb for n, emb in zip(nodes, make_fake_embeddings(4))}
    graph = build_graph(nodes, embeddings)
    for edge in graph['edges']:
        assert 0.0 <= edge['weight'] <= 1.0

def test_identical_embeddings_produce_high_weight():
    """Two paintings with the same patches must have weight close to 1.0."""
    nodes = make_fake_nodes(2)
    emb = make_fake_embeddings(1)
    embeddings = {nodes[0]['id']: emb[0], nodes[1]['id']: emb[0]}
    graph = build_graph(nodes, embeddings)
    edge_weights = [e['weight'] for e in graph['edges']]
    assert any(w > 0.99 for w in edge_weights)

def test_graph_is_json_serialisable():
    nodes = make_fake_nodes(2)
    embeddings = {n['id']: emb for n, emb in zip(nodes, make_fake_embeddings(2))}
    graph = build_graph(nodes, embeddings)
    serialised = json.dumps(graph)
    parsed = json.loads(serialised)
    assert parsed['nodes'] == graph['nodes']