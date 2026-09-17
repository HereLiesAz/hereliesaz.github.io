# Setup

## Frontend

Use Node.js 20 or newer.

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

GitHub Pages deployment currently uses Node 20.

## Python art pipeline

Use the dependency file under `scripts/`:

```bash
pip install -r scripts/requirements.txt
```

The live Python pipeline consists of:

- `scripts/theater_baker.py`
- `scripts/pareidolia_index.py`
- `scripts/validate_output.py`

`theater_baker.py` may use Hugging Face-hosted models. Set `HF_TOKEN` when required by the selected stage/provider. The script also reads `.env.local` at the project root when present.

Example targeted bake:

```bash
python3 scripts/theater_baker.py \
  --input public/assets/ \
  --output public/data/theater/ \
  --ids id1,id2
```

Then rebuild the hinge graph and validate output using the corresponding scripts. Run each script with `--help` for its current CLI.

## Production data

Production theater assets live on the orphan `art-data` branch rather than `main`. Deploy workflows check that branch out into `public/data` before building the site.

A local frontend checkout without `public/data/theater/` can still exercise fallback behavior, but it is not a production-faithful dataset.

## Admin

`/admin` is a browser-only GitHub-backed content manager. It requires a fine-grained GitHub personal access token scoped to `HereLiesAz/hereliesaz.github.io` with the repository permissions described in the admin UI.

The token is stored in browser `localStorage` and sent directly to `api.github.com`; there is no application backend holding it.

## Centralized workflows

Several repository workflows are secretless proxies managed by `HereLiesAz/workflows`, including Theater Bake and the SFTP deploy. Their implementation and service secrets live in the central workflows repository.

The retired `process_art.yml` and `bootstrap.yml` workflows are explicitly disabled by the central registry policy and no longer exist in this repository.
