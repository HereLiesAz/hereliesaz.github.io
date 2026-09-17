# Handoff

This repository contains multiple intentional art-processing pipelines. Do **not** classify one as abandoned merely because the current renderer does not consume it. Treat the implementations as parallel representations/capabilities unless Az explicitly retires one.

For the integration contract and pipeline map, start with [`INTEGRATION.md`](./INTEGRATION.md).

## Shipped gallery

The current production renderer is the paper-theater path:

```text
public/assets/
  -> scripts/theater_baker.py
  -> public/data/theater/{id}.painting.webp
  -> public/data/theater/{id}.depth.png
  -> public/data/theater/{id}.theater.json
  -> scripts/pareidolia_index.py
  -> public/data/theater/graph.theater.json
  -> Scene.jsx / TheaterPainting.jsx / AnamorphicCam.jsx
```

`Scene.jsx` prefers the theater manifest/hinge graph and falls back to `public/graph.json` flat images if the theater data is unavailable.

`TheaterPainting.jsx` builds mirrored depth-band flats at runtime, including the hinge reveal, shard wipe, dark/light background handling, and background sweep.

## Intentional parallel pipelines

### Turbo Stroke Cloud

`process_art.yml` runs `scripts/grinder.py` across the source corpus in 56 shards and publishes the resulting stroke JSON to `art-data`.

`grinder.py` combines SAM segmentation, color sub-sharding, and monocular depth. Companion tooling includes `indexer.py`, `pareidolia.py`, `repair_and_index.py`, and `bake-shards.js`.

Status: **producer wired; current gallery consumer not yet wired**.

### Bootstrap Art

`bootstrap.yml` is a manually dispatched five-image bootstrap workflow using `scripts/bootstrap.py`.

Status: **workflow wired, implementation currently affected by input-path drift** (`bootstrap.py` still assumes `assets/raw`, while the real source corpus is under `public/assets`). Repair it; do not remove it merely because it currently fails to find inputs.

### Unified Shard Field

`scripts/prepare.py` + `scripts/shard_prep/*` implement the approved unified-shard preprocessor: painterly segmentation, depth assignment, anamorphic projection, mirrored shards, and DINOv2 graph generation.

Native output:

```text
public/data/baked/{id}.baked.json
public/graph.json
```

Status: **preprocessor implementation exists; production viewer integration is incomplete**.

### Curator / semantic pipeline

`scripts/curator.py` combines SAM segmentation, depth, semantic embeddings, binary GPU-oriented attributes, and a semantic graph.

Status: **substantial alternate/semantic pipeline; current input defaults need alignment with the real corpus**.

### Semantic deconstructor

`scripts/3d_deconstructor.py` produces a smaller number of semantic/depth layers rather than dense shards.

Status: **experimental/incomplete**. A known defect is use of `random.random()` without importing `random`.

### Perspective shard bake

`scripts/bake-shards.js` converts existing stroke/shard JSON into perspective-corrected mirrored baked geometry.

Status: **implemented build stage; not currently selected by the production renderer**.

### Jules utility

`scripts/jules.py` is a standalone CLI that files GitHub issues from error text supplied through argv/stdin.

Status: **standalone utility; no importer is required for it to be valid**.

## Canonical integration layer

The repo now has an additive integration contract:

- schema: `schemas/painting-bake.schema.json`
- builder: `scripts/integrate_painting_bakes.py`
- tests: `scripts/test_integrate_painting_bakes.py`
- docs: `docs/INTEGRATION.md`

On deploy, after `art-data` is checked out, the integration builder writes:

```text
public/data/integrated/_manifest.json
public/data/integrated/{id}.painting-bake.json
```

These sidecars **reference** native outputs. They do not rewrite or replace them. A painting can simultaneously expose theater, stroke-cloud, unified-shard, perspective-shard, semantic-layer, and flat-image representations.

Transition graph families remain distinct in the canonical record so their semantics/provenance are not flattened:

- `transitions.theater` — current saliency/LAB/gradient/depth hinge matcher
- `transitions.legacyOrUnified` — `public/graph.json` graph family, including DINOv2-style anchors or older compatible variants

## CI / deployment

`deploy.yml` redeploys after:

- `Process Art (Turbo 56)`
- `Theater Bake`
- `Remove Painting`
- `Bootstrap Art (5 Images)`

It checks out `art-data`, verifies usable theater data, runs the integration unit tests, builds integrated sidecars, repairs the legacy flat fallback graph against available assets, builds Vite, and deploys Pages.

The theater producer still validates its own native output with `scripts/validate_output.py` before publishing.

## Known work to do

1. Repair source-path drift (`assets/raw` vs `public/assets`) in `bootstrap.py`, `curator.py`, `3d_deconstructor.py`, and any other affected entrypoints while preserving explicit CLI input overrides.
2. Fix the missing `random` import in `3d_deconstructor.py`.
3. Make Unified Shard Field and semantic-layer artifacts first-class published `art-data` outputs rather than local-only/occasional artifacts.
4. Add a runtime loader for `/data/integrated/_manifest.json` so a renderer can discover and combine representations without hard-coding each producer format.
5. Define combination rules rather than replacement rules: painterly shard boundaries, theater-quality depth, semantic tags/objects, and both transition-graph families can all contribute to one painting experience.
6. Production-test the existing modal keyboard-focus behavior; prior dev-server testing was inconclusive.

## Status vocabulary

Use these terms when auditing the repo:

- **production** — relied on by the shipped site
- **wired** — reachable through a real producer/consumer/execution path
- **unwired** — implementation exists but is not connected to a current path
- **incomplete** — intended behavior is only partially implemented
- **broken** — a concrete defect prevents intended execution
- **overlapping** — another intentional pipeline solves part of the same problem differently
- **experimental** — intentionally exploratory

Do not infer **abandoned**, **dead**, or **orphaned** from absence of a current caller. Removal requires an explicit decision that the capability is no longer wanted.
