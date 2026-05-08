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

## 8. Mapping to the existing pipeline

The Curator (SAM → mask polygons → flat shards filled with average
color, in `scripts/grinder.py`, `scripts/curator.py`,
`scripts/prepare.py`) produces *region* shards. That output stays.

The closet aesthetic adds a parallel primitive: **strokes** — vector
poly-lines extracted along edges and within high-gradient regions, with
brush profile and a single ink intensity. A new prototype lives at
`scripts/stroke_extractor.py` and emits a `strokes` block alongside the
existing `aOffset` block. The renderer draws strokes in white ink on
black; mask shards are kept for cases where a region should read as a
flat color block (e.g., a mural's sky).

A painting's `baked.json` becomes:

```jsonc
{
  "id": "...",
  "count": 3000,           // existing shard count
  "aOffset": [...],        // existing shard offsets
  "strokes": {             // NEW
    "count": 1200,
    "polylines": [...],    // flat array of [x,y,z, x,y,z, ...] segments
    "widths":    [...],    // per-stroke nominal width
    "intensity": [...]     // per-stroke ink intensity 0..1 (white)
  },
  "accents": {             // NEW — optional per-painting color seeds
    "swatches": ["#a31818", "#e8b400"],
    "weights":  [0.08, 0.03]
  }
}
```
