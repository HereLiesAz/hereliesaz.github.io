# Frontend Architecture

Plain **Vite + React 18**, no meta-framework (no Next.js). Routing is
**wouter** (`src/App.jsx`'s `<Switch>`): `/` is the gallery (unchanged, and
still what most visitors get — `/admin` and `/projects` are
`React.lazy`-loaded so their code never reaches a gallery visitor's
bundle), `/admin` is the content-management PWA (`src/admin/`, gated on a
GitHub token, not linked from the gallery UI), `/projects` cross-links the
owner's other GitHub Pages repos (`src/projects/ProjectsPage.jsx`). GitHub
Pages has no server-side SPA fallback, so a direct load of `/admin` or
`/projects` is caught by `public/404.html`, which stashes the path and
bounces to `/`; `src/main.jsx` restores it before wouter reads
`window.location`. 3D via **Three.js** through **@react-three/fiber** (R3F) and
**@react-three/drei**'s helpers (`ScrollControls`, `useScroll`, `Loader`,
`PerspectiveCamera`). State via **Zustand**. See
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for how these pieces fit into the
overall system and [`SHADERS.md`](./SHADERS.md) for the GLSL.

## `src/` layout

```
src/
├── main.jsx                       entry point, wraps <App/> in JulesBoundary
├── App.jsx                        boot screen, WebGL context-loss handling, Loader styling
├── sceneConstants.js              NULL_DISTANCE / PAINTING_HEIGHT / CAMERA_FOV_DEG (shared)
├── index.css                      global styles, reduced-motion media query
├── store/
│   └── useStore.jsx                Zustand: graph, segments, hinge placement, walk logic
├── utils/
│   └── Logger.js                   console hijack + crash log ring buffer + GitHub issue URL
├── components/
│   ├── JulesBoundary.jsx            top-level React error boundary
│   ├── Scene.jsx                    <Canvas>, data loading, background sweep mesh
│   ├── AnamorphicCam.jsx            scroll → camera position/gaze, keyboard nav, reduced motion
│   ├── TheaterPainting.jsx          per-painting depth-band renderer (the shader lives here)
│   ├── TexturePreloader.jsx         warms upcoming paintings' textures ahead of the scroll
│   └── Overlay.jsx                  2D DOM UI: signature, caption, menu modal, load-error text
├── admin/                          /admin — content-management PWA (see below)
└── projects/
    └── ProjectsPage.jsx             /projects — cross-links other GitHub Pages repos
```

There is no `src/canvas/`, `src/shaders/`, or `src/ui/` — despite what
older planning docs describe (see `docs/archive/`), every 3D component
lives flat in `src/components/`, and shaders are inline GLSL template
literals inside the component that owns them (`TheaterPainting.jsx`,
`Scene.jsx`), not separate `.vert`/`.frag` files.

## Key components

### `src/main.jsx` + `JulesBoundary.jsx`

The entry point wraps the whole app in a class-component error boundary.
On an uncaught render error it replaces the screen with a "CRITICAL
FAILURE" notice and a pre-filled GitHub issue link (`Logger.js`'s
`generateIssueUrl`, built from a ring buffer of the last 100
console.error/warn calls plus the stack trace). Note this only catches
errors during React's synchronous render/commit — a throw inside a
`useFrame` callback (the R3F render loop, driven by
`requestAnimationFrame`) does **not** go through React error boundaries
at all; see the try/catch inside `AnamorphicCam.jsx`'s own `useFrame` for
the one place that's specifically guarded against that.

### `Scene.jsx`

