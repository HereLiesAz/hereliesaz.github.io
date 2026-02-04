import React, { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AnamorphicShader } from '../shaders/AnamorphicShader';

// Configuration
const MAX_STROKES = 20000; // Buffer size
const DATA_PATH = '/data/';

const InfiniteCanvas = ({ activePaintingId, transitionProgress, nextPaintingId }) => {
  const meshRef = useRef();
  const shaderMaterialRef = useRef();
  
  // Attribute Buffers
  const [dataLoaded, setDataLoaded] = useState(false);
  
  // We use "InstancedMesh" but we need custom attributes for each instance.
  // Standard InstancedMesh only gives Matrix/Color. We need Bounds, Depth, etc.
  // So we use a regular mesh with InstancedBufferGeometry.
  
  const geometry = useMemo(() => {
    const geo = new THREE.InstancedBufferGeometry();
    
    // Base geometry is a simple Quad (2 triangles)
    const baseGeo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('position', baseGeo.getAttribute('position'));
    geo.setAttribute('uv', baseGeo.getAttribute('uv'));
    geo.setIndex(baseGeo.getIndex());
    
    // Pre-allocate buffers for our custom data
    // These will be populated when JSON loads
    const aColor = new Float32Array(MAX_STROKES * 3);
    const aBounds = new Float32Array(MAX_STROKES * 4); // x, y, w, h
    const aDepth = new Float32Array(MAX_STROKES * 1);
    const aStability = new Float32Array(MAX_STROKES * 1);

    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
    geo.setAttribute('aBounds', new THREE.InstancedBufferAttribute(aBounds, 4));
    geo.setAttribute('aDepth', new THREE.InstancedBufferAttribute(aDepth, 1));
    geo.setAttribute('aStability', new THREE.InstancedBufferAttribute(aStability, 1));
    
    return geo;
  }, []);

  // --- DATA LOADER ---
  useEffect(() => {
    if (!activePaintingId) return;

    const loadPainting = async (id) => {
      try {
        const response = await fetch(`${DATA_PATH}${id}.json`);
        const data = await response.json();
        
        // Update Geometry Attributes
        const count = Math.min(data.strokes.length, MAX_STROKES);
        
        const colAttr = geometry.attributes.aColor;
        const boundsAttr = geometry.attributes.aBounds;
        const depthAttr = geometry.attributes.aDepth;
        const stabAttr = geometry.attributes.aStability;

        const { width, height } = { width: data.meta.resolution[0], height: data.meta.resolution[1] };

        for (let i = 0; i < count; i++) {
          const s = data.strokes[i];
          
          // Normalize Color (0-255 -> 0-1)
          colAttr.setXYZ(i, s.color[0]/255, s.color[1]/255, s.color[2]/255);
          
          // Normalize Bounds (Pixels -> 0-1 UV space)
          // Y is flipped in 3D usually, so we invert Y
          const nX = s.bbox[0] / width;
          const nY = 1.0 - (s.bbox[1] / height); // Flip Y
          const nW = s.bbox[2] / width;
          const nH = s.bbox[3] / height;
          
          boundsAttr.setXYZW(i, nX, nY, nW, nH);
          
          // Depth is already 0-1 from Grinder
          depthAttr.setX(i, s.z);
          
          // Stability
          stabAttr.setX(i, s.stability || 0.5);
        }

        // Mark update needed
        colAttr.needsUpdate = true;
        boundsAttr.needsUpdate = true;
        depthAttr.needsUpdate = true;
        stabAttr.needsUpdate = true;
        
        // Set draw range
        geometry.instanceCount = count;
        setDataLoaded(true);
        
      } catch (e) {
        console.error("Failed to load painting:", e);
      }
    };

    loadPainting(activePaintingId);
  }, [activePaintingId, geometry]);

  // --- ANIMATION LOOP ---
  useFrame((state) => {
    if (!shaderMaterialRef.current) return;
    
    // Pass uniforms
    shaderMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    
    // Transition Logic (Placeholder for Task 7)
    // If we are transitioning, ramp up Chaos
    // transitionProgress 0 -> 1
    // We want chaos to peak at 0.5
    let chaos = 0;
    if (transitionProgress < 0.5) {
      chaos = transitionProgress * 2.0; // 0 -> 1
    } else {
      chaos = (1.0 - transitionProgress) * 2.0; // 1 -> 0
    }
    
    // Smooth dampening
    shaderMaterialRef.current.uniforms.uChaos.value = THREE.MathUtils.lerp(
      shaderMaterialRef.current.uniforms.uChaos.value,
      chaos,
      0.1
    );
  });

  return (
    <mesh ref={meshRef} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={shaderMaterialRef}
        attach="material"
        args={[AnamorphicShader]}
        transparent={true}
        depthWrite={false} // Important for transparency sorting (partial fix)
        blending={THREE.NormalBlending}
      />
    </mesh>
  );
};

export default InfiniteCanvas;
