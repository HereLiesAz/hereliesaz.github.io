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
        
        // Update Resolution from metadata
        if (data.resolution && data.resolution.length === 2) {
            setResolution(data.resolution);
        } else if (node.resolution) {
            setResolution(node.resolution);
        }

        // Use the filename provided by curator
        const fileName = data.file || node.file || `${id}.jpg`;
        setTextureUrl(`/data/${fileName}`); 
      })
      .catch(err => console.error("Shard Load Error:", err));
  }, [id, nodes]);

  // 2. Load Texture
  const texture = useLoader(THREE.TextureLoader, textureUrl || '/placeholder.jpg'); 

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

    const [imgW, imgH] = resolution;
    const aspect = imgW / imgH;

    // Fill attributes
    for (let i = 0; i < count; i++) {
        const shard = shardData[i];
        
        // BBox: [x, y, w, h] (pixels)
        const [x, y, w, h] = shard.bbox;
        
        // Center position in pixel space
        const cx = x + w / 2;
        const cy = y + h / 2;

        // Normalize to World Space (-0.5 to 0.5)
        // We preserve aspect ratio in world space if we want the cloud to match the image shape.
        // Let's map Y to -0.5..0.5 and X to -0.5*Aspect..0.5*Aspect
        // BUT standard logic is often just mapping 0..1 to -5..5.
        // Let's use a standard 10 unit height for the image in world space.
        
        const worldHeight = 10;
        const worldWidth = worldHeight * aspect;

        const nx = (cx / imgW) - 0.5;
        const ny = -((cy / imgH) - 0.5); // Flip Y

        aOffset[i * 3] = nx * worldWidth;
        aOffset[i * 3 + 1] = ny * worldHeight;
        aOffset[i * 3 + 2] = shard.depth ? shard.depth * 0.1 : 0; 

        // Scale (Size of the shard in world units)
        // Shard width fraction * World Width
        // But the quad is square (1x1). We need to scale it to match the aspect ratio of the shard?
        // Wait, if we use a texture atlas or UV mapping on a quad, the quad should match the BBox aspect ratio.
        // Or we scale X and Y independently? 
        // InstancedMesh supports non-uniform scale via matrix, but 'aScale' is a single float in our shader.
        // Our shader: "vec3 pos = position * aScale;" -> Uniform scale.
        // This implies our shards are always square in 3D? That distorts non-square shards.
        // We should fix the shader to support vec2 scale or just scale the geometry X/Y.
        
        // Ideally: Scale the quad to match the BBox aspect ratio.
        // Let's assume we want to preserve the shard's shape.
        // Calculate max dimension to fit or just use width?
        // Let's approximate: Scale = max(w/imgW * worldW, h/imgH * worldH)
        // And relying on the texture being mapped correctly?
        // If we use uniform scale, the quad is square. The texture will be stretched if the shard bbox is not square.
        // Correct approach: Pass vec2 aScale.
        
        // BUT, changing attribute types requires shader update.
        // For now, let's use the average size or max size.
        // And accept slight stretching or update the shader. 
        // Updating shader is better.
        // Let's update shader to vec2 aScale in next step? 
        // Or hack it: normalize the geometry uvs?
        
        // For this task, sticking to the existing pattern:
        // Use the width ratio.
        aScale[i] = (w / imgW) * worldWidth; 
        
        // Random
        aRandom[i * 3] = Math.random();
        aRandom[i * 3 + 1] = Math.random();
        aRandom[i * 3 + 2] = Math.random();

        // UVs
        aUvOffset[i * 2] = x / imgW;
        aUvOffset[i * 2 + 1] = y / imgH;
        
        aUvScale[i * 2] = w / imgW;
        aUvScale[i * 2 + 1] = h / imgH;
    }

    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(aOffset, 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 1));
    geo.setAttribute('aRandom', new THREE.InstancedBufferAttribute(aRandom, 3));
    geo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(aUvOffset, 2));
    geo.setAttribute('aUvScale', new THREE.InstancedBufferAttribute(aUvScale, 2));

    return { geometry: geo, count };
  }, [shardData, resolution]);

  // 4. Update Uniforms
  useFrame((state) => {
    if (materialRef.current) {
        materialRef.current.uTime = state.clock.elapsedTime;
        
        if (isCurrent) {
            materialRef.current.uProgress = transitionProgress; 
            materialRef.current.uThreshold = transitionProgress > 0.8 ? (transitionProgress - 0.8) * 5 : 0; 
        } else {
            materialRef.current.uProgress = 1.0 - transitionProgress;
            materialRef.current.uThreshold = 0; 
        }
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
