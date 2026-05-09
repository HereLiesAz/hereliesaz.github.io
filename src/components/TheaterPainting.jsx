import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';

// Maps theater.json layer.z (range -240..0 by current baker convention) into
// scene units. AESTHETIC §8.1 wants layers close together but distinct.
const LAYER_Z_GAIN = 1.0 / 240.0;
const WORLD_HEIGHT = 10.0;

// Bone-white from AESTHETIC §2 — the colour painting accents desaturate
// toward as the camera pulls away from the painting's null.
const BONE_WHITE = new THREE.Color('#f4f0e6');

// Module-level cache: paintings re-appear over the course of an infinite
// scroll, and several clusters can be alive at once. Keyed by id, value is
// the in-flight or settled Promise so concurrent requests share a single
// fetch.
const theaterFetchCache = new Map();

function fetchTheater(id) {
  if (!id) return Promise.resolve(null);
  const hit = theaterFetchCache.get(id);
  if (hit) return hit;
  const p = fetch(`/data/theater/${encodeURIComponent(id)}.theater.json`)
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null);
  theaterFetchCache.set(id, p);
  return p;
}

// Stamp library (AESTHETIC §8.3): { stamp_NN: { points: [[x,y]...] } }.
// Every painting that needs hatching references the same library, so the
// fetch happens exactly once per session and all components await the
// same Promise.
let strokeLibraryPromise = null;
function fetchStrokeLibrary() {
  if (strokeLibraryPromise) return strokeLibraryPromise;
  strokeLibraryPromise = fetch('/data/theater/stroke_library.json')
    .then(res => (res.ok ? res.json() : null))
    .then(json => (json && json.stamps) || {})
    .catch(() => ({}));
  return strokeLibraryPromise;
}

// Distance envelope (in scene units) that gates accent colour and intensity.
// Tuned roughly to the existing inter-painting Z spacing (~21 units).
//   dist <= COLOR_HOT       full painting accent colour
//   COLOR_HOT..COLOR_GONE   colour fades to bone-white (still visible)
//   COLOR_GONE..FADE_GONE   bone-white painting fades to invisible
const COLOR_HOT  = 4.0;
const COLOR_GONE = 6.0;
const FADE_GONE  = 22.0;

// Per-shape silhouette wobble (AESTHETIC §8.2 — soft, irregular blotches,
// not perfect circles). aShapeId is an integer in [0, BLOTCH_SHAPE_COUNT);
// the VS hashes it into deterministic harmonic amplitudes and phases that
// vary the radial threshold the FS smoothsteps against. Same id everywhere
// → same silhouette, so the spec's "blotches may repeat" recurrence is
// preserved.
const blotchVS = /* glsl */ `
attribute vec2  aPos;
attribute float aScale;
attribute vec3  aColor;
attribute float aShapeId;

varying vec2 vUv;
varying vec3 vColor;
varying vec4 vWobAmp;    // amp.xyz + base radius
varying vec4 vWobPhase;  // phase.xyz + rotation phase

float h(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  vUv = uv;
  vColor = aColor;

  float s = aShapeId * 0.137 + 1.0;
  vWobAmp = vec4(
    0.06 + 0.07 * h(s),
    0.04 + 0.06 * h(s + 1.7),
    0.03 + 0.05 * h(s + 3.1),
    0.92 + 0.08 * h(s + 5.3)
  );
  vWobPhase = vec4(
    6.2831853 * h(s + 0.7),
    6.2831853 * h(s + 2.1),
    6.2831853 * h(s + 4.5),
    6.2831853 * h(s + 6.9)
  );

  vec3 transformed = position;
  transformed.xy *= aScale * 2.0;
  transformed.xy += aPos;
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Soft, wobbly radial silhouette. The base radius vWobAmp.w plus three
// harmonics of the angular coordinate produces a different blob shape per
// id. Then the same accent-gating pipeline as before mixes the painting-
// sampled colour toward bone-white as the camera pulls away (§2 / §5).
const blotchFS = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vWobAmp;
varying vec4 vWobPhase;
uniform float uIntensity;
uniform float uColorBleed;
uniform vec3  uBoneWhite;
void main() {
  vec2  c = (vUv - vec2(0.5)) * 2.0;
  float r = length(c);
  float ang = atan(c.y, c.x) + vWobPhase.w;
  float wob = sin(ang * 2.0 + vWobPhase.x) * vWobAmp.x
            + sin(ang * 3.0 + vWobPhase.y) * vWobAmp.y
            + sin(ang * 5.0 + vWobPhase.z) * vWobAmp.z;
  float edge = vWobAmp.w + wob;
  float a = smoothstep(edge, edge * 0.45, r);
  a = pow(a, 1.4);
  vec3 hue = mix(uBoneWhite, vColor, uColorBleed);
  gl_FragColor = vec4(hue, a * uIntensity);
}
`;

