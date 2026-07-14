import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';

// Each painting sits at world (0, 0, 0) with its own rotation. Its layer
// stack extends along the painting's local Z axis, mirrored across the
// origin: for every cutout flat at local z = +d there is an identical
// twin at z = -d. The backdrop plane sits at z = 0. Two families of
// cutouts stack outward from origin:
//
//   depth flats — one per depth band, discarding pixels outside that band
//   color flats — one per color cluster, discarding pixels outside that cluster
//
// Both families are chroma-keyed: pixels darker than CHROMA_L → discard, so
// the painting's black regions dissolve into the black void behind it.
//
// Head-on the front-side flats occlude the origin-plane backdrop and one
// another to reassemble the painting exactly. Off-axis the flats part
// with real parallax; as the camera passes through the origin plane, the
// mirrored back-side layers become the near ones.
const PAINTING_HEIGHT   = 10.0;
const SHELL_HALF_DEPTH  = 5.0;      // layers occupy z ∈ [-SHELL_HALF_DEPTH, +SHELL_HALF_DEPTH]
const NULL_DISTANCE     = 11.0;     // camera radius that reads a painting head-on
const CHROMA_L          = 0.045;    // luminance below this counts as "black" → discard

// Cross-fade when the camera crosses a flat in local z: flat fades to
// black over this many units instead of clipping the near plane.
const CROSS_FADE = 1.2;

// The backdrop is oversized so parallax never exposes its frame edge.
const BACKDROP_OVERSCAN = 1.08;

// Light-background pieces overfill the frame at coalescence so the paper's
// own edges sit off-screen (only the swept site background, never a rectangle).
const LIGHT_BG_OVERFILL = 1.35;

// Each mounted light-bg painting reports how white the SITE background should
// be right now (0 black .. 1 white), keyed by painting id. A consumer in the
// scene reads the max and drives the renderer clear colour, so the whole void
// — not a bounded plane — lightens toward white as a paper piece coalesces
// and darkens back as it leaves. Dark-bg pieces never contribute.
export const bgSweep = new Map();
export function bgSweepLevel() {
  let m = 0;
  for (const v of bgSweep.values()) if (v > m) m = v;
  return m;
}


// ---- module-level fetch caches ----------------------------------------------

const theaterMetaCache = new Map();
export function fetchTheaterMeta(id) {
  if (!id) return Promise.resolve(null);
  const hit = theaterMetaCache.get(id);
  if (hit) return hit;
  const p = fetch(`/data/theater/${encodeURIComponent(id)}.theater.json`)
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null);
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

// Fragment shader for every flat. Behavior varies by three uniforms:
//   uMode:
//     0 = backdrop (no cutout, just chroma-key)
//     1 = depth band cutout
//     2 = color cluster cutout
//   uBandMin/Max — depth band edges (mode 1)
//   uColorIdx + uColorCenters[] — color cluster gate (mode 2)
//
// The chroma-key gate runs for every mode: pure-black regions of the
// painting are discarded so the void shows through.
//
// A cheap hash-based tear noise softens the depth-band boundaries into
// organic torn-paper edges (mode 1 only).
const flatFS = /* glsl */ `
precision highp float;
uniform sampler2D uPainting;
uniform sampler2D uDepth;
uniform float uMode;         // 0 backdrop, 1 depth, 2 color
uniform float uBandMin;
uniform float uBandMax;
uniform float uColorIdx;
uniform vec3  uColorCenters[16];
uniform float uNColorCenters;
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

void main() {
  vec3 painting = texture2D(uPainting, vUv).rgb;

  // Chroma-key: kill near-black on every flat, backdrop included. Black
  // regions must be genuinely empty — transparent onto the black
  // background — so a painting's dark passages read as void. Nothing
  // else can bleed there because visibility is scheduled so only ONE
  // painting is drawn at each coalescence point (see useFrame).
  // BT.709 luma; slight uv-noise threshold so the edges of dark regions
  // tear organically instead of aliasing.
  float lum = 0.2126 * painting.r + 0.7152 * painting.g + 0.0722 * painting.b;
  float chromaJit = (vnoise(vUv * 128.0) - 0.5) * 0.015;
  if (lum + chromaJit < ${CHROMA_L.toFixed(4)}) discard;

  // Light-background matte: for paper pieces, kill pixels near the paper
  // colour so the subject floats and the (swept) site background is its
  // ground. A little noise tears the matte edge like the chroma-key.
  if (uBgLight > 0.5) {
    float paperD = distance(painting, uBgColor) + chromaJit;
    if (paperD < 0.16) discard;
  }

  if (uMode > 0.5 && uMode < 1.5) {
    // Depth band cutout
    float d = texture2D(uDepth, vUv).r;
    float tear = (vnoise(vUv * 48.0) - 0.5) * 0.05
               + (hash(vUv * 1024.0) - 0.5) * 0.012;
    float dj = d + tear;
    if (dj < uBandMin || dj >= uBandMax) discard;
  } else if (uMode > 1.5) {
    // Color cluster cutout — assign this pixel to the nearest cluster
    // among the first uNColorCenters entries of uColorCenters, then keep
    // only pixels whose nearest cluster is this flat's uColorIdx.
    int n = int(uNColorCenters + 0.5);
    float bestD = 1e6;
    int best = 0;
    for (int i = 0; i < 16; i++) {
      if (i >= n) break;
      vec3 c = uColorCenters[i];
      float dd = dot(painting - c, painting - c);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    if (best != int(uColorIdx + 0.5)) discard;
  }

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
  float op = uFade * wipeGate;

  if (uRole > 1.5) {
    // Incoming painting. Hold the fulcrum patch present (camouflaged as part
    // of the outgoing image) even before the wipe reaches it, unfurling
    // outward from that patch as uReveal climbs.
    float dp = distance(vUv, uPatchUv);
    float front = mix(uPatchR, 1.6, uReveal);
    float revealed = 1.0 - smoothstep(front - 0.14, front, dp);
    float inPatch = 1.0 - smoothstep(uPatchR * 0.55, uPatchR, dp);
    float presence = inPatch * mix(0.5, 1.0, uReveal);
    op = max(op, uFade * presence * revealed);
  } else if (uRole > 0.5) {
    // Outgoing painting: hold the fulcrum patch a beat longer than the rest
    // so the shared spot stays occupied as it hands off to the incoming one.
    float dp = distance(vUv, uPatchUv);
    float inPatch = 1.0 - smoothstep(uPatchR * 0.55, uPatchR, dp);
    op = max(op, uFade * inPatch * (1.0 - uReveal));
  }

  gl_FragColor = vec4(painting * op, 1.0);
}
`;


