import React, { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AnamorphicShader } from '../shaders/AnamorphicShader';

const MAX_STROKES = 20000; 
const DATA_PATH = '/data/';

const InfiniteCanvas = ({ activePaintingId, transitionProgress }) => {
  const meshRef = useRef();
  const shaderMaterialRef = useRef();
  const [dataLoaded, setDataLoaded] = useState(false);
  
  // 1. Create Buffer Geometry (One time)
  const geometry = useMemo(() => {
    const geo = new THREE.InstancedBufferGeometry();
    const baseGeo = new THREE.PlaneGeometry(1, 1);
    
    geo.setAttribute('position', baseGeo.getAttribute('position'));
    geo.setAttribute('uv', baseGeo.getAttribute('uv'));
    geo.setIndex(baseGeo.getIndex());
    
    const aColor = new Float32Array(MAX_STROKES * 3);
    const aBounds = new Float32Array(MAX_STROKES * 4); 
    const aDepth = new Float32Array(MAX_STROKES * 1);
    const aStability = new Float32Array(MAX_STROKES * 1);

    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
    geo.setAttribute('aBounds', new THREE.InstancedBufferAttribute(aBounds, 4));
    geo.setAttribute('aDepth', new THREE.InstancedBufferAttribute(aDepth, 1));
    geo.setAttribute('aStability', new THREE.InstancedBufferAttribute(aStability, 1));
    
    return geo;
  }, []);

  // 2. Fetch & Populate Data
  useEffect(() => {
    if (!activePaintingId) return;

    const loadPainting = async (id) => {
      try {
        const response = await fetch(`${DATA_PATH}${id}.json`);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        const data = await response.json();
        
        // CRITICAL FIX: Check if strokes exist before reading .length
        if (!data || !data.strokes || !Array.isArray(data.strokes)) {
            console.warn(`[Canvas] Painting ${id} invalid or empty.`);
            return;
        }

        const count = Math.min(data.strokes.length, MAX_STROKES);
        const colAttr = geometry.attributes.aColor;
        const boundsAttr = geometry.attributes.aBounds;
        const depthAttr = geometry.attributes.aDepth;
        const stabAttr = geometry.attributes.aStability;

        const width = data.meta?.resolution?.[0] || 1024;
        const height = data.meta?.resolution?.[1] || 1024;

        for (let i = 0; i < count; i++) {
          const s = data.strokes[i];
          colAttr.setXYZ(i, s.color[0]/255, s.color[1]/255, s.color[2]/255);
          
          const nX = s.bbox[0] / width;
          const nY = 1.0 - (s.bbox[1] / height);
          const nW = s.bbox[2] / width;
          const nH = s.bbox[3] / height;
          
          boundsAttr.setXYZW(i, nX, nY, nW, nH);
          depthAttr.setX(i, s.z);
          stabAttr.setX(i, s.stability || 0.5);
        }

        colAttr.needsUpdate = true;
        boundsAttr.needsUpdate = true;
        depthAttr.needsUpdate = true;
        stabAttr.needsUpdate = true;
        
        geometry.instanceCount = count;
        setDataLoaded(true);
        
      } catch (e) {
        console.error("Failed to load painting:", e);
      }
    };

    loadPainting(activePaintingId);
  }, [activePaintingId, geometry]);

  // 3. Animation Loop
  useFrame((state) => {
    if (!shaderMaterialRef.current) return;
    
    shaderMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    
    // Chaos Ramp
    let chaos = 0;
    if (transitionProgress < 0.5) chaos = transitionProgress * 2.0;
    else chaos = (1.0 - transitionProgress) * 2.0;
    
    shaderMaterialRef.current.uniforms.uChaos.value = THREE.MathUtils.lerp(
      shaderMaterialRef.current.uniforms.uChaos.value,
      chaos,
      0.1
    );
  });

  // 4. Render
  // Safety: If AnamorphicShader is undefined (import fail), use basic meshbasic
  const Material = AnamorphicShader ? 'shaderMaterial' : 'meshBasicMaterial';
  const args = AnamorphicShader ? [AnamorphicShader] : [{ color: 'hotpink' }];

  return (
    <mesh ref={meshRef} geometry={geometry} frustumCulled={false}>
      {AnamorphicShader ? (
        <shaderMaterial
            ref={shaderMaterialRef}
            attach="material"
            args={[AnamorphicShader]}
            transparent={true}
            depthWrite={false}
            blending={THREE.NormalBlending}
        />
      ) : (
        <meshBasicMaterial color="red" wireframe />
      )}
    </mesh>
  );
};

export default InfiniteCanvas;
