# AGENTS.md — working in this repo

HereLiesAz's portfolio: a Vite + React + react-three-fiber gallery that
flies through paintings torn into depth layers ("paper theater"), plus an
offline Python bake pipeline and a small native Android admin app. The
creative brief lives in [`docs/AESTHETIC.md`](docs/AESTHETIC.md) (appendix);
the system design in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Start
from [`docs/README.md`](docs/README.md) for the full doc index.

## Commands

~~~bash
npm ci                 # install exact lockfile deps (Node 20, as in CI)
npm run dev            # dev server on http://localhost:3000
npm run build          # production build into dist/
npm run verify         # THE GATE — see below
npm run verify-assets  # just the fallback-graph image check
node scripts/verify-assets.cjs --fix   # regenerate public/graph.json from files on disk

pip install -r scripts/requirements.txt              # full ML stack for the pipelines
pip install -r scripts/verification-requirements.txt # what the verify gate needs: jsonschema, Pillow, numpy, OpenCV
python3 -m unittest scripts/test_integrate_painting_bakes.py scripts/test_check_no_shrink.py scripts/test_validate_output.py
python3 -m unittest scripts/test_pareidolia_incremental.py scripts/test_theater_baker_guards.py   # need numpy + OpenCV
node --test scripts/test-ship-filter.mjs
~~~

## Verify gate

`npm run verify` (`scripts/verify-repo.mjs`) must pass before you push. It
runs, in order:

1. `py_compile` over every Python file in `scripts/` (and any root-level
   pipeline entrypoints present);
2. the Python unit tests: integration builder, manifest guard, output
   validator, and (when numpy/OpenCV are installed; CI requires them) the
   hinge-graph and baker tests;
3. the ship filter's unit tests (`node --test`);
4. `scripts/verify-tokens.mjs` — the design tokens in `src/tokens.css`,
   `AdminUi.kt`, `themes.xml` and both manifests agree;
5. `scripts/verify-assets.cjs` — every `public/graph.json` node image must
   exist in `public/assets/`;
6. `npm run build`.

It needs no art data, so it works in a plain source checkout. CI
(`.github/workflows/deploy.yml`) runs the same gate, on pull requests too
(verify and build only, never publish), after staging `art-data`, plus
deploy-only steps: it fails if
`public/data/theater/_manifest.json` is missing, regenerates
`public/data/integrated/` from scratch (`--strict`) and validates it
against `schemas/painting-bake.schema.json`.

There is no JS linter and no browser test suite; don't invent one in passing.
The only JS tests are `node --test` files for build tooling
(`scripts/test-ship-filter.mjs`).

## Branches and art data

- **`main`** holds source only. Deploys run on every push to `main`.
- **`art-data`** (orphan branch) holds the baked corpus:
  `theater/*.painting.webp|depth.png|theater.json|masks.png`,
  `theater/graph.theater.json`, `theater/_manifest.json`, and the stroke
  grinder output. Bake workflows publish to it with `keep_files: true` so
  each pipeline layers onto the others instead of overwriting them.
- `deploy.yml` checks out `art-data` **into `public/data/`** at build time,
  so baked data is served from the same origin as the site.
- Never commit theater bake outputs to `main` — `.gitignore` blocks them,
  and `/public/data/theater` may be a local symlink. To build or run
  locally with the real corpus, add a worktree and link it:

  ~~~bash
  git fetch origin art-data
  git worktree add ../art-data art-data
  ln -s ../../../art-data/theater public/data/theater
  ~~~

- `public/data/*.json` and `public/data/baked/` (legacy stroke/shard
  records) **are** tracked on `main`; they are inputs to the integrator.
  `data/baked/` at the repo root is an unused 15-file snapshot (see the
  root README).
- `public/meta.json`, `public/band-overrides.json` and
  `public/site-content.json` are hand-authored and edited by the `/admin`
  app via the GitHub Contents API — keep them valid JSON.

## Source material vs. what ships

