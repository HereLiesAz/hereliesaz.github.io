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

// Distance envelope (in scene units) that gates accent colour and intensity.
// Tuned roughly to the existing inter-painting Z spacing (~21 units).
//   dist <= COLOR_HOT       full painting accent colour
//   COLOR_HOT..COLOR_GONE   colour fades to bone-white (still visible)
//   COLOR_GONE..FADE_GONE   bone-white painting fades to invisible
const COLOR_HOT  = 4.0;
const COLOR_GONE = 6.0;
const FADE_GONE  = 22.0;

const blotchVS = /* glsl */ `
attribute vec2 aPos;
attribute float aScale;
attribute vec3 aColor;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vUv = uv;
  vColor = aColor;
  vec3 transformed = position;
  transformed.xy *= aScale * 2.0;
  transformed.xy += aPos;
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Soft radial falloff. Sampled blotch colour is mixed toward bone-white as
// the camera pulls away from the painting's null (AESTHETIC §2 / §5).
const blotchFS = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vColor;
uniform float uIntensity;
uniform float uColorBleed;
uniform vec3  uBoneWhite;
void main() {
  float d = distance(vUv, vec2(0.5));
  float a = smoothstep(0.5, 0.0, d);
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

function buildBlotchGeometry(blotches, planeWidth, planeHeight) {
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);

  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;

  const n = blotches.length;
  const aPos   = new Float32Array(n * 2);
  const aScale = new Float32Array(n);
  const aColor = new Float32Array(n * 3);
  const tmp    = new THREE.Color();

  for (let i = 0; i < n; i++) {
    const b = blotches[i];
    aPos[i * 2]     = b.x * planeWidth  * 0.5;
    aPos[i * 2 + 1] = b.y * planeHeight * 0.5;
    aScale[i]       = b.scale * Math.min(planeWidth, planeHeight);
    tmp.set(b.color);
    aColor[i * 3]     = tmp.r;
    aColor[i * 3 + 1] = tmp.g;
    aColor[i * 3 + 2] = tmp.b;
  }

  geo.setAttribute('aPos',   new THREE.InstancedBufferAttribute(aPos,   2));
  geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 1));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));

  geo.instanceCount = n;
  geo.computeBoundingSphere();
  if (geo.boundingSphere) {
    geo.boundingSphere.radius = Math.max(planeWidth, planeHeight);
  }
  return geo;
}

function buildStrokeGeometry(strokes, planeWidth, planeHeight) {
  if (!strokes || strokes.length === 0) return null;
  // Each polyline of N points → (N-1) line segments → 2*(N-1) vertices.
  let segCount = 0;
  for (const s of strokes) segCount += Math.max(0, (s.points?.length || 0) - 1);
  if (segCount === 0) return null;

  const positions = new Float32Array(segCount * 2 * 3);
  let v = 0;
  const halfW = planeWidth * 0.5;
  const halfH = planeHeight * 0.5;
  for (const s of strokes) {
    const pts = s.points;
    if (!pts || pts.length < 2) continue;
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
  const { camera } = useThree();
  const currentSegmentIndex = useStore(s => s.currentSegmentIndex);
  const setCurrentResolution = useStore(s => s.setCurrentResolution);
  const setCurrentShardCount = useStore(s => s.setCurrentShardCount);
  const tmpVec = useRef(new THREE.Vector3());

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`/data/theater/${encodeURIComponent(id)}.theater.json`)
      .then(res => (res.ok ? res.json() : null))
      .then(json => { if (!cancelled) setData(json); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [id]);

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
    const w = data.src?.width  || 1;
    const h = data.src?.height || 1;
    const aspect = w / h;
    const planeWidth  = WORLD_HEIGHT * aspect;
    const planeHeight = WORLD_HEIGHT;
    return (data.layers || []).map(layer => ({
      z: (layer.z || 0) * LAYER_Z_GAIN,
      blotches: buildBlotchGeometry(layer.blotches || [], planeWidth, planeHeight),
      strokes:  buildStrokeGeometry(layer.strokes  || [], planeWidth, planeHeight),
    }));
  }, [data]);

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

  // Cleanup geometries on unmount or when data changes.
  useEffect(() => () => {
    layers.forEach(L => {
      if (L.blotches) L.blotches.dispose();
      if (L.strokes)  L.strokes.dispose();
    });
    blotchMaterial.dispose();
    strokeMaterial.dispose();
  }, [layers, blotchMaterial, strokeMaterial]);

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