// ---- flat assembly ------------------------------------------------------------

// Given depth band centers and color center count, build the full mirrored
// stack of flat descriptors. Local z = 0 is the painting's origin (shared
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
      colorIdx: -1,
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
      colorIdx: -1,
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
  const currentSegmentIndex = useStore(s => s.currentSegmentIndex);
  const setCurrentResolution = useStore(s => s.setCurrentResolution);
  const tmpVec = useRef(new THREE.Vector3());

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchTheaterMeta(id).then(json => {
      if (cancelled) return;
      const usable = json && json.schema === 2 && json.depth?.bands ? json : null;
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

  // Color centers packed into a fixed-length array (matches shader
  // `uColorCenters[16]` uniform). Extra slots zero-padded.
  const colorCentersUniform = useMemo(() => {
    const arr = Array.from({ length: 16 }, () => new THREE.Vector3());
    const centers = meta?.color?.centers || [];
    for (let i = 0; i < Math.min(centers.length, 16); i++) {
      arr[i].set(centers[i][0], centers[i][1], centers[i][2]);
    }
    return arr;
  }, [meta]);
  const nColorCenters = meta?.color?.centers?.length || 0;

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

  const flatMaterials = useMemo(() => flats.map(flat => new THREE.ShaderMaterial({
    vertexShader:   flatVS,
    fragmentShader: flatFS,
    transparent:    false,
    depthWrite:     true,
    side:           THREE.DoubleSide,
    uniforms: {
      uPainting:      { value: null },
      uDepth:         { value: null },
      uMode:          { value: flat.mode },
      uBandMin:       { value: flat.bandMin },
      uBandMax:       { value: flat.bandMax },
      uColorIdx:      { value: flat.colorIdx },
      uColorCenters:  { value: colorCentersUniform },
      uNColorCenters: { value: nColorCenters },
      uFade:          { value: 0 },
      uRole:          { value: 0 },
      uPatchUv:       { value: new THREE.Vector2(0.5, 0.5) },
      uPatchR:        { value: 0.14 },
      uReveal:        { value: 0 },
      uWipe:          { value: 1 },
      uBgLight:       { value: 0 },
      uBgColor:       { value: new THREE.Vector3(1, 1, 1) },
    },
  })), [flats, colorCentersUniform, nColorCenters]);

  // Load painting + depth textures once meta is known. Pass them into
  // every flat's material.
  const [textures, setTextures] = useState(null);
  // Detected background: { light, color:[r,g,b] }. Sampled from the painting's
  // border once it loads — null until then (treated as a normal dark piece).
  const [bgInfo, setBgInfo] = useState(null);
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
      if (cancelled) return;
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
        for (let y = 0; y < S; y++) { acc(0, y); acc(S - 1, y); }
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
      m.uniforms.uBgColor.value.set(c[0], c[1], c[2]);
    }
  }, [bgInfo, flatMaterials]);

  // Drop this painting's site-background contribution when it unmounts, so a
  // scrolled-away paper piece can't hold the void white.
  useEffect(() => () => { bgSweep.delete(id); }, [id]);

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
  // Every painting shares world origin (0,0,0), so a distance-from-origin
  // fade can't tell them apart — the camera is equidistant from all of
  // them and they'd all light up at once, interleaving through each
  // other's black cut-outs. Instead each painting's opacity is a function
  // of WHERE we are on the scroll timeline relative to ITS null.
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
    if (bgInfo?.light) bgSweep.set(id, fade);
    else bgSweep.delete(id);

    // Fulcrum role for the ACTIVE segment. This painting is the outgoing
    // (start) painting of segment cur, and the incoming (end) painting of
    // segment cur-1. The reveal only matters for the active segment:
    //   role 1 = outgoing (hold its patch as it dissolves)
    //   role 2 = incoming (unfurl from its patch)
    const cur = st.currentSegmentIndex;
    const seg = st.segments[cur];
    const r = st.transitionProgress;
    let role = 0, patch = null, reveal = 0;
    if (seg) {
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
      const cross = F.kind === 'backdrop'
        ? 1.0
        : Math.min(Math.abs(localCamPos.z - F.z) / CROSS_FADE, 1.0);
      const U = flatMaterials[i].uniforms;
      // uFade now carries ONLY the fly-through dissolve; the lifespan is the
      // wipe. When the painting is dead (wipeReveal 0) nothing shows.
      U.uFade.value = cross;
      U.uWipe.value = wipeReveal;
      U.uRole.value = role;
      U.uReveal.value = reveal;
      if (patch) U.uPatchUv.value.set(patch[0], patch[1]);
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
