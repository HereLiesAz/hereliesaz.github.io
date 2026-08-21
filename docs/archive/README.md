# Archive — superseded planning documents

Everything under `docs/archive/` describes an approach that was explored
and then **abandoned before or during implementation**. None of it
describes the system as it exists today. It is kept for the historical
record of how the design evolved, not as a reference for working on the
current codebase.

For the current architecture, see [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## What's here, and why it's stale

- **`blueprint.md`**, **`ProjectOverview.md`**, **`todo.md`** — early
  construction blueprints for a "shard cloud" renderer: `InstancedMesh`
  point clouds of thousands of per-painting "strokes", positioned via
  inverse perspective projection, matched across paintings with DINOv2
  embeddings and a YOLO/fine-tuned-DINO face detector, built on Next.js
  with glTF/Draco geometry and KTX2 textures. **None of this was built.**
  The actual renderer (`src/components/TheaterPainting.jsx`) uses a small,
  fixed number of flat depth-band cutout planes per painting — a "paper
  theater" of ~6-18 cardboard layers, not a particle cloud — matched
  across paintings by direct multi-scale template matching on the depth
  map (`scripts/pareidolia_index.py`), not a learned embedding model. The
  frontend is a plain Vite + React app, not Next.js.

- **`research.md`** — an early research survey of candidate techniques
  (SAM automatic mask generation, the DStroke brushstroke algorithm, Deep
  Image Analogy / LPIPS / DreamSim for cross-painting correspondence,
  ZoeDepth, floating-origin rebasing, `MeshTransmissionMaterial`
  glassmorphism). Background reading from before the approach was
  settled, not a description of anything shipped. The system that was
  actually built uses OpenCV template matching (not Deep Image Analogy),
  Depth-Anything-V2 (not ZoeDepth), and a plain translucent-black scrim
  for UI surfaces (not real-time refraction).

- **`superpowers/`** — a dated (2026-03-20) implementation plan and
  design spec for a still-earlier iteration of the shard-cloud idea (a
  single unified `InstancedBufferGeometry` field, driven by a
  `superpowers`-tool-orchestrated subagent workflow). Superseded by the
  same paper-theater rework that superseded the docs above.

- **`HANDOFF-2026-07-03.md`** — a session handoff snapshot from partway
  through the paper-theater rework. Everything in its "in flight /
  remaining" section (the 3-painting dark bake, the backdrop-doubling
  question, `goBackward()` dead code, the fitScale mismatch) has since
  been finished, decided, or fixed. Kept for the historical record of
  that session; superseded by `../HANDOFF.md`, kept current.

## What replaced it

The paintings-as-navigation concept, the pareidolia hinge transitions,
and the anamorphic "sweet spot" idea are all still the core of the site —
those parts of the original vision (see `../../AGENTS.md`) were realized.
What changed is the *mechanism*: depth-band cardboard-cutout layers
instead of a particle cloud, direct depth/color template matching instead
of a learned embedding graph, and a from-scratch Python pipeline
(`theater_baker.py`, `pareidolia_index.py`) instead of the SAM/DINOv2/
ZoeDepth stack described in these documents.

See `../ARCHITECTURE.md`, `../FRONTEND.md`, `../SHADERS.md`, and
`../PIPELINE.md` for how it actually works, and `../WORKFLOW.md` for how
to run it.
