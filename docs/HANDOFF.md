# Handoff

Current snapshot of `main`.

## Live system

The shipped gallery is the paper-theater renderer:

- `scripts/theater_baker.py` bakes each painting into a cropped painting texture, depth map, and depth-band metadata.
- `scripts/pareidolia_index.py` builds the sparse hinge graph used to move between paintings.
- `scripts/validate_output.py` gates publication.
- `src/components/TheaterPainting.jsx` renders the depth-band cutouts.
- `src/components/AnamorphicCam.jsx` drives the scroll/camera path.
- `src/store/useStore.jsx` owns graph walking, placement, and transition state.
- `/admin` writes content directly through the GitHub API and dispatches the live bake/removal workflows.

See `ARCHITECTURE.md`, `FRONTEND.md`, `SHADERS.md`, and `PIPELINE.md` for the details.

## September 2026 cleanup

The abandoned shard-cloud pipeline has been retired instead of merely documented as dead:

- removed `.github/workflows/process_art.yml` and `.github/workflows/bootstrap.yml`
- removed `scripts/grinder.py`, `bootstrap.py`, `indexer.py`, `pareidolia.py`, `curator.py`, `jules.py`, `3d_deconstructor.py`, `prepare.py`, `repair_and_index.py`, and `bake-shards.js`
- removed the entire orphaned `scripts/shard_prep/` package and its tests; its only live caller was the deleted `prepare.py`
- removed the retired workflows from the GitHub Pages deploy trigger list
- removed four generic Android workflows that could not run here because this repository has no Gradle/native Android project
- removed the sample Jekyll and static-`docs/` Pages workflows that competed with the actual Vite gallery deployment
- updated `registry/1148736516/policy.json` in `HereLiesAz/workflows` so the central synchronizer treats all of those workflows as intentionally disabled instead of recreating them
- removed legacy grinder assumptions from the `/admin` painting-removal path

The old design remains recoverable in `docs/archive/`; executable leftovers do not.

## Still worth checking

- The modal keyboard-focus behavior in `Overlay.jsx` was correct by code inspection but previously had one inconclusive dev-server Tab-focus test. Re-test against a production build when touching accessibility behavior.
- `deploy-sftp.yml` is centrally managed by `HereLiesAz/workflows`; changes to its implementation belong there, not in this repository's proxy.
- `theater_bake.yml` is also a central proxy. Treat the shared workflow implementation and this repository's trigger/proxy as two halves of one pipeline.
- `scripts/theater_baker.py` still has an old docstring line naming `process_art.yml`; it is commentary only, not a caller. Remove it the next time that large file is edited.

## Where to start

- Rendering/shaders: `SHADERS.md` → `src/components/TheaterPainting.jsx`
- Camera/scroll/state: `FRONTEND.md` → `AnamorphicCam.jsx` / `useStore.jsx`
- Bake/index pipeline: `PIPELINE.md` → `scripts/theater_baker.py`
- Day-to-day art changes: `WORKFLOW.md`
- CI/deploy topology: `ARCHITECTURE.md`
