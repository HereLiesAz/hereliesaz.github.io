/**
 * STROKE CLOUD COMPONENT
 * ======================
 * This component renders a single artwork as a cloud of floating strokes.
 * It uses 'InstancedMesh' for high performance (one draw call for thousands of particles).
 */

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import vertexShader from '../shaders/anamorphic.vert';
import fragmentShader from '../shaders/anamorphic.frag';

/**
 * @param {string} dataUrl - URL to the JSON file containing stroke data.
 * @param {number} sweetSpotZ - The Z-coordinate where this cloud forms a coherent image.
 * @param {string} textureUrl - URL to the brush stroke alpha mask.
 */
const StrokeCloud = ({ dataUrl, sweetSpotZ, textureUrl }) => {
  const meshRef = useRef();
  
  // --- 1. LOAD ASSETS ---

  // Load the JSON data (geometry info)
  const { data } = useLoader(THREE.FileLoader, dataUrl, (loader) => {
    loader.setResponseType('json');
  });

  // Load the Brush Texture (visuals)
  const brushTexture = useLoader(THREE.TextureLoader, textureUrl);

  // --- 2. GENERATE ATTRIBUTES (The "Geometry") ---

  // We process the raw JSON data into typed arrays for the GPU.
  // usage: useMemo ensures this only runs once per artwork load.
  const attributes = useMemo(() => {
    if (!data) return null;
    
    // Check if data is array or object (Grinder V2 compatibility)
    const strokes = Array.isArray(data) ? data : (data.strokes || []);
    const count = strokes.length;

    // Create TypedArrays
    const aOffset = new Float32Array(count * 3); // Position
    const aRandom = new Float32Array(count * 3); // Entropy
    const aColor = new Float32Array(count * 4);  // RGBA
    const aScale = new Float32Array(count);      // Size
    
    strokes.forEach((stroke, i) => {
      // Data Normalization Logic
      // Handles both Array-format (Legacy) and Dict-format (Grinder V2)
      
      let x, y, z, scale, r, g, b;

      if (Array.isArray(stroke)) {
        // Legacy: [x, y, z, scale, rot, r, g, b]
        x = stroke[0];
        y = stroke[1];
        z = stroke[2];
        scale = stroke[3];
        r = stroke[5];
        g = stroke[6];
        b = stroke[7];
      } else {
        // Grinder V2: { bbox: [x,y,w,h], z, color: [r,g,b], ... }
        // We need to map pixel coordinates to 3D world space.
        // Simplified mapping for documentation purposes:
        x = stroke.bbox[0]; // Needs centering logic in real app
        y = stroke.bbox[1];
        z = stroke.z;
        scale = stroke.bbox[2] / 100; // Arbitrary scale factor
        r = stroke.color[0];
        g = stroke.color[1];
        b = stroke.color[2];
      }

      // Position (aOffset)
      aOffset[i * 3 + 0] = x;
      aOffset[i * 3 + 1] = y;
      aOffset[i * 3 + 2] = z + sweetSpotZ; // Global Z position
      
      // Scale
      aScale[i] = scale;
      
      // Color (Normalize 0-255 to 0.0-1.0)
      aColor[i * 4 + 0] = r / 255;
      aColor[i * 4 + 1] = g / 255;
      aColor[i * 4 + 2] = b / 255;
      aColor[i * 4 + 3] = 1.0; // Alpha
      
      // Random (Entropy) for the Chaos Shader
      aRandom[i * 3 + 0] = Math.random(); // Axis X
      aRandom[i * 3 + 1] = Math.random(); // Axis Y
      aRandom[i * 3 + 2] = Math.random(); // Speed / Phase
    });
    
    return { aOffset, aRandom, aColor, aScale, count };
  }, [data, sweetSpotZ]);

  // --- 3. SHADER UNIFORMS ---

  // These are values sent to the shader that apply to the WHOLE cloud.
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
    
    // Update Uniforms
    // 1. Time: For procedural noise movement
    meshRef.current.material.uniforms.uTime.value = state.clock.elapsedTime;

    // 2. Scroll: The most important value.
    // It tells the shader where the "Camera" is in the virtual timeline.
    meshRef.current.material.uniforms.uScroll.value = state.camera.position.z;
  });

  if (!attributes) return null;

  return (
    <instancedMesh 
      ref={meshRef} 
      args={[null, null, attributes.count]}
      // Frustum Culling must be FALSE.
      // Why? Because when "exploded", particles might be on-screen even if the
      // central origin of the mesh is off-screen. We need to render it always.
      frustumCulled={false}
    >
      {/* The particle shape (a simple quad) */}
      <planeGeometry args={[1, 1]} />

      {/* The Anamorphic Shader */}
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false} // Disable depth write for painterly blending (no occlusion)
        side={THREE.DoubleSide}
      />
      
      {/* Bind the generated attributes to the mesh */}
      <instancedBufferAttribute attach="geometry-attributes-aOffset" args={[attributes.aOffset, 3]} />
      <instancedBufferAttribute attach="geometry-attributes-aRandom" args={[attributes.aRandom, 3]} />
      <instancedBufferAttribute attach="geometry-attributes-aColor" args={[attributes.aColor, 4]} />
      <instancedBufferAttribute attach="geometry-attributes-aScale" args={[attributes.aScale, 1]} />
    </instancedMesh>
  );
};

export default StrokeCloud;
