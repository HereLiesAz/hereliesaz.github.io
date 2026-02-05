/**
 * INFINITE CANVAS
 * ===============
 * The core rendering component for the artworks.
 * Instead of using simple InstancedMesh, this component manually manages an
 * InstancedBufferGeometry to allow for more complex attribute mapping (Bounds, Depth, Stability).
 */

import React, { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AnamorphicShader } from '../shaders/AnamorphicShader';

// Maximum number of strokes per painting to allocate memory for.
// Artworks with more strokes will be truncated.
const MAX_STROKES = 20000; 

// Base path for fetching processed JSON data.
const DATA_PATH = '/data/';

const InfiniteCanvas = ({ activePaintingId, transitionProgress }) => {
  const meshRef = useRef();
  const shaderMaterialRef = useRef();
  const [dataLoaded, setDataLoaded] = useState(false);
  
  // --- 1. INITIALIZE GEOMETRY (Memory Allocation) ---
  // We create a static geometry buffer once.
  // The attributes are reused for every painting by updating their values.
  const geometry = useMemo(() => {
    const geo = new THREE.InstancedBufferGeometry();
    const baseGeo = new THREE.PlaneGeometry(1, 1);
    
    // Copy base attributes (position, uv, index) from the quad
    geo.setAttribute('position', baseGeo.getAttribute('position'));
    geo.setAttribute('uv', baseGeo.getAttribute('uv'));
    geo.setIndex(baseGeo.getIndex());
    
    // Allocate TypedArrays for Instance Attributes
    const aColor = new Float32Array(MAX_STROKES * 3);    // RGB
    const aBounds = new Float32Array(MAX_STROKES * 4);   // X, Y, W, H (Normalized)
    const aDepth = new Float32Array(MAX_STROKES * 1);    // Z-Depth
    const aStability = new Float32Array(MAX_STROKES * 1);// Stability Score

    // Attach attributes to geometry
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
    geo.setAttribute('aBounds', new THREE.InstancedBufferAttribute(aBounds, 4));
    geo.setAttribute('aDepth', new THREE.InstancedBufferAttribute(aDepth, 1));
    geo.setAttribute('aStability', new THREE.InstancedBufferAttribute(aStability, 1));
    
    return geo;
  }, []);

  // --- 2. DATA LOADING & POPULATION ---
  useEffect(() => {
    if (!activePaintingId) return;

    const loadPainting = async (id) => {
      try {
        const response = await fetch(`${DATA_PATH}${id}.json`);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        const data = await response.json();
        
        // Validation: Ensure valid data structure
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

        // Populate Buffers
        for (let i = 0; i < count; i++) {
          const s = data.strokes[i];

          // Color: Normalize 0-255 -> 0.0-1.0
          colAttr.setXYZ(i, s.color[0]/255, s.color[1]/255, s.color[2]/255);
          
          // Bounds: Normalize pixel coords to 0.0-1.0 UV space
          // Note: Y is flipped (1.0 - y) because WebGL 0,0 is bottom-left
          const nX = s.bbox[0] / width;
          const nY = 1.0 - (s.bbox[1] / height);
          const nW = s.bbox[2] / width;
          const nH = s.bbox[3] / height;
          
          boundsAttr.setXYZW(i, nX, nY, nW, nH);

          // Depth & Stability
          depthAttr.setX(i, s.z);
          stabAttr.setX(i, s.stability || 0.5);
        }

        // Mark attributes as needing update for the GPU
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

  // --- 3. ANIMATION LOOP ---
  useFrame((state) => {
    if (!shaderMaterialRef.current) return;
    
    // Update Uniforms
    shaderMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    
    // Calculate Chaos Level based on Transition Progress
    // When progress is 0 or 1 (at a painting), chaos is 0.
    // When progress is 0.5 (between paintings), chaos peaks.
    let chaos = 0;
    if (transitionProgress < 0.5) chaos = transitionProgress * 2.0;
    else chaos = (1.0 - transitionProgress) * 2.0;
    
    // Smoothly lerp chaos value for fluid transitions
    shaderMaterialRef.current.uniforms.uChaos.value = THREE.MathUtils.lerp(
      shaderMaterialRef.current.uniforms.uChaos.value,
      chaos,
      0.1
    );
  });

  // --- 4. RENDER ---
  // Fallback if shader fails to load
  const Material = AnamorphicShader ? 'shaderMaterial' : 'meshBasicMaterial';

  return (
    <mesh ref={meshRef} geometry={geometry} frustumCulled={false}>
      {AnamorphicShader ? (
        <shaderMaterial
            ref={shaderMaterialRef}
            attach="material"
            args={[AnamorphicShader]}
            transparent={true}
            depthWrite={false} // Disable depth write for proper blending
            blending={THREE.NormalBlending}
        />
      ) : (
        <meshBasicMaterial color="red" wireframe />
      )}
    </mesh>
  );
};

export default InfiniteCanvas;
