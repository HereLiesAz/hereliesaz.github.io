# Shaders

Both shaders in the site are small inline GLSL template literals living
directly inside the React component that owns them — there is no
`src/shaders/` directory and no separate `.vert`/`.frag` files. This
document describes the two that exist: the depth-band cutout shader in
`TheaterPainting.jsx`, and the background-sweep shader in `Scene.jsx`. See
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for how they fit into the render
pipeline and [`FRONTEND.md`](./FRONTEND.md) for the React side.

## The imperative-material pattern

Both shaders are built with `useMemo(() => new THREE.ShaderMaterial({...}), deps)`
and mutated afterward via refs to `material.uniforms.uFoo.value`, never as
JSX `<shaderMaterial uniforms={{...}}>` props. A plain object literal
passed as the `uniforms` prop has no `.set()`/`.copy()`, so react-three-
fiber's `applyProps` falls through to replacing `material.uniforms`
wholesale on every re-render — including whatever a `useFrame` callback
just wrote into it that same frame. This bit the background sweep once
already (see the comment above `BackgroundSweep` in `Scene.jsx`): the
level was computing correctly every frame and being silently stomped back
to 0 by the next React re-render before it ever reached the screen. Keep
new shader materials on this same pattern.

## `TheaterPainting.jsx` — the depth-band cutout shader

This is the shader that renders every painting. One `THREE.ShaderMaterial`
instance is built per depth-band flat (`flatMaterials` in
`TheaterPainting.jsx`, built from `buildFlats()` — see
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for how the bake produces those
bands), sharing the same `flatVS`/`flatFS` pair.

### Vertex shader (`flatVS`)

A plain passthrough — every flat is a unit `PlaneGeometry` scaled per-mesh
in JS (`F.planeWidth * fitScale * F.scale`, computed in
`TheaterPainting.jsx`), not in the shader:

```glsl
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
```

### Fragment shader (`flatFS`)

Per flat, in order:

1. **Depth-band cutout.** Sample `uDepth` at `vUv`, jitter it by two
   stacked value-noise terms — a coarse `vnoise(vUv * 48.0)` for the big
   organic tears and a finer `vnoise(vUv * 320.0)` for paper-fiber grain —
   so the band boundary reads as a torn-paper edge instead of a razor
   line, and discard if the jittered depth falls outside
   `[uBandMin, uBandMax)`.
2. **Background matte.** Dark-background paintings chroma-key: luminance
   below `CHROMA_L` (0.045, plus a little noise jitter) discards, so black
   regions dissolve into the black void. Light-background ("paper")
   paintings skip the chroma-key entirely (it would punch through
   near-black ink and linework, which is real content on those pieces) and
   instead matte out pixels near the sampled paper colour
   (`uBgLight`/`uBgColor`), so the subject floats free of any paper
   rectangle.
3. **Shard-wipe reveal (`uWipe`).** A noisy, near-vertical boundary sweeps
   left→right as `uWipe` climbs 0→1 and retreats as it falls, gating
   opacity (`wipeGate`). This is what makes a painting "assemble into
   place" rather than fade up.
4. **Fulcrum reveal (`uRole`/`uPatchUv`/`uPatchR`/`uReveal`).** For the two
   paintings of the currently active segment only: the outgoing painting
   (`uRole = 1`) holds its matched hinge patch present a beat longer as it
   dissolves; the incoming painting (`uRole = 2`) is shown *only* inside
   its own hinge patch at `uReveal = 0` (camouflaged, "already there") and
   unfurls outward from that patch as `uReveal → 1`. Distance to the patch
   is computed by `patchDist()`, which corrects for the plane's aspect
   ratio (`uAspect`) — `distance(vUv, uPatchUv)` alone is an ellipse, not a
   circle, for any non-square painting, since a unit step in `vUv.x` and
   `vUv.y` cover different physical distances on the plane.
5. **Discard near-zero opacity.** The material always writes `alpha = 1.0`
   with `depthWrite: true`, so a "fully faded" flat would otherwise still
   rasterize as an opaque black rectangle and occlude whatever is behind
   it (the background sweep, other flats). `op < 0.004` discards instead.

```glsl
gl_FragColor = vec4(painting * op, 1.0);
```

### Why the band boundary is a hard discard, not an antialiased ramp

