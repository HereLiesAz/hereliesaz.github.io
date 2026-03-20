import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { shardRandom } from '../utils/hash.js';
import { MAX_INSTANCES, MAX_PER_SLOT } from '../store/storeHelpers.js';
import '../shaders/ShardMaterial';

// Attribute strides
const STRIDES = { aOffset: 3, aScale: 2, aColor: 3, aUvOffset: 2, aUvScale: 2, aRandom: 3, aSweetSpotZ: 1 };
const TOTAL_FLOATS_PER_INSTANCE = Object.values(STRIDES).reduce((a, b) => a + b, 0);

function allocateBuffers(maxInstances) {
  return {
    aOffset:    new Float32Array(maxInstances * 3),
    aScale:     new Float32Array(maxInstances * 2),
    aColor:     new Float32Array(maxInstances * 3),
    aUvOffset:  new Float32Array(maxInstances * 2),
    aUvScale:   new Float32Array(maxInstances * 2),
    aRandom:    new Float32Array(maxInstances * 3),
    aSweetSpotZ:new Float32Array(maxInstances * 1),
  };
}

function writeBakedDataIntoBuffers(buffers, offset, bakedData, sweetSpotZ, paintingId) {
  const { aOffset: aO, aScale: aS, aColor: aC, aUvOffset: aUvO, aUvScale: aUvS,
          aRandom: aR, aSweetSpotZ: aSZ } = buffers;
  const tc = bakedData.count;

  for (let i = 0; i < tc; i++) {
    const bi = offset + i;

    // aOffset — translate baked Z to world space
    aO[bi * 3 + 0] = bakedData.aOffset[i * 3 + 0];
    aO[bi * 3 + 1] = bakedData.aOffset[i * 3 + 1];
    aO[bi * 3 + 2] = bakedData.aOffset[i * 3 + 2] + sweetSpotZ;

    aS[bi * 2 + 0]  = bakedData.aScale[i * 2 + 0];
    aS[bi * 2 + 1]  = bakedData.aScale[i * 2 + 1];

    aC[bi * 3 + 0]  = bakedData.aColor[i * 3 + 0];
    aC[bi * 3 + 1]  = bakedData.aColor[i * 3 + 1];
    aC[bi * 3 + 2]  = bakedData.aColor[i * 3 + 2];

    aUvO[bi * 2 + 0] = bakedData.aUvOffset[i * 2 + 0];
    aUvO[bi * 2 + 1] = bakedData.aUvOffset[i * 2 + 1];

    aUvS[bi * 2 + 0] = bakedData.aUvScale[i * 2 + 0];
    aUvS[bi * 2 + 1] = bakedData.aUvScale[i * 2 + 1];

    // aRandom: deterministic from painting id + shard index
    const [r0, r1, r2] = shardRandom(paintingId, i);
    aR[bi * 3 + 0] = r0;
    aR[bi * 3 + 1] = r1;
    aR[bi * 3 + 2] = r2;

    aSZ[bi] = sweetSpotZ;
  }
}

