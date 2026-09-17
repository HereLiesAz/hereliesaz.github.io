# Asset Pipeline

This repository intentionally contains multiple art-processing pipelines. They are not cleanup candidates merely because the current gallery renderer consumes only some of them. Each pipeline produces a distinct representation of the same source artwork, and the integration layer indexes all representations that exist for a painting.

See [`INTEGRATION.md`](./INTEGRATION.md) for the canonical sidecar contract and [`WORKFLOW.md`](./WORKFLOW.md) for execution details.

## Shared source corpus

The real source corpus is `public/assets/`. Tools may accept another input directory explicitly, but checked-in defaults should target `public/assets` unless a tool has a documented reason to use a separate staging directory.

## 1. Paper Theater — production renderer data

Producer chain:

```text
public/assets/{image}
  -> scripts/theater_baker.py
  -> public/data/theater/{id}.painting.webp
  -> public/data/theater/{id}.depth.png
  -> public/data/theater/{id}.theater.json
  -> scripts/pareidolia_index.py
  -> public/data/theater/graph.theater.json
  -> scripts/validate_output.py
```

`theater_bake.yml` publishes this tree to `art-data`. The shipped `TheaterPainting.jsx` renderer consumes these files.

`theater_baker.py` crops the artwork, optionally generates a photoreal reference for better monocular depth estimation, produces a 16-bit depth map, and clusters that depth into bands. Its native metadata schema is currently schema 2.

`pareidolia_index.py` builds schema-5 transition edges using mutual saliency, LAB colour, gradient structure, and depth. An edge records `source`, `target`, `weight`, `s_uv`, `t_uv`, and `scale`.

`validate_output.py` is the hard CI gate for theater artifacts. It validates manifest membership, companion files, depth-band structure, depth provenance, graph references, UVs, weights, scales, and rejects a complete graph as a regression signal.

Canonical integration key: `representations.theater`.

## 2. Turbo Stroke Cloud — active producer

Producer chain:

```text
public/assets/{image}
  -> scripts/grinder.py
  -> public/data/{source}.json
  -> art-data
```

`process_art.yml` runs the grinder in a 56-way matrix. The grinder uses SAM plus ZoeDepth/MiDaS, then subdivides SAM masks by colour to produce compact stroke records with colour, bounding box, depth, and stability.

Both native forms already present in `art-data` are preserved:

- compact `s` records produced by the current grinder;
- older `strokes` records used by earlier tooling.

`scripts/pareidolia.py` can add face-like pareidolia annotations to this family. `scripts/indexer.py` and `scripts/repair_and_index.py` are maintenance/indexing tools for related stroke formats.

Canonical integration key: `representations.strokeCloud`. When more than one native artifact maps to the same painting, the sidecar stores `variants` rather than choosing one.

## 3. Bootstrap Stroke Pipeline — manual seeding/test path

`scripts/bootstrap.py`, invoked by `bootstrap.yml`, runs a five-image SAM/depth pass and writes stroke JSON plus `bootstrap-manifest.json`. Its default input is the real `public/assets` corpus; `--input`, `--output`, and `--limit` allow deliberate overrides.

Its native stroke output is integrated through the same `strokeCloud` family rather than treated as a separate incompatible model.

## 4. Unified Shard Field — painterly anamorphic representation

Producer chain:

```text
public/assets/{image} (or explicit input directory)
  -> scripts/prepare.py
  -> scripts/shard_prep/segmentation.py
  -> scripts/shard_prep/depth.py
  -> scripts/shard_prep/projection.py
  -> scripts/shard_prep/graph_builder.py
  -> public/data/baked/{id}.baked.json
  -> public/graph.json
```

This path follows the approved unified-shard-field design: painterly SLIC/LAB segmentation, depth assignment, anamorphic projection, mirrored shards, and DINOv2 patch matching. `prepare.py` is the entry point; `scripts/shard_prep/` is its implementation package, not an orphan.

Canonical integration key: `representations.unifiedShardField`.

## 5. Perspective Shard Bake — stroke/shard geometry conversion

Producer chain:

```text
public/data/*.json
  -> scripts/bake-shards.js
  -> public/data/baked/{id}.baked.json
```

