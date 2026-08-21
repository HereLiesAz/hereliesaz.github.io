# HereLiesAz — Paper Theater Gallery

> A 3D "paper theater" art gallery. Each painting is baked into a dense
> stack of depth-band cutout layers that reassemble into the full image
> only from one exact camera position — its null — and part into drifting,
> parallaxed cut-paper shards everywhere else. Paintings are chained by a
> "pareidolia hinge": a patch that reads as part of both the outgoing and
> incoming painting at once, so the camera dives through it and the scene
> transforms without a visible cut.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design: data
  model, render pipeline, camera/state, CI/CD topology, security posture.
- [`docs/FRONTEND.md`](docs/FRONTEND.md) — the React/R3F application,
  component by component.
- [`docs/SHADERS.md`](docs/SHADERS.md) — the GLSL depth-band cutout and
  background-sweep shaders.
- [`docs/PIPELINE.md`](docs/PIPELINE.md) — the Python bake pipeline
  (`theater_baker.py`, `pareidolia_index.py`, `validate_output.py`)
  script by script.
- [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — how to run the pipeline by
  hand, and what each CI workflow does.
- [`docs/SETUP.md`](docs/SETUP.md) — installing the Python and Node
  environments.
- [`docs/AESTHETIC.md`](docs/AESTHETIC.md) — the creative brief this all
  serves.
- [`docs/archive/`](docs/archive/) — superseded planning docs from
  earlier, abandoned design directions (a particle "shard cloud" renderer,
  Next.js, DINOv2 embeddings) — historical record only, not current.

## Quick start

### Frontend

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # static site in dist/; art data is fetched at runtime
                   # from the art-data branch, not bundled
```

### Backend (baking new art)

```bash
pip install -r scripts/requirements.txt

python3 scripts/theater_baker.py \
    --input  public/assets/ \
    --output public/data/theater/ \
    --ids id1,id2,...

python3 scripts/pareidolia_index.py --data public/data/theater/
python3 scripts/validate_output.py --dir public/data/theater
```

See [`docs/WORKFLOW.md`](docs/WORKFLOW.md) for the full pipeline
(including the CI-driven version) and [`docs/SETUP.md`](docs/SETUP.md)
for environment setup.

## Project structure

```
public/assets/            source photos (flat directory, no raw/processed split)
public/data/theater/      baked painting/depth/metadata + the hinge graph (art-data branch)
scripts/                  Python bake pipeline — see docs/PIPELINE.md
src/
├── main.jsx               entry point
├── App.jsx                boot screen, WebGL context-loss handling
├── sceneConstants.js       shared NULL_DISTANCE / PAINTING_HEIGHT / CAMERA_FOV_DEG
├── store/useStore.jsx      Zustand: graph walk, hinge placement
├── utils/Logger.js         console hijack + crash reporting
└── components/             every R3F/DOM component, shaders included inline
                             (no separate src/canvas/, src/shaders/, or src/ui/)
```

## License

Private. All rights reserved.
