/**
 * STROKE CLOUD (Legacy Component)
 * ===============================
 * An alternative implementation of the stroke renderer using `instancedMesh` helper.
 * This file is currently unused in the main `App.jsx` pipeline but is kept for reference
 * or future use in `InfiniteVoid.jsx`.
 *
 * Difference from InfiniteCanvas:
 * - Uses `instancedMesh` (Higher abstraction) vs `InstancedBufferGeometry` (Lower level).
 * - Expects different data format.
 */

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
// Note: useScroll comes from 'drei' if used inside ScrollControls,
// but here we are designing for a custom store-based scroll.
import { useScroll } from '@react-three/drei';
import vertexShader from '../shaders/anamorphic.vert';
import fragmentShader from '../shaders/anamorphic.frag';

const StrokeCloud = ({ dataUrl, sweetSpotZ, textureUrl }) => {
  const meshRef = useRef();
  
  // --- 1. LOAD DATA ---
  // Load the JSON data and the Brush Texture.
  const { data } = useLoader(THREE.FileLoader, dataUrl, (loader) => {
    loader.setResponseType('json');
  });
  const brushTexture = useLoader(THREE.TextureLoader, textureUrl);

  // --- 2. GENERATE ATTRIBUTES ---
  // Memoize to avoid expensive recalculations on re-renders.
  const attributes = useMemo(() => {
    if (!data) return null;
    
    const count = data.length;
    // Allocate TypedArrays
    const aOffset = new Float32Array(count * 3); // Position
    const aRandom = new Float32Array(count * 3); // Entropy
    const aColor = new Float32Array(count * 4);  // RGBA
    const aScale = new Float32Array(count);      // Size
    
    data.forEach((stroke, i) => {
      // Data format assumption from legacy grinder: [x, y, z, scale, rot, r, g, b]
      
      // Position (aOffset)
      aOffset[i * 3 + 0] = stroke[0];
      aOffset[i * 3 + 1] = stroke[1];
      // Offset Z by the painting's location in the world (sweetSpotZ)
      aOffset[i * 3 + 2] = stroke[2] + sweetSpotZ;
      
      // Scale
      aScale[i] = stroke[3];
      
      // Color (Normalize 0-255 to 0.0-1.0)
      aColor[i * 4 + 0] = stroke[5] / 255;
      aColor[i * 4 + 1] = stroke[6] / 255;
      aColor[i * 4 + 2] = stroke[7] / 255;
      aColor[i * 4 + 3] = 1.0; // Alpha
      
      // Random (Entropy) used for noise in shader
      aRandom[i * 3 + 0] = Math.random(); // Axis X
      aRandom[i * 3 + 1] = Math.random(); // Axis Y
      aRandom[i * 3 + 2] = Math.random(); // Speed/Frequency
    });
    
    return { aOffset, aRandom, aColor, aScale, count };
  }, [data, sweetSpotZ]);

  // --- 3. SHADER UNIFORMS ---
  // Define inputs for the GLSL shader.
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uScroll: { value: 0 },
    uSweetSpot: { value: sweetSpotZ },
    uChaosLevel: { value: 1.0 }, // Can be tweened for intro effects
    uTexture: { value: brushTexture }
  }), [brushTexture, sweetSpotZ]);

  // --- 4. ANIMATION LOOP ---
  useFrame((state) => {
    if (!meshRef.current) return;
    
    // In a real implementation, we would get scroll from a store.
    // For this standalone component, we assume camera Z is the scroll driver.
    const currentScroll = state.camera.position.z;

    // Update Uniforms
    meshRef.current.material.uniforms.uTime.value = state.clock.elapsedTime;
    meshRef.current.material.uniforms.uScroll.value = currentScroll;
  });

  if (!attributes) return null;

  return (
    <instancedMesh 
      ref={meshRef} 
      args={[null, null, attributes.count]} // [Geometry, Material, Count]
      frustumCulled={false} // Important: Strokes might be off-screen but "exploded" in view
    >
      {/* Base Geometry: A simple quad */}
      <planeGeometry args={[1, 1]} />

      {/* Shader Material */}
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false} // Disable depth write for painterly blending
        side={THREE.DoubleSide}
      />
      
      {/* Bind Attributes to the Instance */}
      {/* These will be available in the vertex shader as 'attribute vec3 aOffset', etc. */}
      <instancedBufferAttribute attach="geometry-attributes-aOffset" args={[attributes.aOffset, 3]} />
      <instancedBufferAttribute attach="geometry-attributes-aRandom" args={[attributes.aRandom, 3]} />
      <instancedBufferAttribute attach="geometry-attributes-aColor" args={[attributes.aColor, 4]} />
      <instancedBufferAttribute attach="geometry-attributes-aScale" args={[attributes.aScale, 1]} />
    </instancedMesh>
  );
};

export default StrokeCloud;