This converts pre-existing stroke/shard records into perspective-corrected GPU-oriented arrays (`aOffset`, `aScale`, `aColor`, `aUvOffset`, `aUvScale`) and mirrored placement.

Canonical integration key: `representations.perspectiveShardBake`.

The existing `art-data/baked/` tree contains this family for many paintings, including filename-qualified variants such as `{id}.jpg.baked.json`. Integration preserves all variants.

## 6. Curator Semantic Shard Cloud

Producer chain:

```text
public/assets/{image}
  -> scripts/curator.py
  -> public/data/{id}.json
  -> public/data/{id}_pos.bin
  -> public/data/{id}_uv.bin
  -> public/data/{id}_scale.bin
  -> public/graph.json
```

`curator.py` uses SAM, depth, and DINOv2 embeddings to create semantic shards plus compact binary GPU buffers and a semantic similarity graph. Its checked-in default now points at `public/assets`; it also handles paintings that produce zero semantic masks without crashing the graph builder.

Canonical integration key: `representations.semanticShardCloud`.

## 7. Semantic Layer Deconstructor

Producer chain:

```text
public/assets/{image}
  -> scripts/3d_deconstructor.py
  -> public/data/baked/{id}.baked.json
```

This produces a smaller set of large semantic/depth layers (`slices`) rather than dense shards. It sits conceptually between theater depth bands and the denser shard-cloud approaches. The checked-in implementation has a real-corpus default, configurable device/limit, and the required random module import.

Canonical integration key: `representations.semanticLayers`.

## 8. Flat Image / Legacy Graph Fallback

`public/graph.json` remains a valid graph family and a source of flat image fallback nodes. `scripts/verify-assets.cjs` repairs this graph in the ephemeral deploy checkout by dropping nodes whose source image no longer exists and bridging around them.

Canonical integration key: `representations.flatImage`.

Edges from this graph are preserved separately as `transitions.legacyOrUnified`; they are not collapsed into theater hinge scores because their semantics and provenance can differ.

## 9. Canonical integration sidecars

After `art-data` is checked out during deployment, `scripts/integrate_painting_bakes.py` discovers every recognized representation and writes:

```text
public/data/integrated/_manifest.json
public/data/integrated/{id}.painting-bake.json
```

The schema is `schemas/painting-bake.schema.json`.

The integrator is additive. It does not rewrite, delete, rename, or normalize away native artifacts. If multiple native artifacts of one family map to the same painting, that family becomes a `variants` collection in the canonical record.

Recognized representation keys are:

- `theater`
- `strokeCloud`
- `unifiedShardField`
- `perspectiveShardBake`
- `semanticShardCloud`
- `semanticLayers`
- `flatImage`

The deploy workflow runs `scripts/test_integrate_painting_bakes.py` before generating real sidecars.

Runtime code can use `src/utils/paintingBake.js` to load the canonical manifest/records, enumerate variants, inspect transition graphs, or choose a preferred representation without changing the existing theater renderer.

## Supporting and maintenance tools

- `scripts/crops.json` — per-image crop directives for theater.
- `scripts/requirements.txt` — Python/ML dependencies.
- `scripts/verify-assets.cjs` — deploy-time legacy graph repair.
- `scripts/deduplicate.py` — destructive manual perceptual duplicate cleanup; intentionally not automatic.
- `scripts/indexer.py` — stroke-cloud manifest/index generator.
- `scripts/pareidolia.py` — Haar-cascade pareidolia annotation for stroke data; distinct from `pareidolia_index.py`.
- `scripts/repair_and_index.py` — old-format stroke repair plus manifest generation.
- `scripts/jules.py` — standalone issue-reporting CLI; operational tooling rather than an art representation.

## Status vocabulary

Use precise statuses instead of inferring intent from wiring:

- **production** — relied on by the shipped site;
- **wired** — reachable from a workflow or runtime path;
- **unwired** — implemented but currently has no execution/consumer path;
- **incomplete** — intended behavior is only partially implemented;
- **broken** — a known defect prevents intended execution;
- **overlapping** — another pipeline addresses part of the same problem differently;
- **experimental** — intentionally exploratory.

A pipeline is removed only after an explicit decision that its capability is no longer wanted.
