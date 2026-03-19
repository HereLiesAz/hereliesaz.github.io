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

  // 1. Load data (same logic)
  useEffect(() => {
    if (!id || !nodes) return;
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    
    const fetchId = node.file || `${id}.json`;
    const fetchUrl = fetchId.startsWith('/') ? fetchId : `/data/${fetchId}`;

    fetch(fetchUrl)
      .then(res => res.json())
      .then(data => {
        const shards = data.shards || data.strokes || [];
        setShardData(shards);
        if (isCurrent) setCurrentShardCount(shards.length);
        
        const meta = data.meta || {};
        const res = data.resolution || meta.res || meta.resolution;
        if (res) setResolution(res);

        let fileName = data.file || meta.file || meta.original_file || node.file || `${id}.jpg`;
        
        // Safety: ensure we use the correct extension if it's a known mismatch
        // (In this environment, many .jpg are actually .jpeg or vice versa)
        if (fileName.endsWith('.json')) {
            fileName = fileName.replace('.json', '.jpg');
        }
        
        // For this specific broken asset in the graph
        if (fileName.includes('05605923-7437-4BCA-B38C-74A73763ECA3')) {
            fileName = fileName.replace('.jpg', '.jpeg');
        }

        setTextureUrl(`/assets/${fileName}`); 
      })
      .catch(err => console.error(`[ShardCloud] Error node ${id}:`, err));
  }, [id, nodes]);

  const texture = useLoader(THREE.TextureLoader, textureUrl || '/placeholder.jpg'); 

  // 3. Create Instanced Geometry
  const { geometry, count } = useMemo(() => {
    if (!shardData) return { geometry: null, count: 0 };

    const count = shardData.length;
    const baseGeo = new THREE.PlaneGeometry(1, 1); 
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = baseGeo.index;
    geo.attributes.position = baseGeo.attributes.position;
    geo.attributes.uv = baseGeo.attributes.uv;
    
    const aOffset = new Float32Array(count * 3);
    const aScale = new Float32Array(count * 2);
    const aRandom = new Float32Array(count * 3);
    const aColor = new Float32Array(count * 3); // NEW
    const aIndex = new Float32Array(count); 
    const aUvOffset = new Float32Array(count * 2);
    const aUvScale = new Float32Array(count * 2);

    const [imgW, imgH] = resolution;
    const worldWidth = 10 * (imgW / imgH);
    const FULCRUM_Z = -10.0;

    for (let i = 0; i < count; i++) {
        const shard = shardData[i];
        let nx, ny, depth, sw, sh, r, g, b;

        if (Array.isArray(shard)) {
            // Dense Format: [nx, ny, depth, rot, scale, r, g, b]
            nx = shard[0] / 10.0; 
            ny = shard[1] / 10.0;
            depth = shard[2]; 
            sw = shard[4] * 0.5;
            sh = shard[4] * 0.5;
            r = shard[5] / 255;
            g = shard[6] / 255;
            b = shard[7] / 255;
        } else {
            // Sparse/Object Format
            let x, y, w, h;
            if (shard.bbox) [x, y, w, h] = shard.bbox;
            else { x = shard.x || 0; y = shard.y || 0; w = shard.scale || 1; h = shard.scale || 1; }
            
            const col = shard.color || [100, 100, 100];
            r = col[0] / 255;
            g = col[1] / 255;
            b = col[2] / 255;

            nx = ((x + w / 2) / imgW) - 0.5;
            ny = -(((y + h / 2) / imgH) - 0.5); 
            depth = shard.depth !== undefined ? shard.depth : (shard.z || 0);
            sw = w / imgW;
            sh = h / imgH;
        }

        // Apply Forced Perspective Scaling
        const z = Array.isArray(shard) ? depth : - (depth * 50.0 + 5.0);
        const factor = z / FULCRUM_Z;

        aOffset[i * 3] = nx * worldWidth * factor;
        aOffset[i * 3 + 1] = ny * 10 * factor;
        aOffset[i * 3 + 2] = z; 

        aScale[i * 2] = sw * worldWidth * factor;
        aScale[i * 2 + 1] = sh * 10 * factor;

        aColor[i * 3] = r;
        aColor[i * 3 + 1] = g;
        aColor[i * 3 + 2] = b;
        
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
        materialRef.current.uAnchorId = anchorId !== undefined ? anchorId : -1.0;
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
