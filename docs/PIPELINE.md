# Asset Pipeline

Python scripts under `scripts/`, orchestrated by three independent GitHub
Actions workflows. Only one chain — the **theater bake** — produces data
the deployed frontend actually reads. The other two workflows still run
in CI on every trigger but their output is dead weight, kept only because
turning them off is a separate decision from documenting them honestly.
See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the CI topology and
[`WORKFLOW.md`](./WORKFLOW.md) for how to run any of this by hand.

## The live chain: theater bake

`theater_bake.yml` runs `theater_baker.py` → `pareidolia_index.py` →
`validate_output.py`, seeded from the `art-data` branch (so already-baked
paintings are cache hits, not re-computed), then deploys
`public/data/theater/` to `art-data` via `peaceiris/actions-gh-pages`
(`keep_files: true`, so it never clobbers what `process_art.yml` or
`bootstrap.yml` deploy alongside it). Triggered manually
(`workflow_dispatch`, with an optional `ids` input) or by a push to
`scripts/crops.json` or the workflow file itself, defaulting to a fixed
`DEFAULT_IDS` batch. `deploy.yml`/`deploy-sftp.yml` pick the result up via
a `workflow_run` trigger.

### 1. `scripts/theater_baker.py` — painting + depth baker (schema 2)

Per painting, four cacheable stages — each is skipped if its output
already exists, so the expensive off-device calls run once and slicing
iteration is offline:

| Stage | Input → Output | What happens |
|---|---|---|
| A. crop | source image → `{id}.painting.webp` | Hand-authored box from `crops.json` when present, else the saturation/structure heuristic `crop_to_art()` (border vs. centre saturation contrast → largest high-saturation bounding rect). Resized to `--max-side` (default 768). |
| B. photo | painting → `{id}.photo.png` | `photorealize()`: img2img via FLUX.1-Kontext (HF Inference API if `HF_TOKEN` is set, else the public Space anonymously), then `align_to()` re-registers it onto the painting with an ECC affine warp (img2img reframes slightly). Depth models are photo-trained and flatten stylised paintings, so depth is estimated from this photo, not the painting directly. |
| C. depth | photo (or painting, if B failed) → `{id}.depth.png` (16-bit) | `estimate_depth_local()` — Depth-Anything-V2-Small run locally via `transformers`/CPU — is the primary path (no rate limit, no shared quota). Falls back to the hosted Space (`estimate_depth()`), then to `synth_depth()` (a vertical-gradient + saturation stand-in) as a last resort. `depth.source` in the output JSON records which one actually ran; `"synthetic"` is a documented emergency-only value that `validate_output.py` hard-rejects before deploy. |
| D. meta | depth → `{id}.theater.json` | `depth_bands_kmeans()` clusters the depth histogram into up to `N_BANDS` (18) bands via `cv2.kmeans`, merges bands under `MIN_BAND_COVER` (0.8% of pixels) or closer than `MIN_BAND_SEP` (0.025) apart, and writes edges/centers. Also runs `color_clusters()` (8-band dark→light palette) and `pick_accents()` (saturated swatches for the UI). |

