import React, { useMemo, useEffect, useState, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import useStore from '../store/useStore';
import { AnamorphicShader } from '../shaders/AnamorphicShader';

// --- 1. DATA FETCHING (Unchanged) ---
const useArtworkData = (id) => {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    
    // Fetch with ID correction logic implicitly handled by the server/file check
    fetch(`/data/${id}.json`)
      .then(res => {
        if (!res.ok) return null;
        return res.json();
      })
      .then(json => {
        if (!mounted || !json) return;
        // Normalization
        const clean = Array.isArray(json) ? { strokes: json } : json;
        setData(clean);
      })
      .catch(() => { if (mounted) setData(null); });
      
    return () => { mounted = false; };
  }, [id]);

  return data;
};

// --- 2. THE GEOMETRY (Static Quad) ---
// We define the quad once to avoid recreating it.
const baseGeometry = new THREE.PlaneGeometry(1, 1);

// --- 3. THE ARTWORK COMPONENT ---
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

  // ANIMATION
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.material.uniforms.uTime.value = state.clock.elapsedTime;
      const chaos = isActive ? progress : (1.0 - progress);
      meshRef.current.material.uniforms.uChaos.value = chaos;
    }
  });

  // ATTRIBUTE FACTORY
  const buffers = useMemo(() => {
    if (!data || !data.strokes || data.strokes.length === 0) return null;

    const count = data.strokes.length;
    const offsets = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randoms = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const s = data.strokes[i];
      
      // Safety defaults
      const x = s.bbox ? s.bbox[0] : 0;
      const y = s.bbox ? s.bbox[1] : 0;
      const z = s.z || 0;
      
      offsets[i * 3] = x;
      offsets[i * 3 + 1] = y;
      offsets[i * 3 + 2] = z;

      if (s.color) {
        colors[i * 3] = s.color[0] / 255;
        colors[i * 3 + 1] = s.color[1] / 255;
        colors[i * 3 + 2] = s.color[2] / 255;
      } else {
        colors.set([1, 1, 1], i * 3);
      }

      sizes[i] = s.bbox ? s.bbox[2] : 1.0;
      randoms[i] = Math.random();
    }

    return { offsets, colors, sizes, randoms, count };
  }, [data]);

  // RENDER GUARD
  if (!buffers) return null;

  return (
    <instancedMesh ref={meshRef} args={[null, null, buffers.count]}>
      {/* EXPLICIT GEOMETRY CONSTRUCTION 
         We copy the base plane geometry and inject attributes.
         This is more verbose but crash-proof.
      */}
      <instancedBufferGeometry index={baseGeometry.index} attributes={baseGeometry.attributes}>
        <instancedBufferAttribute attach="attributes-aOffset" args={[buffers.offsets, 3]} />
        <instancedBufferAttribute attach="attributes-aColor" args={[buffers.colors, 3]} />
        <instancedBufferAttribute attach="attributes-aSize" args={[buffers.sizes, 1]} />
        <instancedBufferAttribute attach="attributes-aRandom" args={[buffers.randoms, 1]} />
      </instancedBufferGeometry>

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

// --- 4. MAIN CANVAS ---
const InfiniteCanvas = () => {
  const activeId = useStore(state => state.activeId);
  const nextId = useStore(state => state.nextId);
  const transitionProgress = useStore(state => state.transitionProgress);

  return (
    <group>
      {/* CRITICAL FIX: key={id} 
          This forces React to completely destroy the old artwork and build a new one 
          when the ID changes. This prevents the "reading null" crash caused by 
          recycling meshes with missing data.
      */}
      {activeId && (
        <ArtworkInstance 
          key={activeId} 
          id={activeId} 
          isActive={true} 
          progress={transitionProgress} 
        />
      )}
      
      {nextId && (
        <ArtworkInstance 
          key={nextId} 
          id={nextId} 
          isActive={false} 
          progress={transitionProgress} 
        />
      )}
    </group>
  );
};

export default InfiniteCanvas;