const strokeVS = /* glsl */ `
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

// White ink. AESTHETIC §3 — strokes are how form precipitates onto the
// black field. Alpha is gated by uIntensity (camera proximity).
const strokeFS = /* glsl */ `
precision highp float;
uniform float uIntensity;
uniform vec3  uBoneWhite;
void main() {
  gl_FragColor = vec4(uBoneWhite, uIntensity * 0.9);
}
`;

// Parse "blob_07" → 7. Falls back to 0 for missing/legacy shape ids.
function parseShapeId(s) {
  if (typeof s !== 'string') return 0;
  const m = s.match(/_(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

function buildBlotchGeometry(blotches, planeWidth, planeHeight) {
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);

  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;

  const n = blotches.length;
  const aPos     = new Float32Array(n * 2);
  const aScale   = new Float32Array(n);
  const aColor   = new Float32Array(n * 3);
  const aShapeId = new Float32Array(n);
  const tmp      = new THREE.Color();

  for (let i = 0; i < n; i++) {
    const b = blotches[i];
    aPos[i * 2]     = b.x * planeWidth  * 0.5;
    aPos[i * 2 + 1] = b.y * planeHeight * 0.5;
    aScale[i]       = b.scale * Math.min(planeWidth, planeHeight);
    tmp.set(b.color);
    aColor[i * 3]     = tmp.r;
    aColor[i * 3 + 1] = tmp.g;
    aColor[i * 3 + 2] = tmp.b;
    aShapeId[i]       = parseShapeId(b.shape);
  }

  geo.setAttribute('aPos',     new THREE.InstancedBufferAttribute(aPos,     2));
  geo.setAttribute('aScale',   new THREE.InstancedBufferAttribute(aScale,   1));
  geo.setAttribute('aColor',   new THREE.InstancedBufferAttribute(aColor,   3));
  geo.setAttribute('aShapeId', new THREE.InstancedBufferAttribute(aShapeId, 1));

  geo.instanceCount = n;
  geo.computeBoundingSphere();
  if (geo.boundingSphere) {
    geo.boundingSphere.radius = Math.max(planeWidth, planeHeight);
  }
  return geo;
}

// A stroke entry is either an inline polyline { points: [[x,y]...] } or a
// library reference { path: "stamp_NN", x, y, scale, rot }. Both expand to
// a list of [x, y] pairs in painting-normalized [-1, 1] coordinates.
function expandStroke(stroke, library) {
  if (Array.isArray(stroke.points)) return stroke.points;
  if (!library) return null;
  const tmpl = library[stroke.path];
  if (!tmpl || !Array.isArray(tmpl.points)) return null;
  const cosR = Math.cos(stroke.rot || 0);
  const sinR = Math.sin(stroke.rot || 0);
  const sx   = stroke.scale || 1;
  const ox   = stroke.x || 0;
  const oy   = stroke.y || 0;
  return tmpl.points.map(([px, py]) => [
    ox + sx * (cosR * px - sinR * py),
    oy + sx * (sinR * px + cosR * py),
  ]);
}

function buildStrokeGeometry(strokes, library, planeWidth, planeHeight) {
  if (!strokes || strokes.length === 0) return null;
  // Resolve every stroke (inline or library-stamp) to a polyline first so
  // we know the segment budget before allocating the position buffer.
  const expanded = [];
  for (const s of strokes) {
    const pts = expandStroke(s, library);
    if (pts && pts.length >= 2) expanded.push(pts);
  }
  let segCount = 0;
  for (const pts of expanded) segCount += pts.length - 1;
  if (segCount === 0) return null;

  const positions = new Float32Array(segCount * 2 * 3);
  let v = 0;
  const halfW = planeWidth * 0.5;
  const halfH = planeHeight * 0.5;
  for (const pts of expanded) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      positions[v++] = ax * halfW;
      positions[v++] = ay * halfH;
      positions[v++] = 0;
      positions[v++] = bx * halfW;
      positions[v++] = by * halfH;
      positions[v++] = 0;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeBoundingSphere();
  if (geo.boundingSphere) {
    geo.boundingSphere.radius = Math.max(planeWidth, planeHeight);
  }
  return geo;
}

export default function TheaterPainting({ id, position, rotation, mySegmentIndex }) {
  const [data, setData] = useState(null);
  const [library, setLibrary] = useState(null);
  const { camera } = useThree();
  const currentSegmentIndex = useStore(s => s.currentSegmentIndex);
  const setCurrentResolution = useStore(s => s.setCurrentResolution);
  const setCurrentShardCount = useStore(s => s.setCurrentShardCount);
  const tmpVec = useRef(new THREE.Vector3());

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchTheater(id).then(json => {
      if (!cancelled) setData(json);
    });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    fetchStrokeLibrary().then(lib => {
      if (!cancelled) setLibrary(lib);
    });
    return () => { cancelled = true; };
  }, []);

  const rotEuler = useMemo(() => {
    const r = rotation || [0, 0, 0];
    return new THREE.Euler(
      THREE.MathUtils.degToRad(r[0] || 0),
      THREE.MathUtils.degToRad(r[1] || 0),
      THREE.MathUtils.degToRad(r[2] || 0),
    );
  }, [rotation]);

  const blotchMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   blotchVS,
    fragmentShader: blotchFS,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    uniforms: {
      uIntensity:  { value: 0.0 },
      uColorBleed: { value: 0.0 },
      uBoneWhite:  { value: BONE_WHITE.clone() },
    },
  }), []);

  const strokeMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   strokeVS,
    fragmentShader: strokeFS,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    uniforms: {
      uIntensity: { value: 0.0 },
      uBoneWhite: { value: BONE_WHITE.clone() },
    },
  }), []);

  const layers = useMemo(() => {
    if (!data) return [];
    // Wait for the stamp library before building stroke geometry — without
    // it we'd silently drop every library-stamp reference. The library is
    // tiny (12 stamps), shared by all paintings, and fetched once.
    if (!library) return [];
    const w = data.src?.width  || 1;
    const h = data.src?.height || 1;
    const aspect = w / h;
    const planeWidth  = WORLD_HEIGHT * aspect;
    const planeHeight = WORLD_HEIGHT;
    return (data.layers || []).map(layer => ({
      z: (layer.z || 0) * LAYER_Z_GAIN,
      blotches: buildBlotchGeometry(layer.blotches || [], planeWidth, planeHeight),
      strokes:  buildStrokeGeometry(layer.strokes  || [], library, planeWidth, planeHeight),
    }));
  }, [data, library]);

  // Sync metadata for the active painting (same contract as legacy ShardCloud).
  useEffect(() => {
    const isActiveSegment =
      mySegmentIndex === currentSegmentIndex ||
      mySegmentIndex === currentSegmentIndex + 1;
    if (!isActiveSegment || !data) return;
    setCurrentResolution([data.src?.width || 1000, data.src?.height || 1000]);
    setCurrentShardCount(
      (data.layers || []).reduce((acc, L) => acc + (L.blotches?.length || 0), 0),
    );
  }, [mySegmentIndex, currentSegmentIndex, data, setCurrentResolution, setCurrentShardCount]);

  // Dispose the previous layers' geometries when `layers` changes (e.g. the
  // painting JSON arrives or the id swaps). This closes over the *old*
  // layers array, so React calls it just before the new geometries take
  // their place.
  useEffect(() => () => {
    layers.forEach(L => {
      if (L.blotches) L.blotches.dispose();
      if (L.strokes)  L.strokes.dispose();
    });
  }, [layers]);

  // Materials are stable across the component's lifetime (memoized on []),
  // so dispose them only on unmount. Disposing them on every `layers`
  // change would invalidate the materials still bound to the new meshes.
  useEffect(() => () => {
    blotchMaterial.dispose();
    strokeMaterial.dispose();
  }, [blotchMaterial, strokeMaterial]);

  // Drive accent gating off the camera's distance to the painting's anchor.
  // Inside FULL_DISTANCE the painting reads at full intensity and full
  // colour saturation; between FULL and FADE the colour desaturates toward
  // bone-white and the strokes thin out; beyond FADE the painting is gone.
  useFrame(() => {
    if (!position) return;
    const v = tmpVec.current;
    v.set(position[0] || 0, position[1] || 0, position[2] || 0);
    const dist = camera.position.distanceTo(v);

    const fade  = 1.0 - THREE.MathUtils.smoothstep(dist, COLOR_GONE, FADE_GONE);
    const bleed = 1.0 - THREE.MathUtils.smoothstep(dist, COLOR_HOT,  COLOR_GONE);

    blotchMaterial.uniforms.uIntensity.value  = fade;
    blotchMaterial.uniforms.uColorBleed.value = bleed;
    strokeMaterial.uniforms.uIntensity.value  = fade;
  });

  if (!data || layers.length === 0) return null;

  return (
    <group position={position} rotation={rotEuler}>
      {layers.map((L, i) => (
        <group key={i} position={[0, 0, L.z]}>
          {L.blotches && (
            <mesh geometry={L.blotches} material={blotchMaterial} />
          )}
          {L.strokes && (
            <lineSegments geometry={L.strokes} material={strokeMaterial} />
          )}
        </group>
      ))}
    </group>
  );
}
