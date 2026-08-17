import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { NULL_DISTANCE, PAINTING_HEIGHT } from '../sceneConstants';

// Each painting group is positioned so its shared hinge point lands at a
// world location marched forward down the pareidolia hinge chain (see
// useStore's placeAtHingeWorld/hingeWorld) — not at a fixed world origin.
// Within the group's own local frame, its layer stack extends along the
// painting's local Z axis, mirrored across local z = 0: for every depth
// flat at local z = +d there is an identical twin at z = -d, built from
// one flat per depth band, each discarding pixels outside that band.
//
// Dark-background paintings are chroma-keyed: pixels darker than CHROMA_L
// → discard, so the painting's black regions dissolve into the black void
// behind it. Light-background ("paper") paintings instead matte out
// pixels near the sampled paper colour, so near-black ink survives.
//
// Head-on the front-side flats occlude one another to reassemble the
// painting exactly. Off-axis the flats part with real parallax; as the
// camera passes through local z = 0, the mirrored back-side layers become
// the near ones.
const SHELL_HALF_DEPTH  = 5.0;      // layers occupy z ∈ [-SHELL_HALF_DEPTH, +SHELL_HALF_DEPTH]
const CHROMA_L          = 0.045;    // luminance below this counts as "black" → discard

// Cross-fade when the camera crosses a flat in local z: flat fades to
// black over this many units instead of clipping the near plane.
const CROSS_FADE = 1.2;

// Fulcrum-reveal patch radius used when a segment has no baked patchScale
// (the degenerate/no-graph-edge fallback cases) — otherwise it's derived
// per-transition from pareidolia_index.py's real matched-patch size.
const DEFAULT_PATCH_R = 0.14;

// Light-background pieces overfill the frame at coalescence so the paper's
// own edges sit off-screen (only the swept site background, never a rectangle).
const LIGHT_BG_OVERFILL = 1.35;

// Each mounted light-bg painting reports how white the SITE background should
// be right now (0 black .. 1 white). A consumer in the scene reads the max
// and drives the renderer clear colour, so the whole void — not a bounded
// plane — lightens toward white as a paper piece coalesces and darkens back
// as it leaves. Dark-bg pieces never contribute.
//
// Keyed by a unique per-mount instance key (see mountKeyRef below), NOT by
// painting id: two instances can in principle mount with the same id at
// once (e.g. a self-loop edge in the hinge graph — not currently possible,
// but a latent case worth guarding), and an id-keyed map would let one
// instance's unmount cleanup delete the other still-live instance's entry,
// snapping the sweep to black under it. bgSweepLevel()'s output contract
// (max value across all live entries) is unchanged by this internal keying.
export const bgSweep = new Map();
export function bgSweepLevel() {
  let m = 0;
  for (const v of bgSweep.values()) if (v > m) m = v;
  return m;
}
let bgSweepInstanceSeq = 0;


// ---- module-level fetch caches ----------------------------------------------

const theaterMetaCache = new Map();
export function fetchTheaterMeta(id) {
  if (!id) return Promise.resolve(null);
  const hit = theaterMetaCache.get(id);
  if (hit) return hit;
  const p = fetch(`/data/theater/${encodeURIComponent(id)}.theater.json`)
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null)
    .then(json => {
      // A transient failure (network blip, brief 5xx, bad JSON) must not
      // permanently poison this id for the rest of the tab session — only
      // a successful, non-null result stays cached. Evict on failure so
      // the next mount (the walk does revisit ids) retries the fetch.
      if (json === null) theaterMetaCache.delete(id);
      return json;
    });
  theaterMetaCache.set(id, p);
  return p;
}


// ---- shaders ----------------------------------------------------------------

