# Multi-Pipeline Art Integration

All currently present art-processing pipelines are intentional unless explicitly retired later. Their outputs are complementary representations of the same painting.

## Integration rule

Native outputs remain authoritative. Integration is additive: no native artifact is rewritten, deleted, renamed, or normalized away merely to fit a common format.

`scripts/integrate_painting_bakes.py` discovers the artifacts present in the deploy checkout and writes:

~~~text
public/data/integrated/_manifest.json
public/data/integrated/{id}.painting-bake.json
~~~

The machine-readable contract is `schemas/painting-bake.schema.json`.

## Representation families

| Canonical key | Native producer(s) | Native output |
|---|---|---|
| `theater` | `theater_baker.py` | painting/depth/theater metadata, optional masks |
| `strokeCloud` | `grinder.py`, `bootstrap.py`, repaired older stroke data | root `data/*.json` using `s` or `strokes` |
| `unifiedShardField` | `prepare.py` + `shard_prep/*` | baked arrays with `totalCount` + `isMirror` |
| `perspectiveShardBake` | `bake-shards.js` | baked `aOffset/aScale/...` arrays |
| `semanticShardCloud` | `curator.py` | shard JSON plus position/UV/scale binary buffers |
| `semanticLayers` | `3d_deconstructor.py` | baked `slices` |
| `flatImage` | `public/graph.json` + `public/assets` | image fallback / graph node |

A painting may contain any subset of these families.

## Variants

The real `art-data` branch contains multiple native artifacts from the same family for some paintings—for example compact and older stroke JSON forms, or multiple baked shard variants. Integration preserves all of them.

A family with one native artifact is stored directly:

~~~json
"strokeCloud": {
  "data": "/data/example.jpg.json",
  "count": 123,
  "nativeField": "s"
}
~~~

A family with multiple artifacts becomes:

~~~json
"strokeCloud": {
  "variants": [
    { "data": "/data/example.jpg.json", "count": 123, "nativeField": "s" },
    { "data": "/data/example.json", "count": 15000, "nativeField": "strokes" }
  ]
}
~~~

No preferred variant is baked into the data contract.

## Transition graphs

Graph algorithms remain separate rather than being collapsed into one synthetic score.

- `transitions.theater` preserves schema-5 saliency/LAB/gradient/depth hinge edges from `pareidolia_index.py`.
- `transitions.legacyOrUnified` preserves `public/graph.json` edges, including DINO/semantic shard indices or UV anchors where present.

This keeps both provenance and semantics intact for future combination logic.

## Canonical record

~~~json
{
  "schemaVersion": 1,
  "id": "painting-id",
  "source": {},
  "representations": {},
  "transitions": {},
  "provenance": []
}
~~~

`source` contains shared facts such as source image, resolution, or title when a native artifact provides them. `provenance` identifies the pipeline and artifact that contributed each capability.

## Deployment

`.github/workflows/deploy.yml` performs integration after checking out `art-data` and before the Vite build:

1. `rm -rf public/data/integrated` — any existing sidecars are deleted;
2. run `python3 scripts/integrate_painting_bakes.py --public-root public --strict` against the real staged data;
3. run `python3 scripts/validate_integrated_records.py --public-root public` against the schema;
4. run `npm run verify` (which includes `python3 -m unittest scripts/test_integrate_painting_bakes.py`, the legacy asset check, and the Vite build) and deploy.

The sidecars are never committed. They always describe the exact artifact set being deployed and cannot become a separately maintained stale database. They ship with the site as static JSON under `/data/integrated/`.

## Runtime consumers

None yet. The shipped Paper Theater renderer reads `public/data/theater/` directly and does not load the integrated records. An earlier helper, `src/utils/paintingBake.js`, exposed a discovery API over `/data/integrated/` but was never imported by any component; it was removed as dead code. A future renderer that wants another representation should fetch `/data/integrated/_manifest.json` and `/data/integrated/{id}.painting-bake.json` itself (or reintroduce a loader alongside its first real caller).

## Repairs made as part of integration

- `bootstrap.py` defaults to `public/assets`, remains configurable, and handles zero successful samples safely.
- `3d_deconstructor.py` defaults to the real corpus, imports its required random module, and exposes device/limit controls.
- `curator.py` defaults to `public/assets`, exposes device/limit controls, writes semantic shard coordinates needed by its graph, and handles zero-shard paintings without `argmax` crashes.
- the integrator recognizes optional theater mask files already present in `art-data`.
- the integrator recognizes Curator JSON and its `_pos.bin`, `_uv.bin`, `_scale.bin` companions.
- duplicate representation-family artifacts are retained as variants.

## Development policy

Do not classify a pipeline as abandoned merely because the current renderer does not consume it. Use `production`, `wired`, `unwired`, `incomplete`, `broken`, `overlapping`, or `experimental` as appropriate.

Removal requires an explicit decision that the capability is no longer wanted.

## Completion state

The cross-pipeline integration layer is implemented: schema, discovery builder, variant preservation, Curator support, transition preservation, fixture tests, deploy-time generation and validation, and repaired known path/runtime defects are all present on `main`. There is no runtime loader yet (see above).

Future work can change how the gallery **combines or renders** these representations, but it no longer needs to invent another discovery/data-contract layer first.
