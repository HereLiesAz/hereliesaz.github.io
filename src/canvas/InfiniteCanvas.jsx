import React, { useMemo, useEffect, useState, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import useStore from '../store/useStore';
import { AnamorphicShader } from '../shaders/AnamorphicShader';

const useArtworkData = (id) => {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!id) return;
    
    // Guard against corrupted IDs (e.g., missing parens)
    console.log(`[Canvas] Fetching: /data/${id}.json`);
    
    fetch(`/data/${id}.json`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(json => {
        // Handle legacy array format vs new object format
        const cleanData = Array.isArray(json) ? { strokes: json } : json;
        setData(cleanData);
      })
      .catch(e => {
        console.warn(`[Canvas] Failed to load ${id}. This artwork may not exist or the ID is corrupt.`);
        setData(null); // Ensure we don't hold onto stale data
      });
  }, [id]);

  return data;
};

const ArtworkInstance = ({ id, isActive, progress }) => {
  const meshRef = useRef();
  const data = useArtworkData(id);
  
  // UNIFORMS
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uScroll: { value: 0 },
    uChaos: { value: 0 },
    uColor: { value: new THREE.Color(1, 1, 1) }
  }), []);

  // ANIMATION LOOP
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.material.uniforms.uTime.value = state.clock.elapsedTime;
      // Calculate chaos: Active = 0->1, Next = 1->0
      const chaos = isActive ? progress : (1.0 - progress);
      meshRef.current.material.uniforms.uChaos.value = chaos;
    }
  });

  // DATA PROCESSING
  const attributes = useMemo(() => {
    if (!data || !data.strokes) return null;

    const count = data.strokes.length;
    const offsets = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randoms = new Float32Array(count);

    data.strokes.forEach((stroke, i) => {
      offsets[i * 3] = stroke.bbox ? stroke.bbox[0] : 0;
      offsets[i * 3 + 1] = stroke.bbox ? stroke.bbox[1] : 0;
      offsets[i * 3 + 2] = stroke.z || 0;

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

  // RENDER GUARD: If no attributes, render nothing.
  if (!attributes) return null;

  return (
    <instancedMesh ref={meshRef} args={[null, null, attributes.count]}>
      {/* CRITICAL FIX: Attributes are children of geometry.
         This prevents "Cannot read properties of undefined" errors.
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