// Shared vertex passthrough. All flats are unit planes scaled per-mesh.
const flatVS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Fragment shader for every flat. Every flat is a depth-band cutout
// (uMode is always 1; the value is still passed in as a uniform in case a
// future bake wants to distinguish flat kinds again, but no code path
// currently sets anything else): uBandMin/uBandMax gate it to one depth
// band via the depth texture.
//
// For dark-background paintings the chroma-key gate discards pure-black
// regions so the void shows through. For light-background ("paper")
// paintings the chroma-key is skipped entirely and a paper-colour matte
// (uBgLight/uBgColor) discards pixels near the paper instead, so near-black
// ink and linework survive.
//
// A cheap hash-based tear noise softens the depth-band boundaries into
// organic torn-paper edges.
const flatFS = /* glsl */ `
precision highp float;
uniform sampler2D uPainting;
uniform sampler2D uDepth;
uniform float uMode;         // always 1 (depth band cutout)
uniform float uBandMin;
uniform float uBandMax;
uniform float uFade;
// Fulcrum reveal. uRole: 0 = not in the active segment (plain uFade),
// 1 = the outgoing painting, 2 = the incoming painting. uPatchUv is this
// painting's hinge patch (the matched fulcrum) in uv; uPatchR its radius.
// uReveal (0..1) grows over the segment: the incoming painting is shown
// ONLY inside its fulcrum patch at uReveal=0 — camouflaged, "already
// there" — and unfurls outward from that patch as uReveal→1.
uniform float uRole;
uniform vec2  uPatchUv;
uniform float uPatchR;
uniform float uReveal;
// The plane is planeWidth x planeHeight = (PAINTING_HEIGHT * aspect) x
// PAINTING_HEIGHT, so a unit step in vUv.x and vUv.y cover DIFFERENT
// physical distances for any non-square painting. distance(vUv, uPatchUv)
// below is computed in raw uv space, unaware of that -- so the "reveal
// circle" it draws is actually an ellipse, stretched by the painting's
// aspect ratio (visibly so: the corpus spans ~0.45 to ~1.86). uAspect
// corrects the x term so it reads as a true circle in physical/screen
// space regardless of the painting's proportions.
uniform float uAspect;
// Shard-wipe reveal. uWipe (0..1) is how much of the painting is currently
// revealed. The painting is wiped in from one edge as uWipe climbs 0->1 and
// wiped back out as it falls 1->0 — full-strength where revealed, void
// beyond the moving boundary. That boundary rides a passing shard so its
// edge is hidden; the art assembles into place instead of fading up.
uniform float uWipe;
// Light-background pieces (ink/paint on white paper). uBgLight flags the
// painting; uBgColor is its sampled paper colour. Pixels near that colour are
// matted out so the subject floats — the paper never shows as a rectangle;
// the site background (swept black->white elsewhere) becomes its ground.
uniform float uBgLight;
uniform vec3  uBgColor;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i),                  hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

// Aspect-corrected distance to the fulcrum patch (see uAspect above) — a
// true circle in physical space, not an uv-space one.
float patchDist(vec2 uv, vec2 patchUv) {
  vec2 d = uv - patchUv;
  d.x *= uAspect;
  return length(d);
}

void main() {
  vec3 painting = texture2D(uPainting, vUv).rgb;

  // BT.709 luma; slight uv-noise threshold so the edges of dark regions
  // tear organically instead of aliasing.
  float lum = 0.2126 * painting.r + 0.7152 * painting.g + 0.0722 * painting.b;
  float chromaJit = (vnoise(vUv * 128.0) - 0.5) * 0.015;

  // Depth band cutout (the only flat kind produced today; see uMode note
  // above), computed unconditionally and BEFORE any content-dependent
  // discard below. fwidth() is only well-defined while every fragment in
  // a GPU 2x2 quad is still executing in lockstep; a discard a neighbour
  // took earlier for an unrelated reason (the chroma-key/paper-matte
  // tests further down) breaks that lockstep for anything computed after
  // it, which can reintroduce unstable/sparkling edges right where a
  // depth-band seam happens to sit near a chroma-key boundary. uMode is a
  // uniform (identical for every fragment in the draw call), so branching
  // on it alone doesn't break derivative lockstep — only a per-fragment
  // (varying-dependent) discard does, which is why the actual discard is
  // deferred below instead of happening inline here.
  //
  // A hard discard against a noisy threshold (dj outside [uBandMin,
  // uBandMax]) aliases badly once several depth flats' torn edges line up
  // on screen at coalescence: each screen pixel near a seam flips between
  // kept/discarded slightly differently frame to frame, reading as
  // sparkling static exactly where the layers should merge seamlessly.
  // Soften the boundary into a ramp sized to the on-screen rate of change
  // (fwidth) instead of a fixed uv-space width, so it stays a crisp,
  // stable ~1px edge at any distance without flickering.
  float bandAlpha = 1.0;
  bool bandDiscard = false;
  if (uMode > 0.5 && uMode < 1.5) {
    float d = texture2D(uDepth, vUv).r;
    float tear = (vnoise(vUv * 48.0) - 0.5) * 0.05;
    float dj = d + tear;
    float aa = clamp(fwidth(dj), 0.0015, 0.03);
    bandAlpha = smoothstep(uBandMin - aa, uBandMin + aa, dj)
              - smoothstep(uBandMax - aa, uBandMax + aa, dj);
    bandDiscard = bandAlpha <= 0.002;
  }

  if (uBgLight > 0.5) {
    // Light-background (paper) matte: near-black ink/linework is genuine
    // content on these pieces, so the base near-black chroma-key below
    // must NOT run for them — it would punch holes through the darkest
    // strokes before this branch ever runs. Instead kill only pixels near
    // the sampled paper colour, so the subject floats and the (swept)
    // site background is its ground. A little noise tears the matte edge
    // like the chroma-key would.
    float paperD = distance(painting, uBgColor) + chromaJit;
    if (paperD < 0.16) discard;
  } else {
    // Dark-background chroma-key: kill near-black on every flat. Black
    // regions must be genuinely empty — transparent onto the black
    // background — so a painting's dark passages read as void. Nothing
    // else can bleed there because visibility is scheduled so only ONE
    // painting is drawn at each coalescence point (see useFrame).
    if (lum + chromaJit < ${CHROMA_L.toFixed(4)}) discard;
  }
  if (bandDiscard) discard;

  // Base opacity is the fly-through dissolve only (uFade); the LIFESPAN is
  // now carried by the wipe, not by dimming — so revealed pixels are always
  // full-strength (no ghostly semi-transparent cross-fade).
  // Shard-wipe: reveal pixels on the near side of the moving boundary. The
  // boundary sweeps left->right as uWipe grows and retreats as it falls; a
  // little uv-noise tears its edge so it reads as torn paper, not a razor.
  // Remap the boundary to [-0.1, 1.1] so uWipe=1 clears the whole painting
  // (no right-edge clip at coalescence) and uWipe=0 fully hides it — the
  // noise jitter + smoothstep band can't leak past either extreme.
  float wipeAt = mix(-0.1, 1.1, uWipe);
  float wipeEdge = wipeAt + (vnoise(vUv * 40.0) - 0.5) * 0.06;
  float wipeGate = 1.0 - smoothstep(wipeEdge - 0.04, wipeEdge + 0.04, vUv.x);
  float op = uFade * wipeGate * bandAlpha;

  if (uRole > 1.5) {
    // Incoming painting. Hold the fulcrum patch present (camouflaged as part
    // of the outgoing image) even before the wipe reaches it, unfurling
    // outward from that patch as uReveal climbs.
    float dp = patchDist(vUv, uPatchUv);
    float front = mix(uPatchR, 1.6, uReveal);
    float revealed = 1.0 - smoothstep(front - 0.14, front, dp);
    float inPatch = 1.0 - smoothstep(uPatchR * 0.55, uPatchR, dp);
    float presence = inPatch * mix(0.5, 1.0, uReveal);
    // Still gated by bandAlpha: without it, this override replaces the
    // antialiased depth-band edge with a hard-opaque one right inside the
    // fulcrum patch -- exactly where the coalescing transition draws the
    // eye, reintroducing the sparkle this shader change is meant to fix.
    op = max(op, uFade * presence * revealed * bandAlpha);
  } else if (uRole > 0.5) {
    // Outgoing painting: hold the fulcrum patch a beat longer than the rest
    // so the shared spot stays occupied as it hands off to the incoming one.
    float dp = patchDist(vUv, uPatchUv);
    float inPatch = 1.0 - smoothstep(uPatchR * 0.55, uPatchR, dp);
    op = max(op, uFade * inPatch * (1.0 - uReveal) * bandAlpha);
  }

  // A faded-to-nothing flat (op ~ 0, a painting a segment away from its
  // null) must not occlude what's behind it. The material writes alpha =
  // 1.0 unconditionally with depthWrite on, so without this the "invisible"
  // flat would still rasterize as a solid opaque black rectangle — hiding
  // the background sweep and anything else behind it. Discard it instead;
  // discarded fragments write neither colour nor depth.
  if (op < 0.004) discard;

  gl_FragColor = vec4(painting * op, 1.0);
}
`;