Plus once per run: `_manifest.json` (ids with all three companion files
present — the frontend's actual "what's shipped" list; see `write_manifest()`).

Two correctness details worth knowing before touching this file:

- **`KMEANS_SEED` (20260214).** `cv2.kmeans()` draws its initial centers
  from OpenCV's process-global RNG, never reseeded between calls — so a
  given image's band edges used to depend on how many *other*
  `cv2.kmeans()` calls happened earlier in the same process, i.e. on
  batch order, not on that image's own pixels. `cv2.setRNGSeed(KMEANS_SEED)`
  runs immediately before every `cv2.kmeans()` call to kill that
  dependency. Don't remove it without re-verifying batch-order-independence.
- **Crop-change cache invalidation.** `bake_image()` compares the crop
  directive recorded in the *previous* `{id}.theater.json` against the
  current one (from `crops.json`); a change forces re-crop and — via
  `photorealize(..., force=force or crop_changed)` — re-photorealize and
  re-derive depth for just that id, so a moved crop box can't silently
  keep serving photo/depth content registered to the old composition.

### 2. `scripts/pareidolia_index.py` — hinge graph builder

Not face detection — "pareidolia" here means a patch that reads as part
of *both* the previous and next painting at once, the spot the camera
dives through on a transition. For every ordered pair `(A, B)` of baked
paintings, `best_hinge()` searches a 9×9 grid at three patch scales
(`PATCH_SCALES = (0.20, 0.30, 0.42)`, as a fraction of `min(width, height)`)
for the window in A that is:

1. **Salient** in A (`saliency_map()` — spectral-residual saliency +
   colour distinctiveness; below `MIN_SALIENCY` skips the candidate
   outright — flat field has nothing to hinge on),
2. **Similar** to some window of B, matched with `cv2.matchTemplate`
   (`TM_CCOEFF_NORMED`) on a weighted blend of LAB colour (0.45),
   Sobel-gradient structure (0.40), and depth (0.15),
3. **Salient in B** at the matched location too (biased toward B's
   `subject_mask()` — the largest connected high-saliency blob — so the
   reveal lands on B's actual subject, not incidental background).

The winning score is the structural similarity times the geometric mean
of both endpoints' subject membership — a hinge only scores well when
it's a resonant feature on *both* sides. Output: `graph.theater.json`
(`schemaVersion: 5`), `edges: [{source, target, weight, s_uv, t_uv, scale}]`
— `s_uv`/`t_uv` are the patch centres in normalized image coordinates,
`scale` is the patch edge as a fraction of the painting's min dimension.
The frontend (`useStore.jsx`) places painting B so its `t_uv` point
coincides in world space with A's `s_uv` point, and `TheaterPainting.jsx`
reads `scale` for the fulcrum-reveal patch radius.

**Why most pairs get no edge at all.** An earlier version had no
acceptance floor and produced a *complete* directed graph (every pair
scored, 1560 edges on the real 40-painting corpus = 40×39, every possible
edge) with 99.4% of winners locked onto the smallest patch scale — because
`TM_CCOEFF_NORMED`'s variance under a non-match shrinks with window size,
so smaller windows produce higher, more easily spurious correlation peaks
purely by construction, regardless of whether the match is structurally
real. The fix (both parts still live in the code, see the long comment at
the top of the file for the calibration data):

- `scale_bias = (frac / SCALE_BIAS_REF) ** 0.5` discounts each scale's raw
  similarity before ranking/thresholding — the `1/√n` behaviour of a
  correlation coefficient's standard error — so smaller windows can't win
  by default.
- `MIN_SIM = 0.45` is a floor on the *scale-corrected* similarity,
  calibrated against the real corpus to keep roughly the top third of
  candidates. Net effect: most `(sid, tid)` pairs get **no edge**
  (`best_hinge()` returns `None`) instead of a complete graph —
  `validate_output.py` asserts this (`len(edges) < n*(n-1)`) as a CI
  regression guard against the old behaviour coming back.

### 3. `scripts/validate_output.py` — the CI gate

`python scripts/validate_output.py --dir public/data/theater`, run as a
non-`continue-on-error` step in `theater_bake.yml` right before the
`art-data` deploy — a failure here blocks the deploy outright. Its CLI
contract (`--dir`, exit code) is fixed and depended on by the workflow;
don't change the interface without updating both.

Checks, against every id `_manifest.json` actually lists (not every stray
`*.theater.json` file in the directory — an id present on disk but not in
the manifest is reported as an informational orphan note, not a failure,
since the frontend never fetches it):

- `{id}.theater.json` has `schema`, `src.width`/`src.height`,
  non-empty `depth.bands.centers`, and `depth.bands.edges` that are
  numeric, in `[0,1]`, monotonically non-decreasing, and `len(edges) ==
  len(centers) + 1` — a malformed edge either renders an empty band or
  lets one band's cutout bleed into a neighbour's, silently, in
  `TheaterPainting.jsx`'s shader.
- `depth.source != "synthetic"` — the emergency-only stand-in must never
  reach `art-data` undetected.
- All three companion files (`.painting.webp`, `.depth.png`,
  `.theater.json`) actually exist for every manifest-listed id — catches
  a torn/partial write.
- `graph.theater.json`: correct `schemaVersion` (5), every edge's
  `source`/`target` is a real node id, `weight` is a sane finite float in
  `[-1, 1]`, `s_uv`/`t_uv` are 2-element `[0,1]`-range pairs (these are
  exactly what `useStore.jsx`'s placement math consumes — a malformed
  value here doesn't fail loudly in the frontend, it silently misplaces
  or, via a `NaN`, permanently freezes the camera dive for that edge),
  `scale` is in `(0, 1]`, and the graph is **not complete** (the
  regression guard described above).

## Supporting files

- **`scripts/crops.json`** — hand-authored per-image crop boxes (`[x0, y0,
  x1, y1]`, normalized, or `null` to keep the full frame). Ids with no
  entry fall back to `theater_baker.py`'s heuristic crop. A push to this
  file is one of `theater_bake.yml`'s two triggers.
- **`scripts/requirements.txt`** — pinned dependencies for every Python
  script. The `git+https://github.com/facebookresearch/segment-anything.git`
  install is pinned to a specific commit SHA (supply-chain hardening); the
  rest of the ML stack (torch, transformers, opencv, etc.) is intentionally
  left floating — pinning it blind without a GPU-runner end-to-end bake to
  verify compatibility is a bigger risk than the exposure it would close.
- **`scripts/verify-assets.cjs`** (`npm run verify-assets`) — a Node build-
  time safety net, unrelated to the theater pipeline. It validates and
  repairs `public/graph.json` (the frontend's *legacy* flat-texture
  fallback graph, still committed and still read by `Scene.jsx` when a
  theater bake is unavailable) against what's actually present in
  `public/assets/`: drops nodes with no matching asset file and re-links
  the graph's edges around each dropped node so the walk doesn't dead-end.
  Runs in `deploy.yml` and `deploy-sftp.yml` before every deploy.
- **`scripts/deduplicate.py`** — a manual "janitor" tool for
  `public/assets/`: perceptual-hashes every source image, groups visual
  duplicates, and deletes all but the highest-resolution copy of each
  group. Not wired into any CI workflow — it deletes files the bake
  pipeline keys off of by filename stem (`theater_bake.yml`'s
  `DEFAULT_IDS`, `crops.json`), so it's meant to be run deliberately by a
  human, not as a routine step.

## Legacy scripts that still execute in CI

Two scripts run in CI on every trigger of their workflow but write output
nothing in `src/` reads any more — superseded by the theater pipeline
above, not yet removed:

- **`scripts/grinder.py`**, via `process_art.yml`'s 56-shard `grind`
  matrix job (triggered by pushes touching `public/assets/**`,
  `scripts/grinder.py`, `scripts/indexer.py`, or `scripts/requirements.txt`).
  Runs SAM (`segment-anything`) + ZoeDepth/MiDaS to produce a stroke-cloud
  JSON per image (the abandoned "shard cloud" renderer's data format —
  see `docs/archive/`). The `consolidate` job deploys this output to
  `art-data` alongside the real theater data (`keep_files: true`
  prevents it from clobbering `theater/`), but the frontend's data-loading
  effect (`Scene.jsx`) never fetches it.
- **`scripts/bootstrap.py`**, via `bootstrap.yml` (manual
  `workflow_dispatch` only). Also SAM-based; writes a 5-image
  `bootstrap-manifest.json` nothing in `src/` reads either.

`scripts/indexer.py`'s own consolidation step was already removed from
`process_art.yml` (see the comment in that workflow) once it was confirmed
its output path was never published and nothing read it.

## Fully dead scripts

Present in `scripts/` but not invoked by any CI workflow, `package.json`
script, or source file, per a repo-wide grep: `indexer.py`, `pareidolia.py`
(the old Haar-cascade "ghost finder" — unrelated to
`pareidolia_index.py` above despite the name), `curator.py`, `jules.py`
(unrelated to `src/components/JulesBoundary.jsx` — coincidental naming),
`3d_deconstructor.py`, `prepare.py`, `repair_and_index.py`,
`bake-shards.js`. Artifacts of earlier abandoned approaches (see
`docs/archive/`); safe to ignore when working on the pipeline, and
candidates for deletion in a future cleanup pass.
