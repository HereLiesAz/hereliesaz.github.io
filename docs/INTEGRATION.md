# Multi-Pipeline Art Integration

All currently present art-processing pipelines are intentional unless explicitly retired later. Their differing outputs are treated as complementary representations of the same painting, not as evidence that one should replace the others.

## Integration rule

Native pipeline outputs remain authoritative for their own formats. Integration is additive.

`scripts/integrate_painting_bakes.py` discovers native artifacts and writes canonical sidecar records under:

```text
public/data/integrated/
  _manifest.json
  {id}.painting-bake.json
```

The machine-readable contract is `schemas/painting-bake.schema.json`.

A sidecar never rewrites, deletes, renames, or normalizes away a native artifact. It records which representations exist for a painting, where they live, which transition graphs describe it, and which pipeline produced each artifact.

## Representation map

### Paper Theater

Producer chain:

```text
public/assets/{image}
  -> scripts/theater_baker.py
  -> public/data/theater/{id}.painting.webp
  -> public/data/theater/{id}.depth.png
  -> public/data/theater/{id}.theater.json
  -> scripts/pareidolia_index.py
  -> public/data/theater/graph.theater.json
```

Canonical representation key: `representations.theater`

Purpose: preserve the source artwork at coalescence while producing depth-band parallax and hinge-driven transitions.

### Turbo Stroke Cloud

Producer chain:

```text
public/assets/{image}
  -> scripts/grinder.py
  -> public/data/{source-filename}.json
```

The native JSON may use `s` or `strokes`. `scripts/pareidolia.py`, `scripts/indexer.py`, and `scripts/repair_and_index.py` operate around this family of data.

Canonical representation key: `representations.strokeCloud`

Purpose: object/color/depth fragments suitable for volumetric or semantic motion.

### Unified Shard Field

Producer chain:

```text
painting image
  -> scripts/prepare.py
  -> scripts/shard_prep/*
  -> public/data/baked/{id}.baked.json
  -> public/graph.json
```

Canonical representation key: `representations.unifiedShardField`

Purpose: organic painterly shards with anamorphic projection, mirrored geometry, and DINOv2 transition anchors.

### Perspective shard bake

Producer:

```text
public/data/*.json
  -> scripts/bake-shards.js
  -> public/data/baked/{id}.baked.json
```

Canonical representation key: `representations.perspectiveShardBake`

Purpose: perspective-corrected GPU-ready shard geometry derived from pre-existing stroke/shard data.

### Semantic layers

Producer:

```text
painting image
  -> scripts/3d_deconstructor.py
  -> public/data/baked/{id}.baked.json
```

Canonical representation key: `representations.semanticLayers`

Purpose: a smaller set of large semantic/depth layers between flat theater bands and dense shard clouds.

### Flat image fallback

Producer/source:

```text
public/graph.json node.image
  -> public/assets/{image}
```

Canonical representation key: `representations.flatImage`

Purpose: guaranteed low-complexity fallback when richer baked representations are missing or unavailable.

## Transition graphs

The canonical sidecar does not collapse graph algorithms into one score.

`transitions.theater` preserves the current schema-5 saliency/LAB/gradient/depth hinge graph from `pareidolia_index.py`.

`transitions.legacyOrUnified` preserves edges from `public/graph.json`, including DINOv2-style anchors or older graph variants.

Keeping graph families distinct is deliberate. A future renderer can combine or rank them, but integration must not silently erase the provenance or semantics of either graph.

## Canonical record shape

A record has this top-level form:

```json
{
  "schemaVersion": 1,
  "id": "painting-id",
  "source": {},
  "representations": {},
  "transitions": {},
  "provenance": []
}
```

`representations` is sparse by design. A painting can have only theater data, only stroke data, every representation, or anything in between.

`provenance` identifies the native producer and artifact for every representation/graph incorporated into the record.

## Deployment behavior

The deploy workflow runs the integrator after checking out `art-data` and before Vite builds the site. The integration directory is therefore regenerated from the exact artifact set being deployed.

This keeps integration deterministic and prevents stale sidecars from surviving after a native artifact is added, changed, or removed.

The current frontend is not required to consume the sidecars yet. Existing theater and flat fallback paths continue to function unchanged. New consumers should prefer the canonical manifest when they need to discover which representations exist.

## Development policy

Do not classify a pipeline as abandoned merely because the current renderer does not consume it.

Use these statuses instead:

- `wired`: producer or consumer is connected to an execution path.
- `unwired`: implementation exists but no current execution/consumer path reaches it.
- `incomplete`: intended behavior is only partially implemented.
- `broken`: an identified defect prevents the intended path from working.
- `overlapping`: another pipeline solves part of the same problem differently.
- `experimental`: behavior is intentionally exploratory.
- `production`: relied on by the shipped site.

Removal requires an explicit decision that the capability is no longer wanted.

## Next integration steps

1. Repair path drift in tools that still default to `assets/raw` so they can operate on the real source corpus without losing the option for a separate staging directory.
2. Fix known local defects such as the missing `random` import in `3d_deconstructor.py`.
3. Add first-class generation/publishing for Unified Shard Field and semantic-layer artifacts so `art-data` can carry them alongside theater and stroke data.
4. Add a runtime loader that reads `/data/integrated/_manifest.json` and can choose or combine representations without changing the current theater renderer's fallback behavior.
5. Define combination rules for semantic metadata, painterly shard geometry, depth bands, and both transition-graph families after the data is simultaneously available for the same paintings.
