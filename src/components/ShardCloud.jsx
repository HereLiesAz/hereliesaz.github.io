import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { useScroll as useDreiScroll } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import '../shaders/ShardMaterial'; // Register shader

export default function ShardCloud({ id, position, rotation, isCurrent = false, anchorId }) {
  const meshRef = useRef();
  const materialRef = useRef();
  
  const nodes = useStore(state => state.nodes);
  
  const [shardData, setShardData] = useState(null);
  const [textureUrl, setTextureUrl] = useState(null);
  const [resolution, setResolution] = useState([1000, 1000]); 

  const setCurrentShardCount = useStore(state => state.setCurrentShardCount);
  const setCurrentResolution = useStore(state => state.setCurrentResolution);

  // 1. Load Baked Data
  useEffect(() => {
    if (!id) return;
    
    const fetchUrl = `/data/baked/${id}.baked.json`;

    fetch(fetchUrl)
      .then(res => res.json())
      .then(data => {
        setShardData(data);
        if (data.res) setResolution(data.res);

        // --- IMAGE DISCOVERY ---
        let baseName = id;
        let fileName = `${baseName}.jpg`;
        if (baseName.includes('05605923-7437-4BCA-B38C-74A73763ECA3')) fileName = `${baseName}.jpeg`;
        if (baseName.includes('141BE158-DE05-4670-8C0A-38E39B25A312')) fileName = `${baseName}.jpeg`;
        setTextureUrl(`/assets/${fileName}`); 
      })
      .catch(err => {
        console.error(`[ShardCloud] Error loading baked data for ${id}:`, err);
        setTextureUrl('/placeholder.jpg');
      });
  }, [id]);

  // 2. Sync Metadata with Store
  useEffect(() => {
    if (isCurrent && shardData && resolution) {
        setCurrentShardCount(shardData.count || 0); 
        setCurrentResolution(resolution);
    }
  }, [isCurrent, shardData, resolution]);

  // 1. Suspension-based Texture Loader
  const texture = useLoader(THREE.TextureLoader, textureUrl || '/placeholder.jpg');
  useEffect(() => {
    if (texture) {
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false; 
    }
  }, [texture, textureUrl]);

  // 3. Create Instanced Geometry (Instantly from Baked attributes)
  const { geometry, count } = useMemo(() => {
    if (!shardData || !shardData.aOffset) return { geometry: null, count: 0 };

    const count = shardData.count;
    const geo = new THREE.InstancedBufferGeometry();
    const baseGeo = new THREE.PlaneGeometry(1, 1);
    
    geo.index = baseGeo.index;
    geo.attributes.position = baseGeo.attributes.position;
    geo.attributes.uv = baseGeo.attributes.uv;
    
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(shardData.aOffset), 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(new Float32Array(shardData.aScale), 2));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(shardData.aColor), 3)); 
    geo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(new Float32Array(shardData.aUvOffset), 2));
    geo.setAttribute('aUvScale', new THREE.InstancedBufferAttribute(new Float32Array(shardData.aUvScale), 2));
    
    // aRandom and aIndex (Runtime generated or baked)
    // For consistency with shader, we can bake these too, but they are easy to recreate.
    const aRandom = new Float32Array(count * 3);
    const aIndex = new Float32Array(count);
    for(let i=0; i<count; i++) {
        aRandom[i*3] = Math.random();
        aRandom[i*3+1] = Math.random();
        aRandom[i*3+2] = Math.random();
        aIndex[i] = i;
    }
    geo.setAttribute('aRandom', new THREE.InstancedBufferAttribute(aRandom, 3));
    geo.setAttribute('aIndex', new THREE.InstancedBufferAttribute(aIndex, 1));

    geo.instanceCount = count; 
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius = 150; 
    return { geometry: geo, count };
  }, [shardData]);

  // Shared color object to avoid GC pressure (60 FPS Fix)
  const tempColor = useMemo(() => new THREE.Color(), []);

  const scroll = useDreiScroll();

  // 4. Update Uniforms (Direct Read)
  useFrame((state) => {
    if (materialRef.current) {
        materialRef.current.uTime = state.clock.elapsedTime;
        
        // --- PERFORMANCE FIX: Read scroll directly instead of store ---
        const r = scroll.offset;
        
        // Art 1 (Source) is at offset 0, fades OUT to next.
        // Art 2 (Target) is at offset 1 (next), fades IN.
        const alphaFade = isCurrent ? (1.0 - r) : r;
        
        tempColor.setRGB(alphaFade, alphaFade, alphaFade);
        materialRef.current.uColor = tempColor;
        
        const glowPhase = Math.sin(r * Math.PI);
        materialRef.current.uAnchorGlow = glowPhase * 0.8;
        materialRef.current.uAnchorId = anchorId !== undefined ? Number(anchorId) : -1.0;
    }
  });

  if (!geometry || !texture) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} position={position} rotation={rotation} frustumCulled={true}>
      <shardMaterial 
        ref={materialRef} 
        uTexture={texture} 
        uHasTexture={(texture?.image && texture.image.width > 0) ? 1.0 : 0.0}
        transparent={true}
        depthWrite={true}
        alphaTest={0.01}
      />
    </mesh>
  );
}
