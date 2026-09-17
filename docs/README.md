# Documentation index

This project intentionally keeps multiple art-processing representations of the same paintings: the production paper-theater renderer, stroke clouds, painterly anamorphic shards, semantic shard clouds/layers, and flat-image fallback data. The integration layer indexes all available representations without erasing their native formats or provenance.

## Read these

1. [**Architecture**](./ARCHITECTURE.md) — system design, renderer/state architecture, CI/CD topology, and security posture.
2. [**Frontend**](./FRONTEND.md) — the React + Zustand + react-three-fiber application.
3. [**Shaders**](./SHADERS.md) — the current paper-theater shaders and rendering constraints.
4. [**Pipeline**](./PIPELINE.md) — every intentional art-processing pipeline, its inputs/outputs, and current status.
5. [**Integration**](./INTEGRATION.md) — the canonical `PaintingBake` sidecar schema, variants, transition graphs, deploy generation, and runtime loader.
6. [**Workflow**](./WORKFLOW.md) — how CI and manual pipeline execution are wired.
7. [**Setup**](./SETUP.md) — Python and Node environment setup.
8. [**Aesthetic**](./AESTHETIC.md) — creative brief.
9. [**Handoff**](./HANDOFF.md) — current state and working rules.

[`archive/`](./archive/) contains earlier planning/spec snapshots. A document being archived means it is not the current implementation reference; it does **not** mean every capability described in it has been rejected or should be removed.

## Quick start

```bash
npm install
npm run dev

pip install -r scripts/requirements.txt
python3 scripts/theater_baker.py --input public/assets/ --output public/data/theater/ --ids id1,id2
python3 scripts/pareidolia_index.py --data public/data/theater/
python3 scripts/validate_output.py --dir public/data/theater

python3 -m unittest scripts/test_integrate_painting_bakes.py
python3 scripts/integrate_painting_bakes.py --public-root public
```

See [`PIPELINE.md`](./PIPELINE.md), [`INTEGRATION.md`](./INTEGRATION.md), [`WORKFLOW.md`](./WORKFLOW.md), and [`SETUP.md`](./SETUP.md) for the complete picture.
