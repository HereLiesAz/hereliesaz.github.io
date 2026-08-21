# Aesthetic Spec — The Closet

This document is the visual / sensory contract the rest of the codebase
must satisfy. It is narrower than `blueprint.md` (which describes the
*system*) and supersedes any conflicting palette or "feel" guidance in
older docs.

## 1. The premise

> *"Imagine you're in a dark closet and can't see anything. How little
> light does it take to be able to make something out?"*

Every painting begins in darkness. So does every screen. The site is the
closet — a black volume the viewer is inside. Paintings are not loaded;
they *resolve* out of the dark as enough ink accumulates to be legible.

This is not a metaphor for the loading state — it is the steady state.
There is never a "fully revealed" frame. Even the most resolved painting
is still 60–80 % black field. The bright iPad-on-white look of the video
reference is to be **inverted onto black**: take the *operation* (frantic
overlapping marks accumulating into form) and apply it to a black
background, so that ink is light, not pigment.

## 2. Palette law

| Channel | Value | Use |
|--------|-------|-----|
| Field  | `#000` paper-black | The default and the rest state. Background of every surface. |
| Light  | `#f4f0e6` warm bone-white | The primary ink color. White marks are how form precipitates. |
| Shadow | `#000` paper-black | The secondary ink — used to *carve* form back out of the white once enough white is down. Indistinguishable from field except by adjacency. |
| Painting accent | sampled per-painting | Only inside that painting's stroke field, weighted by the camera's proximity to its anamorphic null point. |

Hard rules:

- The site chrome (signature, modal, captions, scrollbar, focus ring,
  cursor) is **monochrome ink only**. Never accented.
- No gray. If you see a gray in a render, it is incidental — the result
  of stroke density between 1 (white) and 0 (black) — never a fill or
  text color.
- No gradients except the implicit gradient produced by overlapping
  semi-transparent strokes.
- Color flashes are reserved for paintings that contain that color, and
  fade as the camera leaves the painting's resolution shell.

## 3. Mark vocabulary

Every visible thing on the site is one of:

1. **Stroke** — a pen mark. Variable-width poly-line, jittered, with a
   brush profile (start tapered, end tapered, mid-jagged). The atomic
   unit. UI elements (signature, button outlines, text underlines) are
   strokes. So is every shard inside a painting.
2. **Hatch** — a directional cluster of parallel strokes used as a fill.
3. **Speed line** — a long, straight stroke radiating from a focal
   point. Used only when a painting's own composition contains them
   (e.g., the impact-frame reference). Never used as a transition
   device — see §5.
4. **Scribble** — a tightly packed bundle of overlapping strokes used
   when a region needs more density than hatching gives.

There are no rectangles, no pill buttons, no card surfaces, no
backdrop-blur glass. If a UI surface is needed (the contact modal, the
About panel), it is rendered as a frame of strokes laid over the canvas
— a sheet of vellum scratched at the edges, not a CSS panel.

## 4. The fulcrum, restated

`blueprint.md` describes the anamorphic math: each painting has a *null
viewpoint* where its scattered strokes align into a coherent picture.

The closet is the **field** — the substrate, the rest state, the origin
every stroke starts from. It is **not** a state the site passes through
between paintings. There is never a black-out, never a dwell, never a
moment when nothing is on screen.

A painting at its null point is at maximum legibility — but it never
fills the frame. Even at the null, the field is still ~60–80 % black by
area. The black is what the strokes are emerging out of, not a gap
between paintings.

## 5. Transition signature — pareidolia, not crossfade

There is no transition. There is overlap.

While the camera is centered on painting A's null:

- A's strokes are aligned to A.
- **B's strokes are already on screen**, scattered across the same
  black field, *disguised* as part of A's composition. A pareidolia
  edge in `graph.json` is the contract: a hatch in A that reads as,
  e.g., a cheekbone shadow is the *same physical stroke set* that, from
  B's null, reads as the bridge of a nose. Shared strokes are the
  hinge.

As the camera moves toward B's null:

- A's non-shared strokes drift off A-alignment toward B-alignment. They
  are not chaos — they are en route to another gestalt.
- B's non-shared strokes were always there; the camera angle just
  starts to make them legible.
- The shared strokes barely move — they were valid in both paintings.
- A's painting-accent color fades out as A loses legibility; B's
  painting-accent color fades in as B gains it. Both pass through
  desaturated bone-white, never through black.

