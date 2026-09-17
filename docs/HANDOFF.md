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

Status: **workflow wired; implementation defaults to the real `public/assets` source corpus while retaining an explicit `--input` override**.

### Unified Shard Field

`scripts/prepare.py` + `scripts/shard_prep/*` implement the approved unified-shard preprocessor: painterly segmentation, depth assignment, anamorphic projection, mirrored shards, and DINOv2 graph generation.

Native output:

```text
public/data/baked/{id}.baked.json
public/graph.json
```

The preprocessor defaults to `public/assets`, accepts an alternate `--input`, and loads JPG/JPEG/PNG/WebP/HEIC/HEIF through the Pillow/HEIF stack.

Status: **preprocessor implementation exists; production viewer integration is incomplete**.

### Curator / semantic pipeline

`scripts/curator.py` combines SAM segmentation, depth, semantic embeddings, binary GPU-oriented attributes, and a semantic graph. It defaults to `public/assets` and retains an explicit `--input` override.

Status: **substantial alternate/semantic pipeline; current gallery consumer not yet wired**.

### Semantic deconstructor

`scripts/3d_deconstructor.py` produces a smaller number of semantic/depth layers rather than dense shards. It currently imports its `random` dependency and defaults to the real source corpus.

Status: **experimental/incomplete**, not abandoned.

### Perspective shard bake

`scripts/bake-shards.js` converts existing stroke/shard JSON into perspective-corrected mirrored baked geometry.

Status: **implemented build stage; not currently selected by the production renderer**.

### Jules utility

`scripts/jules.py` is a standalone CLI that files GitHub issues from error text supplied through argv/stdin.

Status: **standalone utility; no importer is required for it to be valid**.

## Canonical integration layer

The repo has an additive integration contract:

- schema: `schemas/painting-bake.schema.json`
- builder: `scripts/integrate_painting_bakes.py`
- schema validator: `scripts/validate_integrated_records.py`
- tests: `scripts/test_integrate_painting_bakes.py`
- docs: `docs/INTEGRATION.md`

On deploy, after `art-data` is checked out, the integration directory is deleted and regenerated from the current native artifacts:

```text
public/data/integrated/_manifest.json
public/data/integrated/{id}.painting-bake.json
```

The generated records are validated against `schemas/painting-bake.schema.json` before the site is allowed to deploy. Rebuilding the directory from scratch prevents sidecars for removed paintings from surviving a newer artifact set.

These sidecars **reference** native outputs. They do not rewrite or replace them. A painting can simultaneously expose theater, stroke-cloud, unified-shard, perspective-shard, semantic-layer, and flat-image representations.

Transition graph families remain distinct in the canonical record so their semantics/provenance are not flattened:

- `transitions.theater` — current saliency/LAB/gradient/depth hinge matcher
- `transitions.legacyOrUnified` — `public/graph.json` graph family, including DINOv2-style anchors or older compatible variants

## CI / deployment

`deploy.yml` is the single GitHub Pages deployment workflow. The former GitHub sample `static.yml` and `jekyll-gh-pages.yml` deployers were removed because they competed with the real Vite deployment.

The deployment can also follow successful runs of:

- `Process Art (Turbo 56)`
- `Theater Bake`
- `Remove Painting`
- `Bootstrap Art (5 Images)`

It checks out `art-data`, verifies usable theater data, regenerates and schema-validates canonical integration records, installs Node dependencies with `npm ci`, runs `npm run verify`, uploads `dist`, and deploys Pages.

`npm run verify` is intentionally source-checkout friendly: it checks Python syntax, runs the integration builder unit tests, verifies asset/fallback-graph consistency, validates the Capacitor web output directory, and performs the production Vite build. Deploy-only canonical schema validation runs after `art-data` has been checked out and integration records have been generated.

The theater producer still validates its own native output with `scripts/validate_output.py` before publishing.

### Android / Capacitor

Capacitor now points to Vite's real `dist` output directory. Native Android workflows are retained, but ordinary website pushes do not run Android CI because this repository does not currently contain the Gradle wrapper/project required to build it. Android CI is manually invokable and fails with an explicit preflight message until a reproducible native project is checked in or generated.

## Known work to do

1. Make Unified Shard Field and semantic-layer artifacts first-class published `art-data` outputs rather than local-only/occasional artifacts.
2. Make the canonical `/data/integrated/_manifest.json` and per-painting records a first-class runtime discovery surface where that improves the renderer; do not replace the current theater path merely for architectural neatness.
3. Define combination rules rather than replacement rules: painterly shard boundaries, theater-quality depth, semantic tags/objects, and both transition-graph families can all contribute to one painting experience.
4. Production-test the existing modal keyboard-focus behavior across current desktop/mobile browsers.
5. Establish a reproducible native Android project lifecycle (checked-in project or deterministic Capacitor generation) before re-enabling automatic Android build/release triggers.
6. Lock the heavyweight ML dependency stack only after a known-good end-to-end bake confirms a compatible set; do not pin it blind.
7. Move multi-client painting-removal serialization out of ephemeral browser memory if removals need to be safe across simultaneous tabs/devices.
8. Decide on a durable painting identity independent of filename stems before multiple same-stem source files become a practical collision risk.

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
