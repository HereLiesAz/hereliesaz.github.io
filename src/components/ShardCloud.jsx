import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import '../shaders/ShardMaterial'; // Register shader

export default function ShardCloud({ id, position, rotation, isCurrent = false }) {
  const meshRef = useRef();
  const materialRef = useRef();
  
  const nodes = useStore(state => state.nodes);
  const transitionProgress = useStore(state => state.transitionProgress);
  
  const [shardData, setShardData] = useState(null);
  const [textureUrl, setTextureUrl] = useState(null);
  const [resolution, setResolution] = useState([1000, 1000]); // Default fallback

  const setCurrentShardCount = useStore(state => state.setCurrentShardCount);

  // 1. Load Shard Data & Texture URL
  useEffect(() => {
    if (!id || !nodes) return;
    
    // 1. Identify Fetch URL
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    
    const fetchId = node.file || `${id}.json`;
    const fetchUrl = fetchId.startsWith('/') ? fetchId : `/data/${fetchId}`;

    fetch(fetchUrl)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error(`Invalid Response: Expected JSON, got ${contentType}`);
        }
        return res.json();
      })
      .then(data => {
        // Support both "shards" (from my plan) and "strokes" (from existing data)
        const shards = data.shards || data.strokes || [];
        setShardData(shards);
        
        // Sync to global store for UI overlay
        if (isCurrent) {
            setCurrentShardCount(shards.length);
        }
        
        // Update Resolution: Try data.meta.res (existing) or data.resolution (plan)
        const res = data.resolution || (data.meta && data.meta.res);
        if (res && res.length === 2) {
            setResolution(res);
        } else if (node.resolution) {
            setResolution(node.resolution);
        }

        // Use the filename for texture, or try data.meta.file
        const fileName = data.file || (data.meta && data.meta.file) || node.file || `${id}.jpg`;
        setTextureUrl(`/data/${fileName}`); 
      })
      .catch(err => {
        console.error(`[ShardCloud] Failed to load node "${id}":`, err.message);
        // Fallback or show error state if needed
      });
  }, [id, nodes]);

  // 2. Load Texture
  const texture = useLoader(THREE.TextureLoader, textureUrl || '/placeholder.jpg'); 

  // 3. Create Instanced Geometry
  const { geometry, count } = useMemo(() => {
    if (!shardData) return { geometry: null, count: 0 };

    const count = shardData.length;
    const baseGeo = new THREE.PlaneGeometry(1, 1); 
    const geo = new THREE.InstancedBufferGeometry();
    
    // Copy base geometry attributes
    geo.index = baseGeo.index;
    geo.attributes.position = baseGeo.attributes.position;
    geo.attributes.uv = baseGeo.attributes.uv;
    
    // Custom Instance Attributes
    const aOffset = new Float32Array(count * 3);
    const aScale = new Float32Array(count * 2);
    const aRandom = new Float32Array(count * 3);
    const aUvOffset = new Float32Array(count * 2);
    const aUvScale = new Float32Array(count * 2);

    const [imgW, imgH] = resolution;
    const aspect = imgW / imgH;

    const worldHeight = 10;
    const worldWidth = worldHeight * aspect;
    const FULCRUM_Z = -10.0; // The vantage point from which it aligns

    for (let i = 0; i < count; i++) {
        const shard = shardData[i];
        if (!shard || (!shard.bbox && !shard.x)) continue;
        
        // Support both Curator (bbox) and Grinder/Strokes (x, y, scale)
        let x, y, w, h;
        if (shard.bbox) {
            [x, y, w, h] = shard.bbox;
        } else {
            // Fallback for stroke-based data
            x = shard.x || 0;
            y = shard.y || 0;
            w = shard.scale || 1;
            h = shard.scale || 1;
        }
        
        const cx = x + w / 2;
        const cy = y + h / 2;

        const nx = (cx / imgW) - 0.5;
        const ny = -((cy / imgH) - 0.5); 

        // WORLD DEPTH (Static)
        // Ensure depth is negative (away from camera)
        const depth = shard.depth !== undefined ? shard.depth : (shard.z || 0);
        const z = - (depth * 50.0 + 5.0); // Spread it out in the void

        // FORCED PERSPECTIVE FACTOR
        // From vantage FULCRUM_Z, the shard should look like its 2D self
        const factor = z / FULCRUM_Z;

        aOffset[i * 3] = nx * worldWidth * factor;
        aOffset[i * 3 + 1] = ny * worldHeight * factor;
        aOffset[i * 3 + 2] = z; 

        aScale[i * 2] = (w / imgW) * worldWidth * factor;
        aScale[i * 2 + 1] = (h / imgH) * worldHeight * factor;
        
        aRandom[i * 3] = Math.random();
        aRandom[i * 3 + 1] = Math.random();
        aRandom[i * 3 + 2] = Math.random();

        aUvOffset[i * 2] = x / imgW;
        aUvOffset[i * 2 + 1] = y / imgH;
        
        aUvScale[i * 2] = w / imgW;
        aUvScale[i * 2 + 1] = h / imgH;
    }

    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(aOffset, 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 2));
    geo.setAttribute('aRandom', new THREE.InstancedBufferAttribute(aRandom, 3));
    geo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(aUvOffset, 2));
    geo.setAttribute('aUvScale', new THREE.InstancedBufferAttribute(aUvScale, 2));

    geo.instanceCount = count; 

    return { geometry: geo, count };
  }, [shardData, resolution]);

  // 4. Update Uniforms
  useFrame((state) => {
    if (materialRef.current) {
        materialRef.current.uTime = state.clock.elapsedTime;
    }
  });

  if (!geometry) return null;

  return (
    <mesh 
      ref={meshRef} 
      geometry={geometry}
      position={position} 
      rotation={rotation}
      frustumCulled={false}
    >
      <shardMaterial 
        ref={materialRef} 
        uTexture={texture} 
        transparent 
        depthWrite={false}
      />
    </mesh>
  );
}
