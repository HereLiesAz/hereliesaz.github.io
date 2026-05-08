import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';

// Maps theater.json layer.z (range -240..0 by current baker convention) into
// scene units. AESTHETIC §8.1 wants layers close together but distinct.
const LAYER_Z_GAIN = 1.0 / 240.0;
const WORLD_HEIGHT = 10.0;

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

// Soft radial falloff. Color is the painting-sampled blotch color from the
// baker; intensity is driven by camera proximity to this segment.
const blotchFS = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vColor;
uniform float uIntensity;
void main() {
  float d = distance(vUv, vec2(0.5));
  float a = smoothstep(0.5, 0.0, d);
  a = pow(a, 1.4);
  gl_FragColor = vec4(vColor, a * uIntensity);
}
`;

function buildLayerGeometry(blotches, planeWidth, planeHeight) {
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

export default function TheaterPainting({ id, position, rotation, mySegmentIndex }) {
  const [data, setData] = useState(null);
  const currentSegmentIndex = useStore(s => s.currentSegmentIndex);
  const setCurrentResolution = useStore(s => s.setCurrentResolution);
  const setCurrentShardCount = useStore(s => s.setCurrentShardCount);

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

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   blotchVS,
    fragmentShader: blotchFS,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    uniforms:       { uIntensity: { value: 0.0 } },
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
      geometry: buildLayerGeometry(layer.blotches || [], planeWidth, planeHeight),
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
    layers.forEach(L => L.geometry.dispose());
    material.dispose();
  }, [layers, material]);

  useFrame(() => {
    // Active segment renders at full intensity; immediate neighbours dim out
    // so paintings overlap on the field rather than crossfading through black.
    const dist = Math.abs(mySegmentIndex - currentSegmentIndex);
    const intensity = dist === 0 ? 1.0 : Math.max(0.0, 0.6 - 0.3 * (dist - 1));
    material.uniforms.uIntensity.value = intensity;
  });

  if (!data || layers.length === 0) return null;

  return (
    <group position={position} rotation={rotEuler}>
      {layers.map((L, i) => (
        <mesh key={i} geometry={L.geometry} material={material} position={[0, 0, L.z]} />
      ))}
    </group>
  );
}
