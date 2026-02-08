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
        // Handle Binary Data
        if (data.binary) {
            Promise.all([
                fetch(`/data/${id}_pos.bin`).then(r => r.arrayBuffer()),
                fetch(`/data/${id}_scale.bin`).then(r => r.arrayBuffer()),
                fetch(`/data/${id}_uv.bin`).then(r => r.arrayBuffer()),
                fetch(`/data/${id}_random.bin`).then(r => r.arrayBuffer())
            ]).then(([posBuf, scaleBuf, uvBuf, randomBuf]) => {
                // Determine count from buffer size (posBuf is stride 3 * 4 bytes)
                const count = posBuf.byteLength / (3 * 4);

                setShardData({
                    binary: true,
                    count: count,
                    pos: new Float32Array(posBuf),
                    scale: new Float32Array(scaleBuf),
                    uv: new Float32Array(uvBuf),
                    random: new Float32Array(randomBuf)
                });
            }).catch(e => console.error("Binary Fetch Error", e));
        } else {
            // Legacy Mode
            setShardData({ binary: false, shards: data.shards });
        }
        
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

    const geo = new THREE.PlaneGeometry(1, 1); // Base Quad

    // --- BINARY MODE ---
    if (shardData.binary) {
        const count = shardData.count;

        geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(shardData.pos, 3));
        geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(shardData.scale, 1));
        geo.setAttribute('aRandom', new THREE.InstancedBufferAttribute(shardData.random, 3));

        // UVs are interleaved [u, v, su, sv]
        const uvBuffer = new THREE.InstancedInterleavedBuffer(shardData.uv, 4);
        geo.setAttribute('aUvOffset', new THREE.InterleavedBufferAttribute(uvBuffer, 2, 0));
        geo.setAttribute('aUvScale', new THREE.InterleavedBufferAttribute(uvBuffer, 2, 2));

        // Depth is stored in aOffset.z. For shader compatibility, we can point aDepth to it.
        // aOffset is stride 3 (x,y,z). aDepth expects float.
        // Use interleaved buffer from pos array
        const posBuffer = new THREE.InstancedInterleavedBuffer(shardData.pos, 3);
        geo.setAttribute('aDepth', new THREE.InterleavedBufferAttribute(posBuffer, 1, 2));

        return { geometry: geo, count };
    }

    // --- LEGACY JSON MODE ---
    const shards = shardData.shards;
    const count = shards.length;
    
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
        const shard = shards[i];
        
        // BBox: [x, y, w, h] (pixels)
        const [x, y, w, h] = shard.bbox;
        
        // Center position in pixel space
        const cx = x + w / 2;
        const cy = y + h / 2;

        const worldHeight = 10;
        const worldWidth = worldHeight * aspect;

        const nx = (cx / imgW) - 0.5;
        const ny = -((cy / imgH) - 0.5); // Flip Y

        aOffset[i * 3] = nx * worldWidth;
        aOffset[i * 3 + 1] = ny * worldHeight;
        aOffset[i * 3 + 2] = shard.depth ? shard.depth * 0.1 : 0; 

        // Scale
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

    // Legacy attributes
    // Use InstancedInterleavedBuffer for aOffset + aDepth (z) to match binary style
    const posBuffer = new THREE.InstancedInterleavedBuffer(aOffset, 3);
    geo.setAttribute('aOffset', new THREE.InterleavedBufferAttribute(posBuffer, 3, 0));
    geo.setAttribute('aDepth', new THREE.InterleavedBufferAttribute(posBuffer, 1, 2)); // Use Z as depth

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
