# Handoff

Snapshot of where things stand. For the previous handoff (superseded, kept
for history) see [`archive/HANDOFF-2026-07-03.md`](./archive/HANDOFF-2026-07-03.md).

## Current state

The paper-theater renderer (`TheaterPainting.jsx` + `theater_baker.py` +
`pareidolia_index.py`) is the live, shipped gallery and matches
[`ARCHITECTURE.md`](./ARCHITECTURE.md) / [`FRONTEND.md`](./FRONTEND.md) /
[`SHADERS.md`](./SHADERS.md) / [`PIPELINE.md`](./PIPELINE.md) as of this
writing. Recently stabilized:

- **Depth-band boundaries are a hard discard**, deliberately with no
  opacity antialiasing. An antialiased ramp was tried and reverted — it
  fixed sub-pixel flicker but introduced a static "topographic contour
  map" artifact at every band boundary, because the flats are opaque and
  depth-tested, not alpha-blended (two partial-opacity edges never
  actually combine). See the in-shader comment in `TheaterPainting.jsx`'s
  `flatFS` and [`SHADERS.md`](./SHADERS.md) before touching this again —
  verify any change against real rendered frames at multiple actual
  coalescence points, not a single crop that may not contain a boundary.
- A batch of accessibility, CI-security, and PWA-hygiene fixes landed
  together (keyboard navigation, modal dialog semantics, reduced-motion
  wired into the camera/shader, least-privilege workflow permissions,
  SSH host-key pinning on the SFTP deploy, PWA precache/manifest cleanup,
  supply-chain pinning on the one `git+https` dependency).
- Scene constants (`NULL_DISTANCE`, `PAINTING_HEIGHT`, `CAMERA_FOV_DEG`)
  were deduplicated into `src/sceneConstants.js`; pre-built segment
  placement now recomputes on resize/rotation instead of freezing at
  whatever viewport built it.
- Documentation across the repo was fully audited and rewritten against
  the actual code (this pass) — see "What changed in this doc pass" below.

## Known drift / open threads

- **`process_art.yml` and `bootstrap.yml` still run in CI but produce dead
  output.** The 56-shard `grinder.py` stroke-cloud job and the manual
  `bootstrap.py` job both run SAM-based pipelines from the abandoned
  "shard cloud" design and deploy their output to `art-data` — nothing in
  `src/` reads any of it (`Scene.jsx` only reads the theater tree, falling
  back to the legacy flat `public/graph.json`, never the stroke JSON).
  Turning these off (or deleting the scripts) is a real decision someone
  should make deliberately, not a docs fix — see
  [`PIPELINE.md`](./PIPELINE.md#legacy-scripts-that-still-execute-in-ci).
- **A handful of fully dead scripts remain in `scripts/`** (`indexer.py`,
  `pareidolia.py`, `curator.py`, `jules.py`, `3d_deconstructor.py`,
  `prepare.py`, `repair_and_index.py`, `bake-shards.js`) — confirmed by
  grep to have no live caller. Candidates for deletion in a future
  cleanup, not touched here.
- **`docs/SETUP.md` states "Node.js 18+"**; CI actually runs Node 20
  (`deploy.yml`) and Node 22 (`deploy-sftp.yml`). Minor, worth a follow-up
  fix.
- The modal keyboard-focus behavior (`Overlay.jsx`) was verified correct
  by code inspection but showed one inconclusive result in a dev-server
  Tab-focus test, most likely a Vite HMR-injected-DOM artifact rather than
  a real bug — not independently reproduced in a production build.

## What changed in this doc pass

Every doc under `docs/` was checked against the actual code and rewritten
where it had drifted from or never matched what was built:

- `ARCHITECTURE.md`, `FRONTEND.md`, `SHADERS.md`, `PIPELINE.md` — full
  rewrites; previously described an abandoned SAM/DINOv2/particle-cloud
  design that was never implemented.
- `README.md` (root) and `docs/README.md` — full rewrites for the same
  reason, plus corrected doc links and quick-start commands.
- `AESTHETIC.md` §8 — rewritten to describe the paper-theater primitive as
  actually built (no backdrop plane, no blotch/stroke library, real
  photograph pixels not synthesized marks), and extended with the
  fulcrum-reveal, shard-wipe, and background-sweep mechanics that exist in
  the shipped renderer but were undocumented anywhere. §1–7 (the closet
  premise, palette law, mark vocabulary as UI chrome, type/signature) were
  left as-is — still an accurate creative contract.
- `WORKFLOW.md` and `SETUP.md` were reviewed and found largely accurate
  already (a prior pass had fixed the worst of their drift); only the
  Node-version note above remains open.
- Eight early planning/spec documents describing designs that were
  explored and abandoned before or during implementation (a shard-cloud
  Next.js renderer, DINOv2/YOLO matching, an earlier "unified field"
  design, a stale mid-rework session handoff) were moved to
  `docs/archive/` with an explanatory index rather than deleted, so the
  design history stays recoverable.
- `AGENTS.md` — left untouched aside from a pointer to `ARCHITECTURE.md`;
  it's the original creative brief and still describes the intended
  experience accurately, just not the implementation mechanism.

## Where to start

- Rendering/shader work: [`SHADERS.md`](./SHADERS.md), then
  `TheaterPainting.jsx`.
- Camera/scroll/state work: [`FRONTEND.md`](./FRONTEND.md)'s
  `AnamorphicCam.jsx` and `useStore.jsx` sections.
- Pipeline/bake work: [`PIPELINE.md`](./PIPELINE.md), then
  [`WORKFLOW.md`](./WORKFLOW.md) for how to run it.
- CI/deploy work: [`ARCHITECTURE.md`](./ARCHITECTURE.md)'s CI/CD section.