// ---- flat assembly ------------------------------------------------------------

// Given depth band centers, build the full mirrored stack of flat
// descriptors. Local z = 0 is the group's own local origin (the group is
// positioned in world space per the hinge-marched placement, not fixed at
// world origin); positive z is the "front" half (camera-facing when the
// camera is on the +Z side of the group's local frame), negative z is the
// mirrored back half.
function buildFlats(meta) {
  const flats = [];
  const aspect = (meta?.src?.width || 1) / (meta?.src?.height || 1);
  const planeWidth  = PAINTING_HEIGHT * aspect;
  const planeHeight = PAINTING_HEIGHT;

  // Perspective compensation: at each null, camera sits at viewDir *
  // NULL_DISTANCE along the painting's local +Z axis. A flat at local z
  // is (NULL_DISTANCE - z) units from the camera; scaling it by that
  // ratio makes every flat subtend the same visual angle so they
  // reassemble into the painting at the null. Off-axis, the disparate
  // scales are what create the "layers exploded outward" look.
  const persp = (z) => (NULL_DISTANCE - z) / NULL_DISTANCE;

  // NO backdrop. A full-painting backdrop under the cutouts means the
  // whole image is ALWAYS assembled — it reads as "revealed" even
  // off-axis, before the depth layers have actually converged (the
  // premature reveal). Likewise there is NO separate colour partition:
  // colour flats are a second complete copy of the painting stacked over
  // the depth copy, another redundant overlap. The painting is now drawn
  // exactly ONCE, split across depth bands only — so it coheres solely
  // from the layers reassembling at the null, and dissolves into
  // separate cut-paper shards the moment the camera leaves.
  const depthCenters = meta?.depth?.bands?.centers || [];
  const depthEdges   = meta?.depth?.bands?.edges   || [];

  const nDepth = depthCenters.length;
  // One flat per band, covering the FULL depth range [0,1] with no gaps
  // and no overlap — the rear band (0) sits at the origin plane where the
  // backdrop used to be; the nearest band sits fully forward.
  const depthZs = [];
  for (let i = 0; i < nDepth; i++) {
    depthZs.push(SHELL_HALF_DEPTH * (i / Math.max(1, nDepth - 1)));
  }
  // Back-half positions: a deterministic permutation of the front zs so
  // the mirror reads as "same layers, jumbled", not a boring reflection.
  // Seeded by the painting id — same painting always scrambles the same
  // way, so the mid-transit chaos is stable across reloads.
  const depthPerm = shufflePerId(depthZs.map((_, i) => i), meta?.id + ':d');

  for (let i = 0; i < depthZs.length; i++) {
    const bandIdx = i;  // band [edges[i], edges[i+1]); depthCenters index
    // Front (assembles cleanly at the null)
    flats.push({
      kind: 'depth',
      mode: 1,
      z: depthZs[i],
      scale: persp(depthZs[i]),
      planeWidth, planeHeight,
      bandMin: depthEdges[bandIdx],
      bandMax: depthEdges[bandIdx + 1],
    });
    // Back mirror at scrambled z — same band content, jumbled position.
    const zBack = -depthZs[depthPerm[i]];
    flats.push({
      kind: 'depth-mirror',
      mode: 1,
      z: zBack,
      scale: persp(zBack),
      planeWidth, planeHeight,
      bandMin: depthEdges[bandIdx],
      bandMax: depthEdges[bandIdx + 1],
    });
  }

  return flats;
}