Owns the R3F `<Canvas>` and the top-level data-loading effect: fetches
`/data/theater/_manifest.json` + `/data/theater/graph.theater.json`,
falling back to the legacy `/graph.json` (flat textured planes, no depth
bands) if the theater bake is missing, and setting a `loadError` string
in the store if *both* sources come up empty. `pages` (drei
`ScrollControls`' total scrollable length) scales with the loaded corpus
size rather than a fixed constant, so a full scroll can reach close to
the whole graph regardless of how many paintings are baked. Also owns
`BackgroundSweep`, a full-screen mesh at `renderOrder={-1000}` whose
shader sweeps the clear color from black to white as a light-background
painting coalesces (see [`SHADERS.md`](./SHADERS.md)).

Only three `TheaterPainting` instances are ever mounted at once: the
current segment, the next, and the previous — the previous one stays
mounted (fully faded out) purely so scrolling back up re-reveals it
instantly instead of a cold re-fetch.

### `AnamorphicCam.jsx`

No physical scene geometry moves; every visible change is the camera.
Reads drei's `useScroll()` offset, maps it onto `segments` from the
store, and:

- Samples a per-segment `CatmullRomCurve3` (cached per segment index, not
  rebuilt every frame) for camera position, eased with a smootherstep
  (or a gentler quadratic curve under `prefers-reduced-motion`).
- Blends the look-at target through 3 phases per `lookTarget()`: the
  outgoing painting's center → the shared hinge point → the incoming
  painting's center (skipping the hinge detour under reduced motion).
- Installs a window-level `keydown` listener (Arrow/Page/Home/End) that
  drives the drei scroll container's `scrollTop` directly — the only
  reason the site is keyboard-navigable at all, since the scroll div
  itself is never a Tab stop.
- Guards every curve sample: `r` clamped to `[0,1]`, the sampled point
  checked for `Number.isFinite` before being applied to the camera, and
  the whole sample wrapped in try/catch holding the last-good position on
  failure — a large/instant scroll jump (scrollbar-thumb drag, Home/End)
  used to permanently freeze the camera here before this was added.

### `TheaterPainting.jsx`

The core renderer — see [`SHADERS.md`](./SHADERS.md) for the shader
itself. In React terms: fetches a painting's `{id}.theater.json` +
textures, builds one mesh per baked depth band (plus a mirrored copy
behind local `z = 0`), and drives per-frame uniform updates (fade,
fulcrum role/reveal, shard-wipe progress, background-sweep contribution)
from the store — all via `useMemo`'d, imperatively-mutated
`THREE.ShaderMaterial` instances, deliberately *not* JSX
`<shaderMaterial uniforms={{...}}>` props, because R3F's prop-diffing
(`applyProps`) replaces a plain object-literal `uniforms` prop wholesale
on every re-render instead of merging into it — exactly the bug that
caused an earlier background-sweep regression (the fix's own comment in
`Scene.jsx` explains why).

Falls back to a single flat textured plane (`fallbackMaterial`) for any
painting id that hasn't been baked into the theater pipeline yet.

### `Overlay.jsx`

The 2D DOM UI layer — signature (top-left, self-drawing SVG stroke,
click to open the menu), caption (bottom-left, painting id, opacity
following `|cos(πr)|` over each segment so it peaks at the nulls), the
menu modal, and the `loadError` message. Bypasses React reconciliation
for the per-frame caption-opacity and title-text writes (a raw
`useStore.subscribe` callback writing straight to DOM refs) since those
tick every animation frame and a full Overlay re-render at that rate
would be wasteful.

The menu modal has real dialog semantics: `role="dialog"`/`aria-modal`/
`aria-labelledby`, focus moves to the close button on open and back to
the signature button on close, the signature button is excluded from the
tab order (`tabIndex={-1}`, `aria-hidden`) while the modal is open since
there's no separate focus trap, and Escape closes it. The
signature/caption text also carries a `--ink-scrim` CSS custom property,
driven every frame from `bgSweepLevel()`, that fades in a dark backing
panel behind the text as the background sweeps toward white — otherwise
the site's near-white ink color drops to ~1.1:1 contrast against a fully
swept background with nothing else to help it.

### `TexturePreloader.jsx`

Purely side-effectful, renders nothing. Warms the `painting.webp` +
`depth.png` + `theater.json` for a few segments ahead of (and behind)
the current one by kicking off `Image()` fetches the browser's own HTTP
cache will later serve back to `THREE.TextureLoader` — so the 3-painting
mount window slides onto pre-warmed data instead of a cold fetch.

### `store/useStore.jsx`

The graph walker and placement math. `buildNextSegment()` picks the next
(or previous) painting via `pickEdge`/`pickPrevEdge` — biased toward
real pareidolia hinge edges when one exists, with a self-loop guard and a
rolling revisit history so the walk doesn't immediately backtrack — then
places it in world space via `computeSegmentPlacement()` so its matched
hinge patch coincides with the previous painting's. `updateFrame()` is
the one place `currentSegmentIndex` and `transitionProgress` are ever
written, always together, specifically so no consumer can observe one
fresh and the other stale mid-transition. `recomputePlacements()`
replays the same already-decided sequence of ids/edges against a fresh
`fitScale` on a debounced `resize` listener, so pre-built (not-yet-
visited) segments don't go stale relative to what
`TheaterPainting.jsx`'s own viewport-reactive `fitScale` actually renders
after a window resize or device rotation.

### `sceneConstants.js`

`NULL_DISTANCE`, `PAINTING_HEIGHT`, `CAMERA_FOV_DEG` — the three numbers
that have to agree between the camera, the world-placement math, and the
rendered plane geometry for a painting to reassemble exactly at its
null. Previously hand-duplicated across three files (correct only by
discipline); now a single shared source of truth all three import.

### `src/admin/` (`/admin`) and `src/projects/` (`/projects`)

Two routes outside the gallery, both `React.lazy`-loaded from `App.jsx` so
a normal gallery visitor's bundle never grows because of them.

`/admin` is a mobile-first content-management PWA: paste a GitHub
fine-grained personal access token once (`TokenSetup.jsx`, stored in
`localStorage`, never sent anywhere but the GitHub REST API) and then
add/remove paintings and edit their metadata, or edit
`public/site-content.json` (the gallery menu's links/about text), all via
direct browser calls to the Contents and Actions APIs (`github.js`) — no
backend. Adding a painting commits the photo to `public/assets/` and
dispatches `theater_bake.yml`; removing one deletes the source photo and
dispatches `remove_painting.yml`. Neither workflow's completion is waited
on synchronously — the admin UI reports "dispatched," and the actual
bake/removal + redeploy runs in the background over the next few minutes
(see `.github/workflows/`).

`/admin` is deliberately not linked anywhere in the gallery UI or its
menu — reached only by navigating to it directly. The token is the real
access control; not advertising the URL is a cheap extra layer, not a
security boundary on its own.

`/projects` fetches `https://api.github.com/users/HereLiesAz/repos`
directly and unauthenticated at page load, and lists every repo with
GitHub Pages enabled as a card — no build step, no staleness, no token.
It's linked from the gallery's menu modal (`Overlay.jsx`).
