import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import '../shaders/ShardMaterial'; // Register shader

export default function ShardCloud({ id, position, rotation, isCurrent = false, anchorId }) {
  const meshRef = useRef();
  const materialRef = useRef();
  
  const nodes = useStore(state => state.nodes);
  const transitionProgress = useStore(state => state.transitionProgress);
  
  const [shardData, setShardData] = useState(null);
  const [textureUrl, setTextureUrl] = useState(null);
  const [resolution, setResolution] = useState([1000, 1000]); 

  const setCurrentShardCount = useStore(state => state.setCurrentShardCount);

  // 1. Load data (Fixed Pathing)
  useEffect(() => {
    if (!id || !nodes) return;
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    
    // Always fetch metadata from /data/
    let fetchId = node.file || `${id}.json`;
    if (fetchId.includes('/')) fetchId = fetchId.split('/').pop();
    const fetchUrl = `/data/${fetchId}`;

    fetch(fetchUrl)
      .then(res => res.json())
      .then(data => {
        if (!data || !data.shards && !data.strokes) return;

        const shards = data.shards || data.strokes || [];
        setShardData(shards);
        if (isCurrent) setCurrentShardCount(shards.length);
        
        const meta = data.meta || {};
        const res = data.resolution || meta.res || meta.resolution;
        if (res) setResolution(res);

        // --- ROBUST IMAGE DISCOVERY ---
        let baseName = node.id || id;
        let fileName = `${baseName}.jpg`; // Most common

        // For known exceptions:
        if (baseName.includes('05605923-7437-4BCA-B38C-74A73763ECA3')) fileName = `${baseName}.jpeg`;
        if (baseName.includes('141BE158-DE05-4670-8C0A-38E39B25A312')) fileName = `${baseName}.jpeg`;
        
        setTextureUrl(`/assets/${fileName}`); 
      })
      .catch(err => {
        console.error(`[ShardCloud] Error node ${id}:`, err);
        // Fallback texture path if fetch fails
        setTextureUrl('/placeholder.jpg');
      });
  }, [id, nodes, isCurrent, setCurrentShardCount]);

  const texture = useLoader(THREE.TextureLoader, textureUrl || '/placeholder.jpg'); 

  // 3. Create Instanced Geometry
  const { geometry, count } = useMemo(() => {
    if (!shardData) return { geometry: null, count: 0 };

    // --- DENSITY THROTTLING (Fix for 60fps) ---
    const MAX_SHARDS = 2000;
    const finalShardData = shardData.length > MAX_SHARDS 
        ? [...shardData].sort((a,b) => (b[4] || 0) - (a[4] || 0)).slice(0, MAX_SHARDS)
        : shardData;

    const count = finalShardData.length;
    const baseGeo = new THREE.PlaneGeometry(1, 1); 
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = baseGeo.index;
    geo.attributes.position = baseGeo.attributes.position;
    geo.attributes.uv = baseGeo.attributes.uv;
    
    const aOffset = new Float32Array(count * 3);
    const aScale = new Float32Array(count * 2);
    const aRandom = new Float32Array(count * 3);
    const aColor = new Float32Array(count * 3); 
    const aIndex = new Float32Array(count); 
    const aUvOffset = new Float32Array(count * 2);
    const aUvScale = new Float32Array(count * 2);

    const [imgW, imgH] = resolution;
    const worldWidth = 10 * (imgW / imgH);
    const FULCRUM_Z = -10.0;

    for (let i = 0; i < count; i++) {
        const shard = finalShardData[i];
        let nx, ny, raw_depth, sw, sh, r, g, b;

        if (Array.isArray(shard)) {
            nx = shard[0] / 10.0; 
            ny = shard[1] / 10.0;
            raw_depth = shard[2]; 
            sw = shard[4] * 0.5;
            sh = shard[4] * 0.5;
            r = shard[5] / 255;
            g = shard[6] / 255;
            b = shard[7] / 255;
        } else {
            let x, y, w, h;
            if (shard.bbox) [x, y, w, h] = shard.bbox;
            else { x = shard.x || 0; y = shard.y || 0; w = shard.scale || 1; h = shard.scale || 1; }
            
            const col = shard.color || [100, 100, 100];
            r = col[0] / 255;
            g = col[1] / 255;
            b = col[2] / 255;

            nx = ((x + w / 2) / imgW) - 0.5;
            ny = -(((y + h / 2) / imgH) - 0.5); 
            raw_depth = shard.depth !== undefined ? shard.depth : (shard.z || 0);
            sw = w / imgW;
            sh = h / imgH;
        }

        // --- MASSIVE Z-SPREAD (FIXED MAPPING) ---
        // Shard depth is already negative (e.g. -44), we map it to -10 -> -110 range
        const z = raw_depth * 2.5; 
        const factor = z / FULCRUM_Z;

        aOffset[i * 3] = nx * worldWidth * factor;
        aOffset[i * 3 + 1] = ny * 10 * factor;
        aOffset[i * 3 + 2] = z; 

        // --- SHARD UPSCALING (Anti-Sand) ---
        const SIZE_MULTIPLIER = 12.0; 
        aScale[i * 2] = sw * worldWidth * factor * SIZE_MULTIPLIER;
        aScale[i * 2 + 1] = sh * 10 * factor * SIZE_MULTIPLIER;

        aColor[i * 3] = Math.max(0.01, r || 1.0);
        aColor[i * 3 + 1] = Math.max(0.01, g || 1.0);
        aColor[i * 3 + 2] = Math.max(0.01, b || 1.0);
        
        aRandom[i * 3] = Math.random();
        aRandom[i * 3 + 1] = Math.random();
        aRandom[i * 3 + 2] = Math.random();

        aIndex[i] = i; 

        aUvOffset[i * 2] = 0;
        aUvOffset[i * 2 + 1] = 0;
        aUvScale[i * 2] = 1;
        aUvScale[i * 2 + 1] = 1;
    }

    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(aOffset, 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 2));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3)); // NEW
    geo.setAttribute('aRandom', new THREE.InstancedBufferAttribute(aRandom, 3));
    geo.setAttribute('aIndex', new THREE.InstancedBufferAttribute(aIndex, 1));
    geo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(aUvOffset, 2));
    geo.setAttribute('aUvScale', new THREE.InstancedBufferAttribute(aUvScale, 2));
    geo.instanceCount = count; 
    return { geometry: geo, count };
  }, [shardData, resolution]);

  // 4. Update Uniforms
  useFrame((state) => {
    if (materialRef.current) {
        materialRef.current.uTime = state.clock.elapsedTime;
        
        // Glow peaks at transitionProgress 0.5 (Mid-void)
        const glowPhase = Math.sin(transitionProgress * Math.PI);
        materialRef.current.uAnchorGlow = glowPhase * 0.8;
        materialRef.current.uAnchorId = anchorId !== undefined ? Number(anchorId) : -1.0;
    }
  });

  if (!geometry) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} position={position} rotation={rotation} frustumCulled={false}>
      <shardMaterial 
        ref={materialRef} 
        uTexture={texture} 
        transparent 
        depthWrite={false}
        uAnchorId={-1.0}
        uAnchorGlow={0.0}
      />
    </mesh>
  );
}
