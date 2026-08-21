# Documentation index

A 3D "paper theater" gallery: each painting bakes into a dense stack of
depth-band cutout layers that reassemble into the full image only from one
exact camera position (its null), and drift apart into parallaxed
cut-paper shards everywhere else. Paintings chain together via a
"pareidolia hinge" — a patch that reads as part of both the outgoing and
incoming painting at once — so the camera dives through it and the scene
transforms without a visible cut.

## Read these

1. [**Architecture**](./ARCHITECTURE.md) — system design: the paper-
   theater data model, render pipeline, camera/scroll/state architecture,
   full CI/CD topology, and security posture.
2. [**Frontend**](./FRONTEND.md) — the React + Zustand + react-three-fiber
   application, component by component.
3. [**Shaders**](./SHADERS.md) — the two GLSL shaders that exist: the
   depth-band cutout/reveal shader and the background-sweep shader,
   including why the band boundary must stay a hard discard.
4. [**Pipeline**](./PIPELINE.md) — the Python bake pipeline
   (`theater_baker.py`, `pareidolia_index.py`, `validate_output.py`)
   script by script, plus what's legacy/dead versus live.
5. [**Workflow**](./WORKFLOW.md) — how to run the pipeline by hand and
   what each CI workflow does end to end.
6. [**Setup**](./SETUP.md) — installing the Python and Node environments.
7. [**Aesthetic**](./AESTHETIC.md) — the creative brief this system serves.
8. [**Handoff**](./HANDOFF.md) — current state, open threads, next steps.

[`archive/`](./archive/) holds superseded planning documents from earlier,
abandoned design directions — kept for history, not a reference for the
current codebase (`archive/README.md` explains what changed and why).

## Quick start

```bash
# Frontend
npm install
npm run dev              # http://localhost:5173

# Backend (bake pipeline)
pip install -r scripts/requirements.txt
python3 scripts/theater_baker.py --input public/assets/ --output public/data/theater/ --ids id1,id2
python3 scripts/pareidolia_index.py --data public/data/theater/
python3 scripts/validate_output.py --dir public/data/theater
```

See [`WORKFLOW.md`](./WORKFLOW.md) and [`SETUP.md`](./SETUP.md) for the
full picture, including the CI-driven version of this same chain.
