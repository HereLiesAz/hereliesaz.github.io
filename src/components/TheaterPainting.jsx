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

// Distance envelope: full colour when the camera is on the painting's
// null-sphere or inside; fades to black as it drifts far off. Distance is
// measured from the world origin (paintings share it), so this envelope
// is really the "how close to any diorama's ideal view" fade — always at
// least one painting is lit while the camera orbits.
const FADE_FULL = 24.0;
const FADE_GONE = 44.0;

// Cross-fade when the camera crosses a flat in local z: flat fades to
// black over this many units instead of clipping the near plane.
const CROSS_FADE = 1.2;

// The backdrop is oversized so parallax never exposes its frame edge.
const BACKDROP_OVERSCAN = 1.08;


// ---- module-level fetch caches ----------------------------------------------

const theaterMetaCache = new Map();
function fetchTheaterMeta(id) {
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

  // Chroma-key: kill near-black on cutout flats only (modes 1-2). The
  // backdrop (mode 0) keeps black pixels opaque so dark painting regions
  // block whatever is behind — no bleed from other paintings.
  float lum = 0.2126 * painting.r + 0.7152 * painting.g + 0.0722 * painting.b;
  if (uMode > 0.5) {
    float chromaJit = (vnoise(vUv * 128.0) - 0.5) * 0.015;
    if (lum + chromaJit < ${CHROMA_L.toFixed(4)}) discard;
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

  gl_FragColor = vec4(painting * uFade, 1.0);
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

  // Backdrop — the whole painting at the origin plane. Slightly overscaled
  // so lateral parallax never exposes its frame edge behind the cutouts.
  flats.push({
    kind: 'backdrop',
    mode: 0,
    z: 0,
    scale: BACKDROP_OVERSCAN * persp(0),
    planeWidth, planeHeight,
    bandMin: 0, bandMax: 1,
    colorIdx: -1,
  });

  const depthCenters = meta?.depth?.bands?.centers || [];
  const depthEdges   = meta?.depth?.bands?.edges   || [];

  const nDepth = depthCenters.length;
  // Front-half depth flat z-positions, in band order.
  const depthZs = [];
  for (let i = 1; i < nDepth; i++) {
    depthZs.push(SHELL_HALF_DEPTH * (i / Math.max(1, nDepth - 1)));
  }
  // Back-half positions: a deterministic permutation of the front zs so
  // the mirror reads as "same layers, jumbled", not a boring reflection.
  // Seeded by the painting id — same painting always scrambles the same
  // way, so the mid-transit chaos is stable across reloads.
  const depthPerm = shufflePerId(depthZs.map((_, i) => i), meta?.id + ':d');

  for (let i = 0; i < depthZs.length; i++) {
    const bandIdx = i + 1;  // depthCenters index
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

  const colorCenters = meta?.color?.centers || [];
  const nColor = colorCenters.length;
  const colorZs = [];
  for (let i = 0; i < nColor; i++) {
    colorZs.push(SHELL_HALF_DEPTH * ((i + 0.5) / nColor) * 0.85 + 0.15);
  }
  const colorPerm = shufflePerId(colorZs.map((_, i) => i), meta?.id + ':c');

  for (let i = 0; i < nColor; i++) {
    flats.push({
      kind: 'color',
      mode: 2,
      z: colorZs[i],
      scale: persp(colorZs[i]),
      planeWidth, planeHeight,
      bandMin: 0, bandMax: 1,
      colorIdx: i,
    });
    const zBack = -colorZs[colorPerm[i]];
    flats.push({
      kind: 'color-mirror',
      mode: 2,
      z: zBack,
      scale: persp(zBack),
      planeWidth, planeHeight,
      bandMin: 0, bandMax: 1,
      colorIdx: i,
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
    return Math.min(widthScale, heightScale);
  }, [meta, flats, flatTex, size.width, size.height, camera.fov]);

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
    },
  })), [flats, colorCentersUniform, nColorCenters]);

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
      if (cancelled) return;
      painting.colorSpace = THREE.SRGBColorSpace;
      painting.anisotropy = 4;
      depth.colorSpace = THREE.NoColorSpace;
      depth.generateMipmaps = false;
      depth.minFilter = THREE.LinearFilter;
      setTextures({ painting, depth });
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

  // Distance envelope + fly-through cross-fade. Distance measured from
  // the painting's world origin (which for the new spatial model is
  // world (0,0,0) for every painting, so this is really the camera's
  // distance from the shared centre point).
  //
  // Cross-fade: when the camera is close (in the group's local frame) to
  // one of a flat's local-z faces, dissolve that flat so it doesn't
  // clip the near plane as the camera passes through.
  const groupRef = useRef(null);
  const localCamPos = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!position || !groupRef.current) return;
    const v = tmpVec.current;
    v.set(position[0] || 0, position[1] || 0, position[2] || 0);
    const dist = camera.position.distanceTo(v);
    const fade = 1.0 - THREE.MathUtils.smoothstep(dist, FADE_FULL, FADE_GONE);

    // Camera position in the painting's local frame (undoes the group's
    // rotation and position). Cross-fade uses the local z.
    groupRef.current.worldToLocal(localCamPos.copy(camera.position));

    for (let i = 0; i < flatMaterials.length; i++) {
      const F = flats[i];
      const cross = F.kind === 'backdrop'
        ? 1.0
        : Math.min(Math.abs(localCamPos.z - F.z) / CROSS_FADE, 1.0);
      flatMaterials[i].uniforms.uFade.value = fade * cross;
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