export default function VoidField() {
  const geoRef      = useRef();
  const materialRef = useRef();

  const history         = useStore(s => s.history);
  const historyPosition = useStore(s => s.historyPosition);
  const nodes           = useStore(s => s.nodes);
  const rolloverCount   = useStore(s => s.rolloverCount);
  const cameraZ         = useStore(s => s.cameraZ);

  // CPU-side buffers (pre-allocated)
  const buffers = useMemo(() => allocateBuffers(MAX_INSTANCES), []);

  // Staging area for next-next painting
  const staging = useRef({ data: null, id: null, sweetZ: null });
  const slot0Count = useRef(0);
  const slot1Count = useRef(0);

  // Build the InstancedBufferGeometry once
  const geometry = useMemo(() => {
    const geo      = new THREE.InstancedBufferGeometry();
    const baseGeo  = new THREE.PlaneGeometry(1, 1);
    geo.index      = baseGeo.index;
    geo.attributes.position = baseGeo.attributes.position;
    geo.attributes.uv       = baseGeo.attributes.uv;

    geo.setAttribute('aOffset',    new THREE.InstancedBufferAttribute(buffers.aOffset,    3));
    geo.setAttribute('aScale',     new THREE.InstancedBufferAttribute(buffers.aScale,     2));
    geo.setAttribute('aColor',     new THREE.InstancedBufferAttribute(buffers.aColor,     3));
    geo.setAttribute('aUvOffset',  new THREE.InstancedBufferAttribute(buffers.aUvOffset,  2));
    geo.setAttribute('aUvScale',   new THREE.InstancedBufferAttribute(buffers.aUvScale,   2));
    geo.setAttribute('aRandom',    new THREE.InstancedBufferAttribute(buffers.aRandom,    3));
    geo.setAttribute('aSweetSpotZ',new THREE.InstancedBufferAttribute(buffers.aSweetSpotZ,1));

    geo.instanceCount = 0;
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius = 500;
    return geo;
  }, []);

  // Load baked data for a painting id
  const loadBaked = useCallback(async (id) => {
    const res  = await fetch(`/data/baked/${id}.baked.json`);
    return res.json();
  }, []);

  // Write a painting into a slot and mark attributes dirty
  const writeSlot = useCallback((slotOffset, bakedData, sweetZ, paintingId, count) => {
    writeBakedDataIntoBuffers(buffers, slotOffset, bakedData, sweetZ, paintingId);
    Object.values(geometry.attributes).forEach(attr => { attr.needsUpdate = true; });
    geometry.instanceCount = slotOffset + bakedData.count;
  }, [buffers, geometry]);

  // Initial load: slot 0 = current, slot 1 = next
  useEffect(() => {
    if (historyPosition < 0 || history.length < 2) return;

    const entry0 = history[historyPosition];
    const entry1 = history[historyPosition + 1];
    if (!entry0 || !entry1) return;

    (async () => {
      const [d0, d1] = await Promise.all([
        loadBaked(entry0.id),
        loadBaked(entry1.id),
      ]);
      writeBakedDataIntoBuffers(buffers, 0,                d0, entry0.sweetZ, entry0.id);
      writeBakedDataIntoBuffers(buffers, d0.count,    d1, entry1.sweetZ, entry1.id);
      slot0Count.current = d0.count;
      slot1Count.current = d1.count;
      Object.values(geometry.attributes).forEach(a => { a.needsUpdate = true; });
      geometry.instanceCount = d0.count + d1.count;
    })();
  }, [historyPosition >= 0]); // run once on init

  // Rollover: roll slot 1 → slot 0, write staging into slot 1
  useEffect(() => {
    if (rolloverCount === 0) return;
    if (!staging.current.data) return;

    const { data, id, sweetZ } = staging.current;
    const c0 = slot1Count.current;

    // Copy slot 1 typed arrays into slot 0 position
    Object.entries(STRIDES).forEach(([name, stride]) => {
      const src = buffers[name].subarray(slot0Count.current * stride, (slot0Count.current + slot1Count.current) * stride);
      buffers[name].set(src, 0);
    });

    // Write staging into slot 1
    writeBakedDataIntoBuffers(buffers, c0, data, sweetZ, id);
    slot0Count.current = c0;
    slot1Count.current = data.count;

    Object.values(geometry.attributes).forEach(a => { a.needsUpdate = true; });
    geometry.instanceCount = c0 + data.count;
    staging.current = { data: null, id: null, sweetZ: null };
  }, [rolloverCount]);

  // Preload next-next painting into staging
  const nextPaintingId = useStore(s => s.nextPaintingId);
  useEffect(() => {
    if (!nextPaintingId || staging.current.id === nextPaintingId) return;
    const nextEntry = history.find(e => e.id === nextPaintingId);
    if (!nextEntry) return;

    loadBaked(nextPaintingId).then(data => {
      staging.current = { data, id: nextPaintingId, sweetZ: nextEntry.sweetZ };
    });
  }, [nextPaintingId]);

  // Per-frame uniform updates
  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uCameraZ = cameraZ;
      materialRef.current.uTime    = clock.elapsedTime;
    }
  });

  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <shardMaterial
        ref={materialRef}
        uCameraZ={0}
        uTime={0}
        uFocusWindow={60}
        uHasTexture={0}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}