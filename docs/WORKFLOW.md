# Developer Workflow

This document describes the pipeline as it actually exists in this repo
today. Scripts read source photos from `public/assets/`. Each top-level
entry there is a symlink into `public/assets/raw/`, which holds the actual
full-resolution files; there is no separate raw/processed pipeline stage.
`raw/` and the symlinked originals are pruned from the production build
(see the "What ships" section of the root README) — they are bake inputs,
not site content.

## Where things run

Nothing in this repository's `.github/workflows/` builds art. Workflows that
need secrets or long runners are *centralized*: the file here is a two-minute
**hand-off tracker** (`permissions: {}`, no secrets), and the real job runs in
[`HereLiesAz/workflows`](https://github.com/HereLiesAz/workflows). A GitHub
webhook from this repository reaches the controller's Cloudflare Worker, which
dispatches the central run; the result comes back as a commit status named
after the tracker file. A successful tracker run therefore says nothing about
the bake: watch the central run.

| Workflow here | What it does | Runs |
|---|---|---|
| `theater_bake.yml` | bake paintings, build/skip the hinge graph, validate, publish to `art-data` | central |
| `remove_painting.yml` | delete a painting's baked files from `art-data`, rebuild manifest and graph | central |
| `publish_admin_staging.yml` | Android "Publish Site": bake staged additions, process removals, merge `admin-staging` into `main` | central |
| `dedup_scan.yml` | read-only duplicate report for the Android Dedup tab | central |
| `deploy.yml` | verify, build and publish the site to GitHub Pages | local |

`deploy.yml` runs on every push to `main`, on pull requests (verify and build
only, never publishes), every three hours, and on demand. **A push to `art-data`
does not start it**, so a bake or removal reaches the live site at the next
deploy: the admin offers a "deploy now" button, and the schedule covers the rest.

`process_art.yml` (stroke grinder) and `bootstrap.yml` are not on `main` today;
the controller registry marks them obsolete. The scripts behind them
(`grinder.py`, `bootstrap.py`) are kept, see `PIPELINE.md`; the legacy stroke
JSON they left in `art-data` (root, `data/`, `baked/`) is history, not site
content, and `scripts/ship-filter.mjs` keeps it out of the deployed build.

---

## 1. Paper theater (the live gallery pipeline)

Source: `public/assets/{id}.{jpg,png,webp,heic,...}`
Output: `public/data/theater/` (published to the `art-data` branch)

### Step 1 — Bake painting + depth + metadata

~~~bash
python3 scripts/theater_baker.py \
    --input  public/assets/ \
    --output public/data/theater/ \
    --ids id1,id2,...      # or: --pending [N]   or: --all
~~~

Every painting that is not already baked costs one paid photorealize call, so
the baker will not run without an explicit scope:

- `--ids a,b,c` bakes exactly those stems (capped at `--max-ids`, default 100).
- `--pending [N]` bakes up to N (default 100) paintings that are unbaked, torn
  (a missing companion file) or whose `scripts/crops.json` entry changed since
  they were baked. This is what the central workflow uses when it is given no
  ids, with N = 20.
- `--all` bakes every unbaked image. Use it deliberately.

Stems that collide with shared files (`graph`, a leading `_`), contain
characters that break fetch URLs (`# % ? & + / \`), or duplicate another
extension's stem are skipped with a warning.

Per painting this runs four cacheable stages (each skipped if its output
already exists, unless `--force`): crop to the artwork (hand-authored
boxes in `scripts/crops.json`, else a saturation heuristic) → photorealize
via an HF image model → monocular depth (Depth-Anything-V2, local first,
then a hosted Space, then a documented emergency-only synthetic
fallback) → k-means depth bands + color clusters, written to
`{id}.theater.json`. See the module docstring in `theater_baker.py` for
the full stage breakdown and depth-provenance values. `HF_TOKEN` is required
for the photorealize stage (see `SETUP.md`).

### Step 2 — Build the hinge graph

~~~bash
python3 scripts/pareidolia_index.py --data public/data/theater/
~~~

Reads the paintings listed in `_manifest.json` (their `{id}.painting.webp` and
`{id}.depth.png`; no re-bake needed) and writes `graph.theater.json`. Each
ordered pair of paintings gets the best shared "hinge" patch, if any candidate
clears the acceptance bar (see `pareidolia_index.py`'s `MIN_SIM` / scale-bias-
correction comments); most pairs get NO edge. This is intentional: a curated
match set, not a complete graph.

It is **incremental**. An edge depends only on its own (A, B) pair, so when a
graph already exists only pairs involving a new or changed painting are matched
and every other edge is carried over. A painting counts as unchanged when its
dimensions match and its content hash (painting + depth) matches the one the
old graph recorded; nodes from before hashes were recorded are trusted at equal
dimensions. Bumping `MATCHER_VERSION` in the script, or `--full`, recomputes
everything. The result matches a full run's edge *set* up to the matcher's
numeric noise: two full runs on unchanged inputs have been seen to differ in a
couple of edges. Edges are written in manifest order either way.

**Group bakes skip this step.** While `scripts/hinge_graph.skip` exists, a plain
`pareidolia_index.py` run (what the central bake executes) does nothing, so
paintings can be baked in groups without paying for the graph. The existing
`graph.theater.json` stays valid but does not cover the new paintings, and
`validate_output.py` prints the gap instead of failing. Build the graph once
over the whole corpus, commit it to `art-data`, then delete the flag file; see
[`HINGE_GRAPH.md`](./HINGE_GRAPH.md) for how, including splitting the work
across sessions. Until then the gallery cannot reach the unconnected paintings
through the walk.

### Step 3 — Validate before publishing

~~~bash
python3 scripts/validate_output.py --dir public/data/theater
~~~

Hard gate, non-zero exit on any violation: schema, torn-write manifest entries,
a depth map that is unreadable or not 16-bit, a synthetic/emergency depth map,
a graph edge or UV out of range, a suspiciously complete graph (from 10 nodes
up), and, unless `hinge_graph.skip` exists, a graph that does not cover the
manifest exactly or whose node sizes disagree with `theater.json`. The central
bake runs this before publishing, then `check_no_shrink.py`, which refuses a
publish that would drop paintings from the manifest (for example after a failed
`art-data` seed).

### How a bake reaches the site

~~~text
admin app / dispatch ──> theater_bake.yml (hand-off here)
                           └─ webhook ─> Worker ─> HereLiesAz/workflows (central bake)
central bake: seed from art-data ─> theater_baker.py ─> pareidolia_index.py (skipped
              while hinge_graph.skip exists) ─> validate_output.py ─> check_no_shrink.py
              ─> publish to art-data (additive, keep_files: true)
deploy.yml (next run) ─> checks out art-data ─> builds ─> Pages
~~~

A dispatch carries a comma-separated id list; with none, the run bakes up to 20
pending paintings. Actions allows one running and one pending run per
concurrency group, so a third dispatch can evict the second before it starts;
because a blank run bakes whatever is still pending, a dropped dispatch is
picked up by the next one.

---

## 2. Stroke grinder (legacy, kept)

`scripts/grinder.py` (SAM segmentation + MiDaS depth) produces per-painting
stroke JSON. It used to run as a 56-shard matrix in `process_art.yml`, which is
no longer on `main`; run it by hand if you want it. `scripts/indexer.py` and
`scripts/pareidolia.py` are not run by any workflow. See `PIPELINE.md` for what
each family produces.

### Pareidolia "ghost injection" — legacy, no live caller

`scripts/pareidolia.py` scans the legacy per-painting JSON files in
`public/data/` (not `public/data/theater/`) for face-like Haar-cascade
detections and injects a `pareidolia` array into each. **No workflow calls
this.** Historical manual runs left a stale `pareidolia` key on most (not all)
of the legacy `public/data/*.json` files, so the corpus is inconsistent either
way. Treat it as a standalone, manually-run curiosity, not a required pipeline
step.

### Deduplication

~~~bash
python3 scripts/dedup_scan.py     # read-only report; backs the Android Dedup tab
python3 scripts/deduplicate.py    # destructive, manual
~~~

`dedup_scan.py` lists likely duplicates and changes nothing. `deduplicate.py`
scans `public/assets/` (the same directory the bake reads), perceptually hashes
every image, and **deletes** the lower-quality file in each visually identical
group. Nothing runs it automatically. Because it deletes by content match and
`scripts/crops.json` keys off exact filename stems, run it deliberately and check
its output before committing.

---

## Metadata (editorial)

Titles, years, prices and descriptions are edited in the admin and saved to
`public/meta.json` (see `ANDROID_ADMIN.md` and `FRONTEND.md`). The gallery
shows the title, or "untitled" when a painting has none (camera file names are
not shown), and reads the description aloud to screen readers.

---

## Frontend Development

### Start Local Server
~~~bash
npm run dev
~~~

### Building for Production
~~~bash
npm run build
~~~
This generates the static site in `dist/`. In CI, `deploy.yml` first checks
out the `art-data` branch into `public/data/`; the build then keeps only the
manifest-listed `data/theater/` files and `data/integrated/` (see
`scripts/ship-filter.mjs`: the branch is about 2 GB, GitHub Pages rejects sites
over 1 GB, and the deployed site is about 60 MB) and fails if `dist` exceeds
900 MB. A local build only contains whatever is in your local `public/data/`
(see `AGENTS.md` for linking an art-data worktree).

### Verifying a change
~~~bash
npm run verify
~~~
Runs the Python syntax check, the unit tests (integration builder, manifest
guard, output validator, hinge graph, baker guards, ship filter), the design-token
sync check, the asset check, and a production build. `deploy.yml` runs the same
on pull requests. The hinge-graph and baker tests need numpy, OpenCV and Pillow
(`pip install -r scripts/verification-requirements.txt`); without them they are
skipped locally and fail in CI.
