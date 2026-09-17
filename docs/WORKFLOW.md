# Developer Workflow

This document describes the pipeline as it actually exists in this repo
today — not an aspirational `assets/raw/` staging layout from an earlier
plan. Source photos live in a single flat directory, `public/assets/`
(1180+ files), with no raw/processed split; scripts read from it directly.

There are two independent, live GitHub Actions pipelines that both write
to the orphan `art-data` branch (`keep_files: true`, so they layer rather
than overwrite each other), plus a couple of manual/optional helper
scripts:

1.  **Paper theater** (`theater_bake.yml`) — the CURRENT gallery: crops
    each painting, photorealizes it, estimates depth, buckets the depth
    into bands, and builds the "pareidolia hinge" graph connecting
    paintings by shared visual patches. This is the pipeline behind the
    live 3D diorama gallery.
2.  **Stroke grinder** (`process_art.yml`) — an older, separate
    "pointillist" visualization (`scripts/grinder.py`, SAM + MiDaS,
    56-way sharded). Still live, but independent of the theater pipeline;
    neither reads the other's output.

Plus `bootstrap.yml`, a small manual workflow that bootstraps 5 sample
images through a MiDaS+SAM path similar to the grinder, for a fast, cheap
sanity check of the art-data publish flow.

---

## 1. Paper theater (the live gallery pipeline)

Source: `public/assets/{id}.{jpg,png,webp,heic,...}`
Output: `public/data/theater/` (deployed to the `art-data` branch)

### Step 1 — Bake painting + depth + metadata

```bash
python3 scripts/theater_baker.py \
    --input  public/assets/ \
    --output public/data/theater/ \
    --ids id1,id2,...   # or omit for the default curated batch
```

Per painting this runs four cacheable stages (each skipped if its output
already exists, unless `--force`): crop to the artwork (hand-authored
boxes in `scripts/crops.json`, else a saturation heuristic) → photorealize
via an HF image model → monocular depth (Depth-Anything-V2, local first,
then a hosted Space, then a documented emergency-only synthetic
fallback) → k-means depth bands + color clusters, written to
`{id}.theater.json`. See the module docstring in `theater_baker.py` for
the full stage breakdown and depth-provenance values.

### Step 2 — Build the hinge graph

```bash
python3 scripts/pareidolia_index.py --data public/data/theater/
```

Reads every baked `{id}.painting.webp` / `{id}.depth.png` pair already in
`--data` (no re-bake needed) and writes `graph.theater.json`: for each
ordered pair of paintings, the best shared "hinge" patch, if any candidate
clears the acceptance bar (see `pareidolia_index.py`'s `MIN_SIM` / scale-
bias-correction comments — most pairs get NO edge; this is intentional, a
curated match set, not a complete graph).

### Step 3 — Validate before publishing

```bash
python3 scripts/validate_output.py --dir public/data/theater
```

Hard gate, non-zero exit on any violation (schema, torn-write manifest
entries, a synthetic/emergency depth map that shipped undetected, or a
suspiciously-complete hinge graph). `theater_bake.yml` runs this and fails
the job on any error — see that workflow for the exact CI wiring.

In CI this whole chain (bake → hinge graph → validate → deploy) is driven
by **`.github/workflows/theater_bake.yml`**, dispatched with an explicit
comma-separated id list (or a default curated batch) — never the whole
`public/assets/` corpus in one go, since the photorealize step calls a
paid/quota'd model per painting.

---

## 2. Stroke grinder (legacy, still live, separate pipeline)

Driven by **`.github/workflows/process_art.yml`**: a 56-shard matrix job
runs `scripts/grinder.py` (SAM segmentation + MiDaS depth) over
`public/assets/`, producing per-painting stroke JSON, consolidated and
deployed to `art-data` alongside (not instead of) the theater tree.

`scripts/indexer.py` and `scripts/pareidolia.py` are **not** run by this
workflow (or any live workflow) anymore — see the comment in
`process_art.yml`'s `consolidate` job for why the old indexer step was
removed (its output path was never actually published, and nothing in
`src/` reads it).

### Pareidolia "ghost injection" — legacy, no live caller

`scripts/pareidolia.py` scans the legacy per-painting JSON files in
`public/data/` (not `public/data/theater/`) for face-like Haar-cascade
detections and injects a `pareidolia` array into each. **No workflow calls
this anymore.** Historical manual runs already left a stale `pareidolia`
key on most (not all) of the legacy `public/data/*.json` files, so the
corpus is inconsistent either way. Treat it as a standalone, manually-run
curiosity, not a required pipeline step — do not add it back into a
workflow without also deciding what to do about the paintings that were
never run through it.

### Deduplication — optional, manual, destructive

```bash
python3 scripts/deduplicate.py
```

Scans `public/assets/` (the SAME directory the theater bake reads from —
there is no separate raw-dump folder), perceptually hashes every image,
and **deletes** the lower-quality file in each visually-identical group.
No workflow runs this automatically. Because it deletes files by content
match, and `theater_bake.yml`'s default id batch and `scripts/crops.json`
both key off exact filename stems, run it deliberately and check its
output before committing — not as a routine step.

---

## Metadata (editorial)

`scripts/grinder.py` creates a per-image "stub" markdown file in
`assets/meta/` for hand-edited titles/years/descriptions, in the same
format described in earlier versions of this doc. That mechanism is part
of the stroke-grinder pipeline, not the paper-theater one.

---

## Frontend Development

### Start Local Server
```bash
npm run dev
```

### Building for Production
```bash
npm run build
```
This generates the static site in `dist/`. Baked art data is fetched at
runtime from the `art-data` branch rather than bundled into `dist/`.
