# Art Pipeline

The repository now has one production art-data pipeline: the paper-theater bake.

## Inputs

Source artwork lives under `public/assets/`. Optional hand-tuned crop boxes live in `scripts/crops.json`.

## Bake

`theater_bake.yml` is the repository-side trigger/proxy. Its implementation is centralized in `HereLiesAz/workflows`.

For each requested painting id, `scripts/theater_baker.py` produces:

```text
public/data/theater/{id}.painting.webp
public/data/theater/{id}.depth.png
public/data/theater/{id}.theater.json
```

The baker performs four cacheable stages:

1. crop the source to the artwork
2. photorealize the same composition for more reliable monocular depth estimation
3. estimate depth and align it to the painting
4. cluster depth into merged bands and write metadata

The intended depth provenance is `photo+depth-anything-v2`. Direct-on-painting or synthetic depth exists only as fallback behavior and should be treated accordingly when reviewing output.

## Hinge graph

After baking, `scripts/pareidolia_index.py` compares baked paintings and writes:

```text
public/data/theater/graph.theater.json
```

Each accepted directed edge contains the source/target painting ids, match weight, source/target UV hinge positions, and patch scale. Sparse edges are intentional; paintings without a credible shared visual patch should not be forced into one.

## Validation

`scripts/validate_output.py` is the publication gate. The workflow must fail before publish when required theater assets or graph structure are invalid.

The deploy workflow also performs a smaller consuming-side check: `public/data/theater/_manifest.json` must exist and be non-empty after checking out `art-data`.

## Publication

Validated theater output is published to the orphan `art-data` branch. `deploy.yml` checks that branch out into `public/data` before the Vite build.

The frontend consumes:

- `/data/theater/_manifest.json`
- `/data/theater/graph.theater.json`
- each painting's `.painting.webp`, `.depth.png`, and `.theater.json`

`public/graph.json` remains only as a flat-plane fallback for unbaked/missing theater data. `npm run verify-assets` repairs that fallback graph in the ephemeral deploy checkout before building.

## Band curation

`public/band-overrides.json` is a render-time curation layer. `/admin` can mark specific baked depth bands hidden; `src/utils/bandOverrides.js` folds those bands into neighbors in the browser. No rebake is required.

## Removal

Artwork removal is handled through `remove_painting.yml` and the `/admin` batching logic. Removal mutates `art-data`; the Pages deploy watches that workflow so the public build picks up the new dataset.

## Retired pipeline

The old SAM/MiDaS shard-cloud pipeline was removed in September 2026. It previously consisted of `process_art.yml`, `bootstrap.yml`, `grinder.py`, `bootstrap.py`, and several orphaned helper scripts. None of that output was consumed by the shipped paper-theater frontend.

Historical descriptions remain under `docs/archive/`; there is no executable legacy pipeline left to accidentally trigger.