`public/assets/raw/` holds full-resolution originals and every top-level
`public/assets/<name>` is a symlink into it. Do **not** delete or rewrite
originals. The Vite plugin `excludeSourceMaterial` in `vite.config.js`
prunes `raw/`, the symlinked originals (except images named in
`public/graph.json`), HEICs and loose images in `public/data/` from
`dist/`, and `scripts/ship-filter.mjs` drops everything in `public/data/`
except manifest-listed `theater/` files and `integrated/` (the `art-data`
branch is about 2 GB; Pages rejects sites over 1 GB). If you add a runtime dependency on an original, add it to the
fallback graph or adjust that plugin.

## Pipelines (scripts/)

See [`docs/PIPELINE.md`](docs/PIPELINE.md) and
[`docs/WORKFLOW.md`](docs/WORKFLOW.md) for details.

| Pipeline | Entry point | CI | Output |
| --- | --- | --- | --- |
| Paper theater (production) | `theater_baker.py` → `pareidolia_index.py` → `validate_output.py` → `check_no_shrink.py` | `theater_bake.yml` (proxy; runs in `HereLiesAz/workflows`) | `art-data:theater/` |
| Stroke grinder | `grinder.py` (SAM + depth, 56-way sharded) | none on `main` today (`process_art.yml` is retired in the registry) | `art-data` stroke JSON |
| Bootstrap sample | `bootstrap.py` | none on `main` today (`bootstrap.yml` is retired) | `art-data` |
| Unified shard field | `prepare.py` + `shard_prep/` | manual | `public/data/baked/`, `public/graph.json` |
| Perspective shard bake | `bake-shards.js` | manual | `public/data/baked/` |
| Curator semantic shards | `curator.py` | manual | `public/data/` + `.bin` buffers |
| Semantic layers | `3d_deconstructor.py` | manual | layered slices |
| Integration | `integrate_painting_bakes.py`, `validate_integrated_records.py` | `deploy.yml` | `public/data/integrated/` (deploy-time only) |
| Admin removal | — | `remove_painting.yml` (proxy; central) | prunes `art-data` |
| Android publish | — | `publish_admin_staging.yml` (proxy; central) | bakes, removes, merges `admin-staging` into `main` |
| Duplicate scan | `dedup_scan.py` (read-only) | `dedup_scan.yml` (proxy; central) | report for the Android Dedup tab |

Every listed pipeline is intentional, even when nothing currently consumes
its output. Do not delete a script because grep finds no caller — removal
needs an explicit decision from Az (see `docs/ARCHITECTURE.md`, "Script
status policy"). `scripts/deduplicate.py` deletes files; never run it as
a routine step.

Workflows marked `centralized-by: HereLiesAz/workflows` are thin proxies;
their real bodies live in that repo. Third-party actions are pinned to
commit SHAs (tag in a trailing comment) — keep it that way when bumping.

## Android admin app (`app/`)

Native Kotlin/Compose client; see
[`docs/ANDROID_ADMIN.md`](docs/ANDROID_ADMIN.md). `./gradlew` is a
checksum-verifying bootstrapper, not the stock wrapper. Release builds fail
without the `ANDROID_KEY*` signing env vars.

## Conventions

- Match the surrounding style. Comments explain *why*; many files carry
  long rationale comments — keep them accurate when you change behaviour.
- Update docs alongside code. Markdown code blocks use `~~~` fences.
- Renderer invariants (axis-aligned nulls, hard-discard bands, atomic
  `updateFrame`, stationary shards with all motion from the camera,
  reduced-motion support) are listed in `docs/ARCHITECTURE.md`; preserve
  them.
- `index.html` has a CSP with no inline script: the Google tag loads from
  `src/analytics.js` on public routes only, and opening `/admin` adds a
  stricter policy (`src/admin/lockdown.js`) because the admin keeps a
  write-scoped GitHub token in the origin's localStorage. Don't add
  third-party scripts to `/admin`.
- Colours, type, motion and hit size come from `src/tokens.css`; see
  `docs/AESTHETIC.md` section 9.

<!-- entire-agent:begin -->
Read .entire/agent-guide.md for this repository's workflow, source inspection, and verification guidance.
@.entire/agent-guide.md
<!-- entire-agent:end -->