**Do not add opacity/alpha falloff at the `uBandMin`/`uBandMax` boundary.**
This was tried and reverted; the reasoning is preserved as an in-shader
comment so it survives future edits, but the short version:

- The original flicker bug (visible sparkle as paintings coalesced) was
  driven by a raw `hash(vUv * 1024.0)` fine-grain term in the tear noise:
  `hash()` is a discontinuous per-cell lookup, not band-limited, so a
  sub-texel shift in `vUv` (from the camera's sub-pixel position moving
  frame to frame) could flip its output entirely, aliasing badly.
- A first pass fixed the flicker by deleting that term outright, leaving
  only the coarse `vnoise(vUv * 48.0)` wave. That killed the flicker, but
  the fine grain was also what made the torn edge read as fibrous ripped
  paper — losing it left only smooth, blobby regions, which (compounded by
  the `bandAlpha` regression below) read as a topographic contour map
  instead of torn paper. The fix that stuck: a *second* fine-grain term
  built from `vnoise(vUv * 320.0)` instead of raw `hash`. `vnoise()`
  interpolates smoothly between its grid corners, so a sub-texel `vUv`
  shift only nudges its output a little instead of jumping randomly —
  getting the paper-fiber texture back without reintroducing the alias.
- Separately, one attempted fix along the way added an `fwidth()`-based
  `bandAlpha` ramp that faded opacity near the boundary, to antialias it. This
  *reduced* the flicker but introduced a new, worse, static defect: every
  one of the ~18 band boundaries per painting drew as a permanent
  darkened contour line, so a fully-coalesced painting looked like a
  topographic map traced over the image.
- The reason: these flats are **opaque and depth-tested**, not real
  alpha-blended geometry. Two adjacent bands never actually *combine*
  their partial-opacity edges into one continuous value — whichever flat
  wins the z-test for a given pixel just draws its own darkened edge in
  isolation, and that sits on screen as a static line. A plain hard
  discard has no such artifact: two adjacent bands show the exact same
  underlying painting pixel at full, undimmed brightness right up to
  their shared boundary, so there's nothing to perceive a seam in.

If a future change reopens the sparkle question, verify empirically with
real rendered frames at multiple actual coalescence points (found by
scanning, not guessed) before concluding a fix works — this exact mistake
(a fix that looks right in isolation but is wrong at scale) is what
produced the topo-map regression in the first place.

## `Scene.jsx` — the background sweep shader

A single full-screen mesh (`BackgroundSweep`, `renderOrder: -1000`,
`depthTest`/`depthWrite: false`) that sweeps the site's void from black to
white as a light-background (paper) painting coalesces, and back to black
as it leaves. It exists because there is no bounded backdrop plane behind
any painting — see [`ARCHITECTURE.md`](./ARCHITECTURE.md) — so a paper
piece's "ground" has to be the entire void, not a rectangle.

### Vertex shader (`bgWipeVS`)

```glsl
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
```

Writes clip-space position directly (`* 2.0` to cover the full `[-1,1]`
NDC range from a unit plane), bypassing the model/view/projection chain
entirely — this quad is meant to fill the screen regardless of camera
state.

### Fragment shader (`bgWipeFS`)

```glsl
uniform float uLevel;
```

`uLevel` (0 = all black, 1 = all white) is written every frame from
`bgSweepLevel()` — the max sweep contribution across every currently-
mounted `TheaterPainting` instance (each light-bg painting reports its own
`fade` value into a shared `bgSweep` module-level `Map`, keyed per-mount
so an unmounting instance can't delete a same-id sibling's still-live
entry; dark-bg paintings never contribute). The fragment shader turns that
single scalar into a **screen-space wipe**, not a uniform fade: a torn,
noisy near-vertical boundary (two octaves of value noise) sweeps across
`vUv.x` as `uLevel` climbs, white behind it and black ahead. This keeps
the background's own transition reading as "shard-revealed" — consistent
with how the paintings themselves reveal — rather than a flat opacity
fade.

## Where the shader code lives

| Shader | File | Purpose |
|---|---|---|
| `flatVS` / `flatFS` | `src/components/TheaterPainting.jsx` | per-band painting cutout, chroma-key/matte, shard-wipe, fulcrum reveal |
| `bgWipeVS` / `bgWipeFS` | `src/components/Scene.jsx` | site-wide background black↔white sweep |
