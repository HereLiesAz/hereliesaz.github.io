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

## 8. The paper-theater primitive

**Polygons are out.** The SAM-mask pipeline produces one unique
sharp-edged polygon per region, which gives a stained-glass look — the
opposite of what is wanted. The painting primitive is replaced with two
things that compose:

### 8.1 Depth layers (the paper theater)

Each painting decomposes into a **small, fixed number of flat planes**
(~3–7), like the cardboard cutouts in a Victorian toy theater or a
pop-up book. Each plane carries a portion of the painting and sits at
its own discrete Z-depth in the 3D scene. There is no per-pixel depth
field — depth is *staged*, not *measured*.

For murals, the same primitive carries the world the mural lives in:
the wall plane, the sidewalk in front, the building across the street.
The camera moving through the layers is moving through the place.

A layer is a flat paper plane with:

- a Z-depth (one of the ~3–7 stops for that painting),
- an alpha mask (where the layer carries content vs. lets the layer
  behind it through),
- a content body (see §8.2),
- optional drawn ink strokes overlaid on top of the body.

Depth ordering is decided by the preprocessor (heuristics plus optional
manual override per painting), not by a continuous depth model.

### 8.2 Color-matching blotches (the body of each layer)

A layer is filled by **soft-edged color blotches** — irregular,
watercolor-like patches of similar hue and value, placed where the
source image has matching color clusters. Edges are organic, not
polygonal. Blotches **may repeat**: the same blotch shape can recur
across a layer, across a painting, across the whole library. Repetition
is part of the hand-built feel and is not a bug.

This means the preprocessor maintains a small **library of blotch
shapes** (sampled or hand-authored), and per-painting layer assembly is
mostly: pick a shape, pick a color from the painting's accent palette,
stamp it where the source image has that color in that depth band. Many
paintings will share blotch geometry; that is the point.

### 8.3 Strokes still apply

Strokes (§3) are the mark vocabulary used **on top of** layer bodies —
white ink that draws form into the blotch field, black ink that carves
form back out. Strokes are per-layer — they sit in front of their
layer's blotches and behind whatever layer is in front. Strokes can also
recur across paintings; a fixed scribble stamp reused as hatching is
acceptable.

### 8.4 Updated `baked.json`

```jsonc
{
  "id": "...",
  "layers": [
    {
      "z": -120,                    // discrete depth stop
      "alpha":   "<png ref>",       // where this layer carries content
      "blotches": [
        { "shape": "blotch_07",     // id into blotch library
          "color": "#1a1a1a",       // hue (often near-black for closet feel)
          "x": 0.34, "y": 0.71,
          "scale": 0.42, "rot": 0.18 }
        // ...
      ],
      "strokes": [
        { "path": "stroke_42",      // id into stroke library OR inline polyline
          "x": 0.36, "y": 0.69,
          "scale": 0.20, "rot": 0.05,
          "ink": "white", "weight": 0.6 }
        // ...
      ]
    }
    // ... 2–6 more layers
  ],
  "accents": {                      // per-painting color palette
    "swatches": ["#a31818", "#e8b400"],
    "weights":  [0.08, 0.03]
  },
  "fulcrum": {                      // where the camera "sits" for this painting
    "z": 0,
    "fov": 35
  }
}
```

The existing `aOffset` SAM output is now **legacy** — kept on disk for
reference, ignored by the new renderer. The new preprocessor
(`scripts/stroke_extractor.py`, despite the name, will be renamed to
something like `scripts/theater_baker.py`) writes the layered format
above. Library files (`public/data/blotches/`, `public/data/strokes/`)
hold the shared shape banks.

### 8.5 Pareidolia under this model

The pareidolia hinge from §5 still works — but the shared piece is now
a **blotch placement** or **stroke placement** rather than a polygon.
Two paintings share a transition edge if a same-id blotch sits at
similar (x, y, scale, rot) on a comparable depth layer. Repetition of
blotch geometry across the library is what *makes* these matches
abundant; the pareidolia graph is computed over (shape-id, position,
rotation) tuples, not over per-image features.
