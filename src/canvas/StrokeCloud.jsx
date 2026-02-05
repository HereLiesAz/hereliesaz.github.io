import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { useScroll } from '@react-three/drei'; // Or your custom store
import vertexShader from '../shaders/anamorphic.vert';
import fragmentShader from '../shaders/anamorphic.frag';

const StrokeCloud = ({ dataUrl, sweetSpotZ, textureUrl }) => {
  const meshRef = useRef();
  
  // 1. Load Data (The JSON from Grinder) & Texture
  const { data } = useLoader(THREE.FileLoader, dataUrl, (loader) => {
    loader.setResponseType('json');
  });
  const brushTexture = useLoader(THREE.TextureLoader, textureUrl);

  // 2. Generate Attributes
  // We don't need to update these every frame. They are static.
  const attributes = useMemo(() => {
    if (!data) return null;
    
    const count = data.length;
    const aOffset = new Float32Array(count * 3);
    const aRandom = new Float32Array(count * 3);
    const aColor = new Float32Array(count * 4);
    const aScale = new Float32Array(count);
    
    data.forEach((stroke, i) => {
      // Data format from grinder: [x, y, z, scale, rot, r, g, b]
      
      // Position (aOffset)
      aOffset[i * 3 + 0] = stroke[0];
      aOffset[i * 3 + 1] = stroke[1];
      aOffset[i * 3 + 2] = stroke[2] + sweetSpotZ; // Offset by painting location
      
      // Scale
      aScale[i] = stroke[3];
      
      // Color (Normalize 0-255 to 0.0-1.0)
      aColor[i * 4 + 0] = stroke[5] / 255;
      aColor[i * 4 + 1] = stroke[6] / 255;
      aColor[i * 4 + 2] = stroke[7] / 255;
      aColor[i * 4 + 3] = 1.0; // Alpha
      
      // Random (Entropy)
      aRandom[i * 3 + 0] = Math.random(); // Axis X
      aRandom[i * 3 + 1] = Math.random(); // Axis Y
      aRandom[i * 3 + 2] = Math.random(); // Speed
    });
    
    return { aOffset, aRandom, aColor, aScale, count };
  }, [data, sweetSpotZ]);

  // 3. Shader Uniforms
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uScroll: { value: 0 },
    uSweetSpot: { value: sweetSpotZ },
    uChaosLevel: { value: 1.0 }, // Can be tweened for intro effects
    uTexture: { value: brushTexture }
  }), [brushTexture, sweetSpotZ]);

  // 4. The Loop
  // Update the scroll position every frame
  useFrame((state) => {
    if (!meshRef.current) return;
    
    // Get scroll from your store/state
    // Assuming a global Z scroll value is available
    const currentScroll = state.camera.position.z;

    meshRef.current.material.uniforms.uTime.value = state.clock.elapsedTime;
    meshRef.current.material.uniforms.uScroll.value = currentScroll;
  });

  if (!attributes) return null;

  return (
    <instancedMesh 
      ref={meshRef} 
      args={[null, null, attributes.count]}
      frustumCulled={false} // Important: Strokes might be off-screen but "exploded" in view
    >
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false} // Disable depth write for painterly blending
        side={THREE.DoubleSide}
      />
      
      {/* Bind Attributes */}
      <instancedBufferAttribute attach="geometry-attributes-aOffset" args={[attributes.aOffset, 3]} />
      <instancedBufferAttribute attach="geometry-attributes-aRandom" args={[attributes.aRandom, 3]} />
      <instancedBufferAttribute attach="geometry-attributes-aColor" args={[attributes.aColor, 4]} />
      <instancedBufferAttribute attach="geometry-attributes-aScale" args={[attributes.aScale, 1]} />
    </instancedMesh>
  );
};

export default StrokeCloud;
