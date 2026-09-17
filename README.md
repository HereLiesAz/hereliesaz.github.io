# HereLiesAz — Multi-Pipeline 3D Gallery

> A 3D art gallery built from several intentional representations of the same paintings: paper-theater depth layers, stroke clouds, painterly anamorphic shards, semantic shards/layers, and flat-image fallbacks. The current shipped renderer is the paper-theater path; the other pipelines remain first-class capabilities and are indexed through a canonical integration layer rather than treated as disposable legacy code.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design and CI/CD topology.
- [`docs/FRONTEND.md`](docs/FRONTEND.md) — the React/R3F application.
- [`docs/SHADERS.md`](docs/SHADERS.md) — current theater shaders.
- [`docs/PIPELINE.md`](docs/PIPELINE.md) — all intentional art-processing pipelines and their native outputs.
- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — canonical multi-pipeline sidecar contract and runtime discovery.
- [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — workflow execution details.
- [`docs/SETUP.md`](docs/SETUP.md) — environment setup.
- [`docs/AESTHETIC.md`](docs/AESTHETIC.md) — creative brief.
- [`docs/archive/`](docs/archive/) — earlier design/spec snapshots. Archive placement means historical/superseded documentation, not that the capabilities described there are automatically unwanted.

## Quick start

### Frontend

```bash
npm install
npm run dev
npm run build
```

### Paper Theater

```bash
pip install -r scripts/requirements.txt
python3 scripts/theater_baker.py --input public/assets/ --output public/data/theater/ --ids id1,id2,...
python3 scripts/pareidolia_index.py --data public/data/theater/
python3 scripts/validate_output.py --dir public/data/theater
```

### Canonical integration

```bash
python3 -m unittest scripts/test_integrate_painting_bakes.py
python3 scripts/integrate_painting_bakes.py --public-root public
```

The integrator preserves native artifacts and writes additive sidecars under `public/data/integrated/`. Runtime helpers live in `src/utils/paintingBake.js`.

## Project structure

```text
public/assets/                  source artwork corpus
public/data/theater/            paper-theater output
public/data/baked/              shard/layer bake families
public/data/integrated/         generated canonical sidecars
scripts/                        all art-processing and maintenance pipelines
schemas/painting-bake.schema.json
src/utils/paintingBake.js       runtime canonical-record loader
```

See [`docs/PIPELINE.md`](docs/PIPELINE.md) and [`docs/INTEGRATION.md`](docs/INTEGRATION.md) for the full map.

## License

Private. All rights reserved.