// Deterministic seeded Fisher-Yates shuffle. Seed is a string; the same
// seed produces the same permutation across reloads.
function shufflePerId(arr, seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed || 'anon');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    // xorshift step per swap so the RNG advances.
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5;  h >>>= 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}


// ---- component --------------------------------------------------------------

export default function TheaterPainting({ id, image, position, rotation, mySegmentIndex }) {
  const [meta, setMeta] = useState(null);
  const [flatTex, setFlatTex] = useState(null);
  // Detected background: { light, color:[r,g,b] }. Sampled from the painting's
  // border once it loads — null until then (treated as a normal dark piece).
  // Declared here (above fitScale) because fitScale reads it: a later
  // declaration would leave it in the temporal dead zone when the memo runs.
  const [bgInfo, setBgInfo] = useState(null);
  const currentSegmentIndex = useStore(s => s.currentSegmentIndex);
  const setCurrentResolution = useStore(s => s.setCurrentResolution);
  const tmpVec = useRef(new THREE.Vector3());
  // Unique key for this mount's bgSweep entry — see the comment on bgSweep
  // above. Assigned once per mount (a monotonic counter, not id or Math.random,
  // so it's guaranteed collision-free even against a same-id sibling).
  const mountKeyRef = useRef(null);
  if (mountKeyRef.current === null) {
    mountKeyRef.current = `${id}#${++bgSweepInstanceSeq}`;
  }

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchTheaterMeta(id).then(json => {
      if (cancelled) return;
      // Require at least one actual depth band, not just a present-but-empty
      // `bands` object — an empty-bands bake would otherwise pass this check,
      // produce zero flats, and hit the render guard below that returns null
      // outright instead of falling through to the legacy flat-texture path.
      const usable = json && json.schema === 2 && json.depth?.bands?.centers?.length > 0 ? json : null;
      setMeta(usable);
      if (!usable && image) {
        const loader = new THREE.TextureLoader();
        loader.load(
          image,
          tex => {
            if (cancelled) { tex.dispose(); return; }
            tex.colorSpace = THREE.SRGBColorSpace;
            const w = tex.image?.width || 1;
            const h = tex.image?.height || 1;
            setFlatTex({ texture: tex, aspect: w / h, width: w, height: h });
          },
          undefined,
          () => { },
        );
      }
    });
    return () => { cancelled = true; };
  }, [id, image]);

  const rotEuler = useMemo(() => {
    const r = rotation || [0, 0, 0];
    return new THREE.Euler(
      THREE.MathUtils.degToRad(r[0] || 0),
      THREE.MathUtils.degToRad(r[1] || 0),
      THREE.MathUtils.degToRad(r[2] || 0),
    );
  }, [rotation]);

  const flats = useMemo(() => meta ? buildFlats(meta) : [], [meta]);

  // Dynamic scale so a painting at NULL_DISTANCE fills the frame. Camera
  // approaches from world origin along the painting's local +Z axis (after
  // rotation), so head-on distance is exactly NULL_DISTANCE.
  const { size, camera } = useThree();
  const fitScale = useMemo(() => {
    let paintingWidth, paintingHeight;
    if (meta && flats.length > 0) {
      paintingWidth  = flats[0].planeWidth;
      paintingHeight = flats[0].planeHeight;
    } else if (flatTex) {
      paintingWidth  = PAINTING_HEIGHT * flatTex.aspect;
      paintingHeight = PAINTING_HEIGHT;
    } else {
      return 1.0;
    }
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const visibleHeight = 2.0 * NULL_DISTANCE * Math.tan(vFov / 2.0);
    const visibleWidth  = visibleHeight * (size.width / size.height);
    const widthScale  = (visibleWidth  * 0.85) / paintingWidth;
    const heightScale = (visibleHeight * 0.90) / paintingHeight;
    // Light-bg pieces overfill so the paper's edges sit off-screen: fit to the
    // LARGER dimension and push past the frame, instead of fitting inside it.
    if (bgInfo?.light) {
      return Math.max(widthScale, heightScale) * LIGHT_BG_OVERFILL;
    }
    return Math.min(widthScale, heightScale);
  }, [meta, flats, flatTex, size.width, size.height, camera.fov, bgInfo]);

  const planeGeom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const flatMaterials = useMemo(() => {
    const aspect = (meta?.src?.width || 1) / (meta?.src?.height || 1);
    return flats.map(flat => new THREE.ShaderMaterial({
      vertexShader:   flatVS,
      fragmentShader: flatFS,
      transparent:    false,
      depthWrite:     true,
      side:           THREE.DoubleSide,
      // fwidth() in the depth-band antialiasing needs derivatives; a no-op
      // under WebGL2 (always available there) but required for a WebGL1
      // fallback context.
      extensions:     { derivatives: true },
      uniforms: {
        uPainting:      { value: null },
        uDepth:         { value: null },
        uMode:          { value: flat.mode },
        uBandMin:       { value: flat.bandMin },
        uBandMax:       { value: flat.bandMax },
        uFade:          { value: 0 },
        uRole:          { value: 0 },
        uPatchUv:       { value: new THREE.Vector2(0.5, 0.5) },
        uPatchR:        { value: DEFAULT_PATCH_R },
        uReveal:        { value: 0 },
        uWipe:          { value: 1 },
        uBgLight:       { value: 0 },
        // A THREE.Color so we can convert the sampled sRGB paper colour into the
        // linear space the shader sees the (sRGB-decoded) painting texture in.
        uBgColor:       { value: new THREE.Color(1, 1, 1) },
        // Painting-level constant (same for every flat of this painting) —
        // see the uAspect comment in flatFS for why the fulcrum-reveal
        // circle needs it.
        uAspect:        { value: aspect },
      },
    }));
  }, [flats, meta]);

  // Load painting + depth textures once meta is known. Pass them into
  // every flat's material.
  const [textures, setTextures] = useState(null);
  useEffect(() => {
    if (!id || !meta) return;
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    const paintingUrl = `/data/theater/${encodeURIComponent(id)}.painting.webp`;
    const depthUrl    = `/data/theater/${encodeURIComponent(meta.depth.file || `${id}.depth.png`)}`;
    Promise.all([
      new Promise((res, rej) => loader.load(paintingUrl, res, undefined, rej)),
      new Promise((res, rej) => loader.load(depthUrl,    res, undefined, rej)),
    ]).then(([painting, depth]) => {
      // Mirrors the flatTex fallback loader's cancelled-branch dispose
      // above: a fast scroll can unmount this painting (Scene.jsx only
      // keeps a 3-segment window) while its full-res textures are still in
      // flight. Without disposing them here, a resolution arriving after
      // unmount decoded real GPU/CPU texture data that nothing ever frees.
      if (cancelled) { painting.dispose(); depth.dispose(); return; }
      painting.colorSpace = THREE.SRGBColorSpace;
      painting.anisotropy = 4;
      depth.colorSpace = THREE.NoColorSpace;
      depth.generateMipmaps = false;
      depth.minFilter = THREE.LinearFilter;
      setTextures({ painting, depth });
      // Sample the painting's border to detect a light (paper) background.
      try {
        const S = 48;
        const cnv = document.createElement('canvas');
        cnv.width = S; cnv.height = S;
        const ctx = cnv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(painting.image, 0, 0, S, S);
        const px = ctx.getImageData(0, 0, S, S).data;
        let r = 0, g = 0, b = 0, n = 0;
        const acc = (x, y) => { const i = (y * S + x) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; };
        for (let x = 0; x < S; x++) { acc(x, 0); acc(x, S - 1); }
        for (let y = 1; y < S - 1; y++) { acc(0, y); acc(S - 1, y); }
        r /= n; g /= n; b /= n;
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        setBgInfo({ light: lum > 0.62, color: [r / 255, g / 255, b / 255] });
      } catch { setBgInfo({ light: false, color: [1, 1, 1] }); }
    }).catch(() => { });
    return () => { cancelled = true; };
  }, [id, meta]);

  useEffect(() => {
    if (!textures) return;
    for (const m of flatMaterials) {
      m.uniforms.uPainting.value = textures.painting;
      m.uniforms.uDepth.value    = textures.depth;
    }
  }, [textures, flatMaterials]);

  useEffect(() => {
    const light = bgInfo?.light ? 1 : 0;
    const c = bgInfo?.color || [1, 1, 1];
    for (const m of flatMaterials) {
      m.uniforms.uBgLight.value = light;
      // Sample is sRGB; the shader compares against the linear-decoded
      // painting texture, so convert to linear to keep the matte threshold
      // meaningful.
      m.uniforms.uBgColor.value.setRGB(c[0], c[1], c[2]).convertSRGBToLinear();
    }
  }, [bgInfo, flatMaterials]);

  // Drop this painting's site-background contribution when it unmounts, so a
  // scrolled-away paper piece can't hold the void white. Deletes only this
  // instance's own entry (see mountKeyRef above), never a same-id sibling's.
  useEffect(() => () => { bgSweep.delete(mountKeyRef.current); }, []);

  useEffect(() => {
    const isActiveSegment =
      mySegmentIndex === currentSegmentIndex ||
      mySegmentIndex === currentSegmentIndex + 1;
    if (!isActiveSegment) return;
    if (meta) {
      setCurrentResolution([meta.src?.width || 1000, meta.src?.height || 1000]);
    } else if (flatTex) {
      setCurrentResolution([flatTex.width, flatTex.height]);
    }
  }, [mySegmentIndex, currentSegmentIndex, meta, flatTex, setCurrentResolution]);

  useEffect(() => () => {
    if (textures) {
      textures.painting.dispose();
      textures.depth.dispose();
    }
  }, [textures]);

  useEffect(() => () => {
    for (const m of flatMaterials) m.dispose();
  }, [flatMaterials]);

  useEffect(() => () => {
    planeGeom.dispose();
  }, [planeGeom]);

  useEffect(() => () => {
    if (flatTex?.texture) flatTex.texture.dispose();
  }, [flatTex]);

  const fallbackMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide }),
    [],
  );
  useEffect(() => () => fallbackMaterial.dispose(), [fallbackMaterial]);
  useEffect(() => {
    if (flatTex) fallbackMaterial.map = flatTex.texture;
    fallbackMaterial.needsUpdate = true;
  }, [flatTex, fallbackMaterial]);

  // Scheduled visibility + fly-through cross-fade.
  //
  // Paintings sit at different world positions (the hinge-marched
  // placement from useStore), but a distance-from-camera fade still can't
  // reliably tell them apart: every painting's null sits at the same
  // NULL_DISTANCE radius from its own local origin, and neighbouring
  // paintings along the dive path can be roughly equidistant from the
  // camera at once mid-transit — a distance rule would light several up
  // together, interleaving through each other's black cut-outs. Instead
  // each painting's opacity is a function of WHERE we are on the scroll
  // timeline relative to ITS null.
  //
  // Timeline position T = currentSegmentIndex + transitionProgress. This
  // painting (index i = mySegmentIndex) coalesces at T = i — it is the
  // "from" of segment i and the "to" of segment i-1, and at that instant
  // it must be the ONLY thing on screen. Let d = T - i:
  //   d = 0    → full (its own null)
  //   d = ±1   → zero (a neighbour's null)
  //   between  → cross-fade; at |d| = 0.5 both segment paintings sit at
  //              ~0.5 and interleave — the "emerging from within" moment.
  // So the two paintings of the active segment cross-fade and everything
  // else is fully dark. This is the GLOBAL body of each painting; the
  // fulcrum reveal below overrides it at the matched patch so the
  // incoming painting is already present there (camouflaged) before its
  // body fades up — that's the "it was sitting there the whole time".
  //
  // Cross-fade: when the camera is close (in the group's local frame) to
  // one of a flat's local-z faces, dissolve that flat so it doesn't clip
  // the near plane as the camera passes through.
  const groupRef = useRef(null);
  const localCamPos = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!groupRef.current) return;
    const st = useStore.getState();
    const T = st.currentSegmentIndex + st.transitionProgress;
    const d = T - mySegmentIndex;
    // Asymmetric lifespan. Born at d=-1, coalescence (peak) at d=0, gone by
    // d=+FALL (2/3). Consecutive paintings are staggered by 3/5 of a
    // lifespan, so at THIS painting's coalescence the previous one has just
    // died (it reached its d=+2/3 exactly as we hit d=0) and the next is
    // only now being born — the peak stands alone. Rise spans a full
    // segment; fall spans two-thirds, biasing coalescence to 3/5.
    const FALL = 2 / 3;
    const fade = d <= -1 || d >= FALL
      ? 0.0
      : (d < 0
          ? THREE.MathUtils.smoothstep(d, -1, 0)
          : 1.0 - THREE.MathUtils.smoothstep(d, 0, FALL));
    // Lifespan phase 0..1 with coalescence at 0.6 — the clock the shard-wipe
    // reveal runs on. The wipe grows 0->1 while the painting comes in (phase
    // 0->0.6) and retreats 1->0 as it leaves (0.6->1), so the art is wiped
    // into place and wiped back out rather than dimmed through.
    const phase = THREE.MathUtils.clamp((d + 1) / (1 + FALL), 0, 1);
    const wipeReveal = phase < 0.6
      ? THREE.MathUtils.smoothstep(phase, 0.0, 0.6)
      : 1.0 - THREE.MathUtils.smoothstep(phase, 0.6, 1.0);

    // Report this piece's pull on the SITE background. A light-bg (paper)
    // piece drives the whole void toward white as it coalesces (peak at d=0)
    // and back to black as it leaves; dark pieces exert none. A scene-level
    // consumer reads the max across mounted pieces and sets the clear colour.
    if (bgInfo?.light) bgSweep.set(mountKeyRef.current, fade);
    else bgSweep.delete(mountKeyRef.current);

    // Fulcrum role for the ACTIVE segment. This painting is the outgoing
    // (start) painting of segment cur, and the incoming (end) painting of
    // segment cur-1. The reveal only matters for the active segment:
    //   role 1 = outgoing (hold its patch as it dissolves)
    //   role 2 = incoming (unfurl from its patch)
    const cur = st.currentSegmentIndex;
    const seg = st.segments[cur];
    const r = st.transitionProgress;
    let role = 0, patch = null, reveal = 0, patchR = DEFAULT_PATCH_R;
    if (seg) {
      // pareidolia_index.py bakes the real matched-patch edge length per
      // edge (seg.patchScale, a fraction of the painting's min dimension);
      // halve it (edge -> radius) so the reveal circle's size actually
      // reflects that specific match instead of one fixed guess for every
      // transition in the gallery.
      if (typeof seg.patchScale === 'number') patchR = seg.patchScale / 2;
      if (mySegmentIndex === cur) {
        role = 1;               // outgoing
        patch = seg.sUv;
        reveal = THREE.MathUtils.clamp(r, 0, 1);
      } else if (mySegmentIndex === cur + 1) {
        role = 2;               // incoming
        patch = seg.tUv;
        // Fully unfurled a touch before the null so it's settled when the
        // camera arrives.
        reveal = THREE.MathUtils.clamp(r / 0.85, 0, 1);
      }
    }

    // Camera position in the painting's local frame (undoes the group's
    // rotation and position). Cross-fade uses the local z.
    groupRef.current.worldToLocal(localCamPos.copy(camera.position));

    for (let i = 0; i < flatMaterials.length; i++) {
      const F = flats[i];
      const cross = Math.min(Math.abs(localCamPos.z - F.z) / CROSS_FADE, 1.0);
      const U = flatMaterials[i].uniforms;
      // uFade now carries ONLY the fly-through dissolve; the lifespan is the
      // wipe. When the painting is dead (wipeReveal 0) nothing shows.
      U.uFade.value = cross;
      U.uWipe.value = wipeReveal;
      U.uRole.value = role;
      U.uReveal.value = reveal;
      if (patch) U.uPatchUv.value.set(patch[0], patch[1]);
      U.uPatchR.value = patchR;
    }
    fallbackMaterial.color.setScalar(fade);
  });

  if (!meta && flatTex) {
    const fw = PAINTING_HEIGHT * flatTex.aspect * fitScale;
    const fh = PAINTING_HEIGHT * fitScale;
    return (
      <group ref={groupRef} position={position} rotation={rotEuler}>
        <mesh
          geometry={planeGeom}
          material={fallbackMaterial}
          position={[0, 0, 0]}
          scale={[fw, fh, 1]}
        />
      </group>
    );
  }

  if (!meta || flats.length === 0 || flatMaterials.length === 0) return null;

  return (
    <group ref={groupRef} position={position} rotation={rotEuler}>
      {flats.map((F, i) => (
        <mesh
          key={i}
          geometry={planeGeom}
          material={flatMaterials[i]}
          position={[0, 0, F.z]}
          scale={[
            F.planeWidth  * fitScale * F.scale,
            F.planeHeight * fitScale * F.scale,
            1,
          ]}
        />
      ))}
    </group>
  );
}