The field never darkens during the transition. Stroke *count* on screen
stays roughly constant. What shifts is which subset reads as a coherent
picture. The viewer's brain locks onto B without noticing the moment A
stopped being A — *"how long was that sitting there, right in front of
you, before you finally saw it sitting there right in front of you."*

Speed lines (Section 3.3) are not used for transitions. They are
reserved for moments inside a single painting where the painting's own
composition demands them (e.g., the impact frame in the Saitama
reference).

## 6. Type and the signature

- Type is set in a single weight of a slab/serif drawn-feel font
  (candidate: a hairline serif with high contrast — to be picked from
  `assets/`). Body is rare — most reading is captions.
- The signature in the top-left is an **SVG path of the actual
  hand-drawn signature**, animated with `stroke-dasharray` so it draws
  itself in over ~600 ms on first load and never redraws. White ink. No
  background. Click target only — no chrome around it.
- Captions (title / year / medium) are drawn in white ink, tracked
  loose, lower-left, fading with the painting they describe.

## 7. What this rules out

- The current `index.html` placeholder ("PaperPlanes — Serpentine Bleed")
  with gray rectangles, mix-blend exclusion, and Courier monospace.
- Theme colors anywhere — `theme_color: '#050505'` in the PWA manifest
  is acceptable (still effectively black) but no other accents.
- Loader spinners, progress bars, skeleton states — the closet *is* the
  loading state. Strokes either exist or do not.
- Hover styles that change color. Hover may add a stroke or thicken
  one; it may not introduce hue.

## 8. The paper-theater primitive (as built)

**Polygons are out; so, in the end, are the blotch and stroke
libraries** described in earlier drafts of this section. What actually
shipped (`scripts/theater_baker.py`, `src/components/TheaterPainting.jsx`
— see [`PIPELINE.md`](./PIPELINE.md) and [`SHADERS.md`](./SHADERS.md))
is simpler and closer to the toy-theater idea than the vocabulary-library
plan ever got: **the painting's own real pixels**, cut into a dense stack
of depth-band flats, with no synthesized mark-making layered on top.

### 8.1 Depth layers (the paper theater)

Each painting decomposes into **~18 flat planes**, like the cardboard
cutouts in a Victorian toy theater — denser than the "~3–7" originally
imagined, because a coarser stack read as visibly steppy at the reveal
edges. Each plane carries the *same painting*, cut to show only the
pixels whose measured depth falls in that plane's band; there is **no
separate backdrop plane** behind the cutouts. An early build had one, and
it was removed — a full-painting backdrop under the cutouts means the
whole image reads as "already assembled" from any angle, including well
off the null, which is exactly the premature reveal this whole system
exists to avoid. Without it, the painting only coheres when the bands
actually line up.

Depth is *measured*, then *staged*, per the original plan: the baker
first converts the cropped painting into a **photorealistic rendering of
the same scene** (composition-preserving img2img — monocular depth models
are photo-trained and flatten stylised paint), estimates depth on *that*,
and applies the resulting map back to the original painting's pixels.
k-means then buckets the depth histogram into the ~18 band edges, merging
any band too thin or too sparse to matter. The synthetic gradient
fallback exists only so a bake never hard-fails; it is not an acceptable
delivered result, and CI (`validate_output.py`) rejects it before deploy.

For murals, the same primitive still carries the world the mural lives
in: depth is measured across the whole photographed scene (wall, street,
sky), not just the painted surface, so the camera moving through the
layers is moving through the place.

The per-painting data model is exactly what was originally planned —
**the painting and its depth map**, nothing else:

- `{id}.painting.webp` — the cropped painting,
- `{id}.depth.png` — its depth map, aligned pixel-for-pixel,
- `{id}.theater.json` — src dims, depth provenance, the staged band edges
  (k-means on the depth histogram, so stops snap to objects), and a
  color-cluster palette (see below).

Each front flat is mirrored by a twin behind local `z = 0`, at a
deterministically shuffled depth — "same layers, jumbled" — so mid-transit
chaos looks intentional rather than a boring reflection, and so the
back-half layers become the near ones once the camera passes through the
painting's own local origin.

### 8.2 What replaced the blotch library

The blotch-shape library (§8.2 of earlier drafts) was never built. What
carries a layer's body is the source photograph's own pixels for that
band, full stop — no stamped, repeating watercolor shapes standing in for
color regions. Two things survive from the original idea in reduced form:

- **Color clusters.** `theater.json` still records an 8-step dark→light
  k-means palette (`color.centers`) and a small saturated-accent set —
  used by the UI for palette flashes, not by the renderer to reconstruct
  the painting's body.
