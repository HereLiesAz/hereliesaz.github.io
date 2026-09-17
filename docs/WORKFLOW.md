# Workflow

How to operate the live gallery.

## Add a painting through `/admin`

1. Open `/admin` and authenticate with the repository-scoped GitHub token.
2. Add the source image and metadata.
3. The admin app commits the source under `public/assets/` and dispatches `theater_bake.yml` for that painting id.
4. The central Theater Bake implementation generates the paper-theater assets, hinge graph, validates them, and publishes to `art-data`.
5. `deploy.yml` runs after the bake completes and rebuilds GitHub Pages with the new `art-data` checkout.

The admin UI does not wait synchronously for the bake. “Dispatched” means GitHub accepted the workflow request; the actual bake/deploy continues in Actions.

## Add or rebake from GitHub Actions

Run **Theater Bake** manually and pass a comma-separated `ids` list. Leaving `ids` blank uses the workflow's configured default batch.

Use targeted ids whenever possible. The photorealization/depth stages can consume remote model quota; widening a batch is an operational/cost decision, not merely a convenience.

## Crop corrections

Edit `scripts/crops.json`. A crop-box change triggers Theater Bake through the repository proxy. The baker detects crop changes per id and invalidates the relevant cached stages so the photorealized image and depth remain aligned with the new crop.

## Edit metadata

Use `/admin`. Metadata edits are ordinary `main`-branch content changes and do not require the removed legacy processing pipeline.

## Curate depth bands

Use the band editor under `/admin`. It writes `public/band-overrides.json`.

Band overrides are applied at render time by `src/utils/bandOverrides.js`; they do not modify baked theater data and do not require a rebake.

## Remove a painting

Remove it through `/admin`. The UI batches removals and dispatches `remove_painting.yml`, which updates `art-data`. The Pages deploy watches that workflow and rebuilds the site after completion.

Do not manually fire one removal workflow per id in a burst; the batching logic exists to avoid competing writes to the orphan data branch.

## Local frontend development

```bash
npm install
npm run dev
```

The gallery expects theater data under `public/data/theater/`. For a production-faithful build, populate that directory from the `art-data` branch before building.

```bash
npm run build
```

## Local pipeline development

Install the Python dependencies from `scripts/requirements.txt` and run the baker against selected ids:

```bash
python3 scripts/theater_baker.py \
  --input public/assets/ \
  --output public/data/theater/ \
  --ids id1,id2

python3 scripts/pareidolia_index.py
python3 scripts/validate_output.py
```

Exact CLI options can change; use each script's `--help` when running locally.

## Destructive duplicate cleanup

`scripts/deduplicate.py` is manual and destructive. It can delete perceptually duplicate source files under `public/assets/`. Never wire it into CI and never run it casually.

## Historical pipeline

The old `process_art.yml` / `bootstrap.yml` shard-cloud system and its scripts were removed in September 2026. Do not recreate them from old references. Historical design material is intentionally isolated in `docs/archive/`.
