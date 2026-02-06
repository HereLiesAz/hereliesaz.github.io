import React, { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import useStore from '../store/useStore';
import { AnamorphicShader } from '../shaders/AnamorphicShader';

// --- FALLBACK SHADER (In case import fails) ---
const FALLBACK_SHADER = {
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    void main() {
      gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); // Bright Magenta Error Color
    }
  `
};

// --- DATA HOOK ---
const useArtworkData = (id) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!id) return;
    let mounted = true;
    console.log(`[BlackBox] Fetching: ${id}`);
    
    fetch(`/data/${id}.json`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (mounted && json) {
          setData(Array.isArray(json) ? { strokes: json } : json);
        }
      })
      .catch(e => console.warn(`[BlackBox] Load failed: ${e}`));
      
    return () => { mounted = false; };
  }, [id]);
  return data;
};

// --- THE BLACK BOX COMPONENT ---
// This component manages its own Three.js objects manually.
const BlackBoxArtwork = ({ id, isActive, progress }) => {
  const groupRef = useRef();
  const meshRef = useRef();
  const data = useArtworkData(id);

  // 1. SETUP: Create the Mesh manually when data arrives
  useEffect(() => {
    if (!data || !data.strokes || !groupRef.current) return;

    const count = data.strokes.length;
    console.log(`[BlackBox] Constructing ${id} with ${count} particles.`);

    // A. GEOMETRY
    const geo = new THREE.InstancedBufferGeometry();
    geo.copy(new THREE.PlaneGeometry(1, 1)); // Base Quad

    const offsets = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randoms = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const s = data.strokes[i];
      const x = s.bbox ? s.bbox[0] : 0;
      const y = s.bbox ? s.bbox[1] : 0;
      const z = s.z || 0;

      offsets[i * 3] = x; offsets[i * 3 + 1] = y; offsets[i * 3 + 2] = z;
      
      if (s.color) {
        colors[i * 3] = s.color[0]/255; colors[i * 3 + 1] = s.color[1]/255; colors[i * 3 + 2] = s.color[2]/255;
      } else {
        colors.set([1,1,1], i*3);
      }
      
      sizes[i] = s.bbox ? s.bbox[2] : 1.0;
      randoms[i] = Math.random();
    }

    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1));
    geo.setAttribute('aRandom', new THREE.InstancedBufferAttribute(randoms, 1));

    // B. MATERIAL
    // Use imported shader or fallback if missing
    const shader = AnamorphicShader || FALLBACK_SHADER;
    const mat = new THREE.ShaderMaterial({
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uScroll: { value: 0 },
        uChaos: { value: 0 }, // Will update in loop
        uColor: { value: new THREE.Color(1, 1, 1) }
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    // C. MESH
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;

    // Mount
    groupRef.current.add(mesh);
    meshRef.current = mesh;

    // Cleanup Function
    return () => {
      console.log(`[BlackBox] Disposing ${id}`);
      if (groupRef.current) groupRef.current.remove(mesh);
      geo.dispose();
      mat.dispose();
      meshRef.current = null;
    };
  }, [data]); // Re-run ONLY if data (id) changes

  // 2. LOOP: Update Uniforms
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.material.uniforms.uTime.value = state.clock.elapsedTime;
      // Logic: Active = 0->1, Next = 1->0
      const chaos = isActive ? progress : (1.0 - progress);
      meshRef.current.material.uniforms.uChaos.value = chaos;
    }
  });

  return <group ref={groupRef} />;
};

// --- MAIN CANVAS ---
const InfiniteCanvas = () => {
  const activeId = useStore(state => state.activeId);
  const nextId = useStore(state => state.nextId);
  const transitionProgress = useStore(state => state.transitionProgress);

  return (
    <group>
      {/* Key forces complete remount on change */}
      {activeId && (
        <BlackBoxArtwork 
          key={activeId} 
          id={activeId} 
          isActive={true} 
          progress={transitionProgress} 
        />
      )}
      
      {nextId && (
        <BlackBoxArtwork 
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
