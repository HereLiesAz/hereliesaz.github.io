# HereLiesAz — Multi-Pipeline 3D Gallery

> A 3D art gallery built from several intentional representations of the same paintings: paper-theater depth layers, stroke clouds, painterly anamorphic shards, semantic shards/layers, and flat-image fallbacks. The current shipped renderer is the paper-theater path; the other pipelines remain first-class capabilities and are indexed through a canonical integration layer rather than treated as disposable legacy code.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design and CI/CD topology.
- [`docs/FRONTEND.md`](docs/FRONTEND.md) — the React/R3F application.
- [`docs/SHADERS.md`](docs/SHADERS.md) — current theater shaders.
- [`docs/PIPELINE.md`](docs/PIPELINE.md) — all intentional art-processing pipelines and their native outputs.
- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — canonical multi-pipeline sidecar contract and runtime discovery.
- [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — workflow execution details.
- [`docs/HINGE_GRAPH.md`](docs/HINGE_GRAPH.md) — building the hinge graph for the whole corpus.
- [`docs/ANDROID_ADMIN.md`](docs/ANDROID_ADMIN.md) — the native admin app.
- [`docs/SETUP.md`](docs/SETUP.md) — environment setup.
- [`docs/AESTHETIC.md`](docs/AESTHETIC.md) — creative brief.
- [`docs/archive/`](docs/archive/) — earlier design/spec snapshots. Archive placement means historical/superseded documentation, not that the capabilities described there are automatically unwanted.

## Quick start

### Frontend

~~~bash
npm install
npm run dev
npm run build
~~~

### Paper Theater

~~~bash
pip install -r scripts/requirements.txt
python3 scripts/theater_baker.py --input public/assets/ --output public/data/theater/ --ids id1,id2,...   # or --pending [N] / --all
python3 scripts/pareidolia_index.py --data public/data/theater/   # no-op while scripts/hinge_graph.skip exists
python3 scripts/validate_output.py --dir public/data/theater
~~~

Every baked painting costs a paid model call, so the baker needs `--ids`, `--pending` or `--all`; see [`docs/WORKFLOW.md`](docs/WORKFLOW.md). Building the hinge graph over a large corpus is split into shards: [`docs/HINGE_GRAPH.md`](docs/HINGE_GRAPH.md).

### Verify

~~~bash
npm run verify
~~~

### Canonical integration

~~~bash
python3 -m unittest scripts/test_integrate_painting_bakes.py
python3 scripts/integrate_painting_bakes.py --public-root public
~~~

The integrator preserves native artifacts and writes additive sidecars under `public/data/integrated/`. Those sidecars are **not committed**: `deploy.yml` deletes any existing `public/data/integrated/` after checking out `art-data`, regenerates it from scratch with `--strict`, validates it, and ships it with the site as static JSON. No runtime code reads them yet — the shipped renderer consumes `public/data/theater/` directly. (A former loader, `src/utils/paintingBake.js`, was never imported and has been removed; a future renderer that wants the canonical records should fetch `/data/integrated/_manifest.json` itself.)

## Project structure

~~~text
public/assets/                  source artwork corpus
public/data/theater/            paper-theater output
public/data/baked/              perspective-shard bakes (988, tracked)
data/baked/                     early 15-painting bake snapshot (see below)
public/data/integrated/         canonical sidecars, generated at deploy time (not committed)
scripts/                        all art-processing and maintenance pipelines
schemas/painting-bake.schema.json
~~~

See [`docs/PIPELINE.md`](docs/PIPELINE.md) and [`docs/INTEGRATION.md`](docs/INTEGRATION.md) for the full map.

### Why `data/baked/` has 15 files and `public/data/baked/` has 988

They are two different things, not a sync gap:

- `public/data/baked/` is the live output of `scripts/bake-shards.js` (one `*.baked.json` per painting record in `public/data/`) and of `scripts/prepare.py` (which writes `<output>/data/baked/`, default output `public/`). Both were run over the full corpus. `scripts/integrate_painting_bakes.py` indexes it as the `perspectiveShardBake` / `unifiedShardField` families.
- `data/baked/` (repo root, outside `public/`) holds 15 files in the same `*.baked.json` format — a partial run written with a non-default output root (`prepare.py --output .`). Nothing reads it: no script, workflow or `src/` code references it, and being outside `public/` it never ships. It is kept only as a historical reference; do not add to it, and regenerate into `public/` instead.

### What ships

`npm run build` copies `public/` into `dist/`, except source material the site never fetches. `public/assets/raw/` holds the full-resolution originals (~1 GB), and every top-level `public/assets/<name>` is a symlink into it (the bake scripts read `public/assets/` through those links). A small Vite plugin in `vite.config.js` (`excludeSourceMaterial`) prunes from `dist/`, after the copy:

- `assets/raw/`, and every `assets/<name>` that is a symlink into `raw/` — except the few images named in `public/graph.json`, which the flat-image fallback in `Scene.jsx` loads;
- any `*.HEIC` / `*.HEIF`;
- everything in `public/data/` except manifest-listed `theater/` files and `integrated/` (`scripts/ship-filter.mjs`). The `art-data` branch is about 2 GB, mostly legacy stroke JSON the runtime never fetches, and GitHub Pages rejects sites over 1 GB; the deployed build is about 60 MB and `deploy.yml` fails if it passes 900 MB.

Nothing is deleted from `public/`; the originals stay on disk for the scripts.

## License

Private. All rights reserved.
