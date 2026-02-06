import React, { useMemo, useEffect, useState, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import useStore from '../store/useStore';
import { AnamorphicShader } from '../shaders/AnamorphicShader';

// Static base to avoid garbage collection
const BASE_GEOMETRY = new THREE.PlaneGeometry(1, 1);

const useArtworkData = (id) => {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    
    // Explicitly fetch the JSON
    fetch(`/data/${id}.json`)
      .then(res => {
        if (!res.ok) return null;
        return res.json();
      })
      .then(json => {
        if (!mounted || !json) return;
        // Handle legacy arrays vs new objects
        const clean = Array.isArray(json) ? { strokes: json } : json;
        setData(clean);
      })
      .catch(() => { if (mounted) setData(null); });
      
    return () => { mounted = false; };
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

  // ANIMATION
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.material.uniforms.uTime.value = state.clock.elapsedTime;
      const chaos = isActive ? progress : (1.0 - progress);
      meshRef.current.material.uniforms.uChaos.value = chaos;
    }
  });

  // ATOMIC GEOMETRY CONSTRUCTION
  // We build the entire geometry block in memory. 
  // This bypasses React's child reconciliation which is causing the 'reading null' crash.
  const geometry = useMemo(() => {
    if (!data || !data.strokes || data.strokes.length === 0) return null;

    const count = data.strokes.length;
    
    // 1. Create a fresh InstancedBufferGeometry
    const geo = new THREE.InstancedBufferGeometry();
    
    // 2. Copy the base Plane attributes (position, uv, normal, index)
    geo.copy(BASE_GEOMETRY);
    
    // 3. Create Data Buffers
    const offsets = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randoms = new Float32Array(count);

    // 4. Fill Buffers
    for (let i = 0; i < count; i++) {
      const s = data.strokes[i] || {}; // Handle potential null strokes safely
      
      // Position
      const x = s.bbox ? s.bbox[0] : 0;
      const y = s.bbox ? s.bbox[1] : 0;
      const z = s.z || 0;
      
      offsets[i * 3] = x;
      offsets[i * 3 + 1] = y;
      offsets[i * 3 + 2] = z;

      // Color
      if (s.color) {
        colors[i * 3] = s.color[0] / 255;
        colors[i * 3 + 1] = s.color[1] / 255;
        colors[i * 3 + 2] = s.color[2] / 255;
      } else {
        colors[i * 3] = 1; colors[i * 3+1] = 1; colors[i * 3+2] = 1;
      }

      // Size & Random
      sizes[i] = s.bbox ? s.bbox[2] : 1.0;
      randoms[i] = Math.random();
    }

    // 5. Attach Attributes
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1));
    geo.setAttribute('aRandom', new THREE.InstancedBufferAttribute(randoms, 1));

    return geo;
  }, [data]);

  // If geometry failed to build, render nothing.
  if (!geometry) return null;

  return (
    <instancedMesh 
      ref={meshRef} 
      args={[null, null, geometry.instanceCount]} 
      geometry={geometry} // <--- Pass the complete object
      frustumCulled={false} // Prevent flickering at edges
    >
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
      {/* Key-based unmounting ensures we never update a dead mesh */}
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
