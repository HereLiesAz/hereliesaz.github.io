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

- removed `.github/workflows/process_art.yml`
- removed `.github/workflows/bootstrap.yml`
- removed `scripts/grinder.py` and `scripts/bootstrap.py`
- removed orphaned scripts `indexer.py`, `pareidolia.py`, `curator.py`, `jules.py`, `3d_deconstructor.py`, `prepare.py`, `repair_and_index.py`, and `bake-shards.js`
- removed the retired workflows from the GitHub Pages deploy trigger list
- added `registry/1148736516/policy.json` in `HereLiesAz/workflows`, marking both workflows disabled so the central synchronizer will not recreate their proxies

The old design remains recoverable in `docs/archive/`; executable leftovers do not.

## Still worth checking

- The modal keyboard-focus behavior in `Overlay.jsx` was correct by code inspection but previously had one inconclusive dev-server Tab-focus test. Re-test against a production build when touching accessibility behavior.
- `deploy-sftp.yml` is centrally managed by `HereLiesAz/workflows`; changes to its implementation belong there, not in this repository's proxy.
- `theater_bake.yml` is also a central proxy. Treat the shared workflow implementation and this repository's trigger/proxy as two halves of one pipeline.

## Where to start

- Rendering/shaders: `SHADERS.md` → `src/components/TheaterPainting.jsx`
- Camera/scroll/state: `FRONTEND.md` → `AnamorphicCam.jsx` / `useStore.jsx`
- Bake/index pipeline: `PIPELINE.md` → `scripts/theater_baker.py`
- Day-to-day art changes: `WORKFLOW.md`
- CI/deploy topology: `ARCHITECTURE.md`
