import React, { useMemo, useEffect, useState, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import useStore from '../store/useStore';
import { AnamorphicShader } from '../shaders/AnamorphicShader';

// Helper to fetch JSON data
const useArtworkData = (id) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
    
    console.log(`[Canvas] Loading ${id}...`);
    setData(null); // Reset while loading
    
    fetch(`/data/${id}.json`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(json => {
        // Handle both legacy (list) and new (object) formats
        if (Array.isArray(json)) {
            setData({ strokes: json });
        } else {
            setData(json);
        }
      })
      .catch(e => {
        console.error(`[Canvas] Failed to load ${id}:`, e);
        setError(e);
      });
  }, [id]);

  return { data, error };
};

const ArtworkInstance = ({ id, isActive, progress }) => {
  const meshRef = useRef();
  const { data } = useArtworkData(id);
  
  // UNIFORMS
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uScroll: { value: 0 },
    uChaos: { value: 0 }, // 0 = Ordered, 1 = Exploded
    uColor: { value: new THREE.Color(1, 1, 1) }
  }), []);

  // UPDATE LOOP
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.material.uniforms.uTime.value = state.clock.elapsedTime;
      
      // Calculate chaos based on progress
      // If we are active (0.0), chaos is 0. 
      // As we move to 1.0, chaos increases.
      // If we are 'next' (incoming), we start high chaos and settle to 0.
      
      let chaos = 0;
      if (isActive) {
          chaos = progress; // 0 -> 1
      } else {
          chaos = 1.0 - progress; // 1 -> 0
      }
      
      meshRef.current.material.uniforms.uChaos.value = chaos;
    }
  });

  // GEOMETRY GENERATION
  const attributes = useMemo(() => {
    // CRITICAL FIX: Guard against null data to prevent crash
    if (!data || !data.strokes) return null;

    const count = data.strokes.length;
    const offsets = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randoms = new Float32Array(count); // For unique noise per particle

    data.strokes.forEach((stroke, i) => {
      // Position (X, Y, Z)
      offsets[i * 3] = stroke.bbox ? stroke.bbox[0] : 0; // Simplified mapping
      offsets[i * 3 + 1] = stroke.bbox ? stroke.bbox[1] : 0;
      offsets[i * 3 + 2] = stroke.z || 0;

      // Color (R, G, B) - Normalized 0-1
      if (stroke.color) {
          colors[i * 3] = stroke.color[0] / 255;
          colors[i * 3 + 1] = stroke.color[1] / 255;
          colors[i * 3 + 2] = stroke.color[2] / 255;
      }

      // Size
      sizes[i] = stroke.bbox ? stroke.bbox[2] : 1.0; 
      
      // Stability/Randomness
      randoms[i] = Math.random();
    });

    return { offsets, colors, sizes, randoms, count };
  }, [data]);

  // CRITICAL FIX: Do not render Mesh until attributes are ready
  if (!attributes) return null;

  return (
    <instancedMesh ref={meshRef} args={[null, null, attributes.count]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        vertexShader={AnamorphicShader.vertexShader}
        fragmentShader={AnamorphicShader.fragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
      
      {/* ATTRIBUTE BUFFERS */}
      <instancedBufferAttribute 
        attach="geometry-attributes-aOffset" 
        args={[attributes.offsets, 3]} 
      />
      <instancedBufferAttribute 
        attach="geometry-attributes-aColor" 
        args={[attributes.colors, 3]} 
      />
      <instancedBufferAttribute 
        attach="geometry-attributes-aSize" 
        args={[attributes.sizes, 1]} 
      />
      <instancedBufferAttribute 
        attach="geometry-attributes-aRandom" 
        args={[attributes.randoms, 1]} 
      />
    </instancedMesh>
  );
};

const InfiniteCanvas = () => {
  const activeId = useStore(state => state.activeId);
  const nextId = useStore(state => state.nextId);
  const transitionProgress = useStore(state => state.transitionProgress);

  return (
    <group>
      {/* Render the Active (Departing) Artwork */}
      {activeId && (
        <ArtworkInstance 
            id={activeId} 
            isActive={true} 
            progress={transitionProgress} 
        />
      )}

      {/* Render the Next (Arriving) Artwork */}
      {nextId && (
        <ArtworkInstance 
            id={nextId} 
            isActive={false} 
            progress={transitionProgress} 
        />
      )}
    </group>
  );
};

export default InfiniteCanvas;
