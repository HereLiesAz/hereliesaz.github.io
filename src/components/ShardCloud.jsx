import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import '../shaders/ShardMaterial'; // Register shader

export default function ShardCloud({ id, position, rotation }) {
  const meshRef = useRef();
  const materialRef = useRef();
  
  const nodes = useStore(state => state.nodes);
  const transitionProgress = useStore(state => state.transitionProgress);
  
  const [shardData, setShardData] = useState(null);
  const [textureUrl, setTextureUrl] = useState(null);

  // 1. Load Shard Data & Texture URL
  useEffect(() => {
    if (!id || !nodes) return;
    const node = nodes.find(n => n.id === id);
    if (!node) return;

    // Load Shard JSON
    fetch(`/data/${id}.json`)
      .then(res => res.json())
      .then(data => {
        setShardData(data.shards);
        // Assuming original image is available in public/assets or similar
        // For now, let's assume raw images are copied to public/images during build or available via proxy
        // The curator doesn't copy images to public/data, it just references them.
        // We need the image URL. In a real app, we'd have processed assets.
        // Fallback: use a placeholder or try to find the image.
        // For this demo, we assume images are in /assets/raw and accessible (which they aren't by default in Vite public).
        // WE NEED TO FIX THIS: Curator should probably copy the image to public/data or we assume a path.
        // Let's assume the image is at `/data/${id}.jpg` (we might need to add a copy step in curator, but for now we assume it exists).
        setTextureUrl(`/data/${id}.jpg`); 
      })
      .catch(err => console.error("Shard Load Error:", err));
  }, [id, nodes]);

  // 2. Load Texture
  const texture = useLoader(THREE.TextureLoader, textureUrl || '/placeholder.jpg'); // Fallback

  // 3. Create Instanced Geometry
  const { geometry, count } = useMemo(() => {
    if (!shardData) return { geometry: null, count: 0 };

    const count = shardData.length;
    const geo = new THREE.PlaneGeometry(1, 1); // Base Quad
    
    // Attributes
    const aOffset = new Float32Array(count * 3);
    const aScale = new Float32Array(count);
    const aRandom = new Float32Array(count * 3);
    const aUvOffset = new Float32Array(count * 2);
    const aUvScale = new Float32Array(count * 2);

    // Fill attributes
    for (let i = 0; i < count; i++) {
        const shard = shardData[i];
        
        // Position (Center of the shard)
        // Normalize coordinates (0..1) to World (-0.5..0.5 * Aspect)
        // Assuming 1000x1000 image for normalization if not provided
        // We need image dimensions. Let's assume standard square for now or normalize based on data.
        // The JSON has bbox [x, y, w, h].
        
        // Let's assume the scene unit is 10x10 for the image.
        // x, y are top-left?
        const x = (shard.bbox[0] + shard.bbox[2]/2) / 1000 - 0.5;
        const y = -((shard.bbox[1] + shard.bbox[3]/2) / 1000 - 0.5); // Flip Y
        const z = shard.depth ? shard.depth * 0.1 : 0; // Scale depth

        aOffset[i * 3] = x * 10;
        aOffset[i * 3 + 1] = y * 10;
        aOffset[i * 3 + 2] = z;

        // Scale
        // We want the quad to match the bbox size
        // If plane is 1x1, scale should be w/1000 * 10
        aScale[i] = (shard.bbox[2] / 1000) * 10; 
        
        // Random
        aRandom[i * 3] = Math.random();
        aRandom[i * 3 + 1] = Math.random();
        aRandom[i * 3 + 2] = Math.random();

        // UVs
        // Map the quad UVs (0..1) to the texture portion
        // We need a custom shader to use these instance attributes for UV mapping.
        // OR we just rely on the texture being mapped to the whole quad and we use texture offset/repeat?
        // But InstancedMesh shares the material.
        // So we MUST calculate UVs in the vertex shader using aUvOffset/Scale.
        aUvOffset[i * 2] = shard.bbox[0] / 1000;
        aUvOffset[i * 2 + 1] = shard.bbox[1] / 1000;
        
        aUvScale[i * 2] = shard.bbox[2] / 1000;
        aUvScale[i * 2 + 1] = shard.bbox[3] / 1000;
    }

    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(aOffset, 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 1));
    geo.setAttribute('aRandom', new THREE.InstancedBufferAttribute(aRandom, 3));
    geo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(aUvOffset, 2));
    geo.setAttribute('aUvScale', new THREE.InstancedBufferAttribute(aUvScale, 2));

    return { geometry: geo, count };
  }, [shardData]);

  // 4. Update Uniforms
  useFrame((state) => {
    if (materialRef.current) {
        materialRef.current.uTime = state.clock.elapsedTime;
        materialRef.current.uProgress = transitionProgress;
    }
  });

  if (!geometry) return null;

  return (
    <instancedMesh 
      ref={meshRef} 
      args={[geometry, null, count]} 
      position={position} 
      rotation={rotation}
    >
      <shardMaterial 
        ref={materialRef} 
        uTexture={texture} 
        transparent 
        depthWrite={false}
      />
    </instancedMesh>
  );
}
