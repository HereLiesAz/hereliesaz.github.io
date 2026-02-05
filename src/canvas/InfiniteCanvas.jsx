import React, { useMemo, useEffect, useState, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import useStore from '../store/useStore';
import { AnamorphicShader } from '../shaders/AnamorphicShader';

// --- DATA LOADER ---
const useArtworkData = (id) => {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!id) return;
    
    let isMounted = true; // Prevent setting state on unmounted component
    console.log(`[Canvas] Fetching ${id}...`);
    
    fetch(`/data/${id}.json`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(json => {
        if (isMounted) {
            // Normalize legacy lists vs new objects
            const clean = Array.isArray(json) ? { strokes: json } : json;
            setData(clean);
        }
      })
      .catch(e => {
        console.warn(`[Canvas] Failed to load ${id}: ${e.message}`);
        if (isMounted) setData(null);
      });
      
    return () => { isMounted = false; };
  }, [id]);

  return data;
};

// --- SINGLE ARTWORK COMPONENT ---
const ArtworkInstance = ({ id, isActive, progress }) => {
  const meshRef = useRef();
  const data = useArtworkData(id);
  
  // UNIFORMS (Memoized to prevent recreation)
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uScroll: { value: 0 },
    uChaos: { value: 0 },
    uColor: { value: new THREE.Color(1, 1, 1) }
  }), []);

  // ANIMATION LOOP
  useFrame((state) => {
    if (!meshRef.current || !meshRef.current.material) return;
    
    // Update Time
    meshRef.current.material.uniforms.uTime.value = state.clock.elapsedTime;
    
    // Update Chaos (0.0 = Order, 1.0 = Chaos)
    const chaos = isActive ? progress : (1.0 - progress);
    meshRef.current.material.uniforms.uChaos.value = chaos;
  });

  // ATTRIBUTE CALCULATION
  const attributes = useMemo(() => {
    if (!data || !data.strokes) return null;

    const count = data.strokes.length;
    // Safety check for empty files
    if (count === 0) return null;

    const offsets = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randoms = new Float32Array(count);

    data.strokes.forEach((stroke, i) => {
      // Safe access using defaults
      const x = stroke.bbox ? stroke.bbox[0] : 0;
      const y = stroke.bbox ? stroke.bbox[1] : 0;
      const z = stroke.z || 0;
      
      offsets[i * 3] = x;
      offsets[i * 3 + 1] = y;
      offsets[i * 3 + 2] = z;

      if (stroke.color) {
          colors[i * 3] = stroke.color[0] / 255;
          colors[i * 3 + 1] = stroke.color[1] / 255;
          colors[i * 3 + 2] = stroke.color[2] / 255;
      } else {
          colors[i * 3] = 1; colors[i * 3+1] = 1; colors[i * 3+2] = 1;
      }

      sizes[i] = stroke.bbox ? stroke.bbox[2] : 1.0; 
      randoms[i] = Math.random();
    });

    return { offsets, colors, sizes, randoms, count };
  }, [data]);

  // RENDER SAFETY:
  // If we don't have attributes, render NOTHING. 
  // This prevents the "reading 'null'" crash in Three.js internals.
  if (!attributes) return null;

  return (
    <instancedMesh ref={meshRef} args={[null, null, attributes.count]}>
      {/* NOTE: We attach attributes directly to the geometry children.
         This is the safest way to ensure they are linked before render.
      */}
      <planeGeometry args={[1, 1]}>
        <instancedBufferAttribute attach="attributes-aOffset" args={[attributes.offsets, 3]} />
        <instancedBufferAttribute attach="attributes-aColor" args={[attributes.colors, 3]} />
        <instancedBufferAttribute attach="attributes-aSize" args={[attributes.sizes, 1]} />
        <instancedBufferAttribute attach="attributes-aRandom" args={[attributes.randoms, 1]} />
      </planeGeometry>
      
      <shaderMaterial
        vertexShader={AnamorphicShader.vertexShader}
        fragmentShader={AnamorphicShader.fragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
};

// --- MAIN CANVAS ---
const InfiniteCanvas = () => {
  const activeId = useStore(state => state.activeId);
  const nextId = useStore(state => state.nextId);
  const transitionProgress = useStore(state => state.transitionProgress);

  return (
    <group>
      {activeId && <ArtworkInstance id={activeId} isActive={true} progress={transitionProgress} />}
      {nextId && <ArtworkInstance id={nextId} isActive={false} progress={transitionProgress} />}
    </group>
  );
};

export default InfiniteCanvas;
