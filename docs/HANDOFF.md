# HANDOFF — Paper-Theater Rework (2026-07-03)

Session handoff for the rework on branch
`claude/video-analysis-website-goals-j75jyd`. Read this top to bottom
before touching anything.

> **Status update:** PR #37 (all code below) was MERGED to main by the
> user on 2026-07-03. The branch was restarted from the merged main for
> follow-up work; any further push needs a NEW pull request. Remaining
> work when this note was written: finish the 3 dark-painting bake
> (quota-retry loop), run `pareidolia_index.py`, commit the refreshed
> `_manifest.json` (the merged one is stale — it lists the three removed
> ids), screenshot pass, show the user.

## The brief (user directives, in order given)

1. A reference video (an artist finger-scrubbing a hand-drawn flipbook of
   Saitama on an iPad — kinetic frames, staged depth) is the target
   experience. The site's concept already matched; the delivery did not.
2. **"We don't need linework. We need layers like a paper theater."**
3. **Scope: get it right with 2-3 paintings before baking more.** No
   corpus bake, no CI bake.
4. Depth must be real: **crop the painting → convert it to a
   photorealistic image (img2img) → run monocular depth on the photo →
   apply the depth map to the original painting.**
5. **Data model per painting: exactly the painting + its depth map.**
   (Plus tiny band metadata. No masks, no per-layer textures.)
6. The pareidolia graph IS needed — but "pareidolia" means a **shared
   patch that reads as part of BOTH the previous and next paintings'
   subjects at the same time**, not literally faces.
7. Camera language from the video: aggressive push-ins, close sweeps,
   pull-back reveals, and — key — **the camera always points at one
   central point while moving, as if traveling the surfaces of nested
   spheres ("bubbles") that share a core.**
8. The three originally-baked images (sketchbook, park sculpture,
   dumpster) are **out**. Bake 3 replacements **with darker backgrounds**
   (chosen, see below).
9. Show results (screenshots) to the user promptly whenever there's
   something to see.

## What's done (all on this branch)

- `scripts/theater_baker.py` — rewritten. Cacheable stages per id:
  painting.webp (crop/resize, reuses existing file as canonical) →
  photo.png (FLUX.1-Kontext img2img via HF Inference API if HF_TOKEN,
  else the public Space `mcp-tools/FLUX.1-Kontext-Dev` anonymously; ECC
  affine registration snaps the photo back onto the painting) →
  depth.png (16-bit, Depth-Anything-V2 Space on the photo; falls back to
  depth-on-painting, then synth gradient — provenance recorded in
  theater.json `depth.source`) → schema-2 theater.json with ~3-6 k-means
  depth bands (`depth_bands_kmeans`: merges bands closer than 0.08 depth
  or under 2% coverage). `--ids 'a,b,c'` bakes only those stems.
  masks.png is gone.
- `scripts/pareidolia_index.py` — rewritten as the hinge matcher:
  multi-scale LAB+depth template matching over all ordered pairs →
  `public/data/theater/graph.theater.json` (schemaVersion 5) with edges
  `{source, target, weight, s_uv, t_uv, scale}`.
- `src/components/TheaterPainting.jsx` — rewritten: full-painting
  backdrop plane (1.08 overscan) + one opaque cutout flat per depth band
  (shader discards outside [uBandMin, uBandMax) with value-noise torn
  edges), perspective-compensated scale (reassembles exactly at the
  null), distance fade to black 18→34 units, fly-through cross-fade
  (±1.2 units of camera z). Bone-white envelope deleted. Flat fallback
  for un-baked ids retained.
- `src/store/useStore.jsx` — hinge placement (painting B offset so its
  t_uv coincides with A's s_uv in world xy; nominal painting height 10,
  ignores viewport fitScale ≈0.9 — known small error) + orbital "bubble"
  path: control points on spheres around `segment.focus` (the hinge, or
  B's shell center when no edge), radius R0 → Rmin(4-8) → R1, horizontal-
  biased sweep, per-segment `bank` roll.
- `src/components/AnamorphicCam.jsx` — gaze locked on `segment.focus`,
  hand-off to next segment's focus (fallback `segment.endLook`) over
  r=0.6→0.95, bank roll applied as rotateZ, segment prebuild moved to
  r>0.5 so the gaze target exists early.
- `src/components/Scene.jsx` — loads `_manifest.json` +
  `graph.theater.json` (nodes carry width/height needed for uv→local);
  damping 0.12.
- `docs/AESTHETIC.md` §8.1 updated: depth measured (photo chain) then
  staged; painting+depth data model documented.

## In flight / remaining

1. **Bake of the 3 new dark paintings** (ids:
   `PXL_20230527_000631951~2`, `2023-10-15(38)`, `20231129_043102~2`,
   sources in `public/assets/`). A background retry loop was running:
   bake → check every theater.json has
   `depth.source == "photo+depth-anything-v2"` → reset+wait 300s on
   quota failures. If unfinished, re-run:
   `python3 scripts/theater_baker.py --input public/assets --output
   public/data/theater --ids 'PXL_20230527_000631951~2,2023-10-15(38),20231129_043102~2'`
   (delete an id's depth.png first to redo its depth). ZeroGPU anonymous
   quota (~90s GPU per FLUX call) throttles; waiting ~5 min between
   attempts works. An HF_TOKEN in `.env.local` removes the problem.
2. **After the bake**: `python3 scripts/pareidolia_index.py` to rebuild
   `graph.theater.json` for the new ids.
3. **Verify + show the user** (they asked for results ASAP):
   `npm run dev`, then the Playwright script pattern in
   scratchpad `shoot.mjs`: find the scrollable div (drei ScrollControls),
   set scrollTop fractions (~0 to 0.07 covers two segments), wait ~1.8s
   each, screenshot. Check: head-on reassembly at nulls, orbital sweep
   keeps gaze on a fixed point, flats part with parallax, hinge patch
   holds screen position through a transition, no 404s (one untraced 404
   appeared in the last run — likely favicon; check the network log).
   Send screenshots with SendUserFile.
4. **Commit/push/draft PR** if not already done (bake outputs are
   gitignored — only code/docs commit; that is intentional, deployed
   data lives on the `art-data` orphan branch, and CI rebake is out of
   scope for now).
5. Known rough edges to consider next iteration:
   - Backdrop doubling: the printed-backdrop shows the whole painting,
     so lifted flats double their content against it off-axis. Option:
     dim the backdrop slightly, or inpaint (contradicts painting+depth
     minimalism — ask the user first).
   - The scroll-loop at offset>0.999 snaps to top; untouched.
   - `Overlay.jsx` caption timing unchanged; still keyed to old segment
     rhythm.
   - `goBackward()` still dead code.
   - fitScale vs nominal-height mismatch (~8%) slightly offsets hinge
     alignment; fine at current patch scales.

## Environment notes

- No `gh` CLI — use GitHub MCP tools. Repo scope:
  `hereliesaz/hereliesaz.github.io` only.
- Python deps already installed in-container: opencv-python-headless,
  numpy, Pillow, gradio_client, huggingface_hub, imageio.
- Playwright: use `executablePath: '/opt/pw-browsers/chromium'`,
  `playwright-core` installed in the scratchpad dir.
- The public depth Space works anonymously; FLUX Space is
  quota-throttled anonymously.
- HF MCP `dynamic_space` invoke is disabled server-side (view-only).