- **Organic edges.** Band boundaries are jittered by a cheap value-noise
  term (`vnoise`, in the shader — see [`SHADERS.md`](./SHADERS.md)) so a
  cutout's edge tears like paper rather than snapping to a razor line.
  This is the entire surviving trace of "soft-edged, organic, non-
  polygonal" from the original blotch idea — achieved procedurally in the
  shader, not authored as a shape library.

### 8.3 Strokes did not survive as a separate mark system

Synthesized ink marks — white strokes drawing form in, black strokes
carving it back out, hatching, scribbles — were never implemented as a
layer drawn on top of the painting body. What the renderer actually shows
is the source photograph itself, unmodified except for the depth-band cut
and a chroma-key/paper-matte pass that removes near-black (dark-bg
paintings) or near-paper-color (light-bg paintings) pixels so the
painting's own background dissolves into the site's void instead of
showing as a rectangle. Any "stroke" or "ink" the viewer sees is real
brushwork or drawn linework that was already in the photographed
artwork — never a generated mark.

### 8.4 The real per-painting metadata (`{id}.theater.json`)

```jsonc
{
  "schema": 2,
  "id": "...",
  "src": { "image": "....jpg", "width": 3024, "height": 4032 },
  "crop": "heuristic",               // or a hand-authored [x0,y0,x1,y1] box
  "depth": {
    "source": "photo+depth-anything-v2",
    "file": "....depth.png",
    "bands": {
      "count": 18,
      "edges":   [0.0, 0.06, 0.13, /* ... */ 1.0],   // len = count + 1
      "centers": [0.03, 0.09, /* ... */ 0.97]
    }
  },
  "color": {                          // dark -> light k-means palette
    "count": 8,
    "centers": [[0.02, 0.02, 0.03], /* ... */ [0.94, 0.91, 0.88]]
  },
  "accents": { "swatches": ["#a31818", "#e8b400"] }   // optional
}
```

No `layers[]`, no `blotches[]`, no `strokes[]`, no `fulcrum` block in this
file — the flat stack is *built* at runtime from `depth.bands` (see
`buildFlats()` in `TheaterPainting.jsx`), and the fulcrum/hinge placement
lives in the separate hinge graph below, not per-painting.

### 8.5 Pareidolia under this model

The pareidolia hinge from §5 still works, and is closer to the original
"shared piece" idea than §8.5 of earlier drafts guessed: the shared piece
is a **matched image patch**, found by direct multi-scale template
matching (color + gradient structure + depth) between every pair of
baked paintings — not a blotch-id lookup into a shared shape library,
since that library was never built. `scripts/pareidolia_index.py` writes
one hinge patch per accepted (source, target) pair
(`graph.theater.json`); most candidate pairs get **no** edge at all (see
[`PIPELINE.md`](./PIPELINE.md) for the acceptance bar) — a curated, sparse
match set, not a complete graph.

### 8.6 The fulcrum reveal — "it was already there"

Not in any earlier draft of this document: the incoming painting of the
active transition is not simply faded up. At the start of the transition
it is visible **only inside its matched hinge patch** — camouflaged,
already sitting in the frame as if it had always been part of the
outgoing painting — and unfurls outward from that patch as the transition
progresses, fully assembled by the time the camera arrives at its null.
The outgoing painting holds its own half of the same patch present a beat
longer as the rest of it dissolves, so the shared spot never goes empty
during the handoff. This is the literal mechanism behind §5's "how long
was that sitting there... before you finally saw it" — realized with a
real patch match instead of shared stroke placements.

### 8.7 Shard-wipe reveal

A painting's *lifespan* (as opposed to its fly-through cross-fade) is
driven by a wipe, not a dim. A noisy, torn boundary sweeps across the
painting as it's born, revealing it left-to-right, and sweeps back the
other way as it dies — so a painting **assembles into place** rather than
fading up from nothing, and disassembles the same way it arrived. See
`uWipe` in [`SHADERS.md`](./SHADERS.md).

### 8.8 Background sweep

There being no backdrop plane (§8.1), a light-background ("paper") piece
has nothing to serve as its ground once it starts coalescing. Instead the
entire site void sweeps from black toward white as such a piece nears its
null, and back to black as it leaves — itself rendered as a torn,
shard-like screen-space wipe rather than a flat fade, so the background's
own transition reads consistently with everything else on screen. Dark-
background pieces never trigger this; the closet stays the closet for
them. See `BackgroundSweep` in [`SHADERS.md`](./SHADERS.md).
