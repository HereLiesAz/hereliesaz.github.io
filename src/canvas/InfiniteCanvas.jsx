import React, { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';

export default function InfiniteCanvas() {
  const activeId = useStore(state => state.activeId);
  const manifest = useStore(state => state.manifest);
  const pointsRef = useRef();
  
  // Local state for the point cloud data
  const [strokeData, setStrokeData] = useState(null);

  // 1. Fetch the JSON for the active artwork
  useEffect(() => {
    if (!activeId) return;

    const node = manifest.find(n => n.id === activeId);
    if (!node) return;

    // Construct path. Note: node.file already contains filename
    const url = `/data/${node.file}`;
    console.log("[Canvas] Loading art:", url);

    fetch(url)
      .then(res => res.json())
      .then(data => {
        // Handle both compressed ("s") and verbose ("strokes") keys
        const strokes = data.strokes || data.s || [];
        setStrokeData(strokes);
      })
      .catch(err => console.error("[Canvas] Load Error:", err));

  }, [activeId, manifest]);

  // 2. Convert Stroke Data to Geometry
  const geometry = useMemo(() => {
    if (!strokeData) return null;

    const count = strokeData.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    strokeData.forEach((stroke, i) => {
      // Normalize positions (assuming 512x512 resolution)
      const x = (stroke.bbox ? stroke.bbox[0] : stroke.b[0]) / 512 - 0.5;
      const y = -((stroke.bbox ? stroke.bbox[1] : stroke.b[1]) / 512 - 0.5); // Flip Y
      const z = (stroke.z !== undefined ? stroke.z : stroke.z) * 0.5; 

      positions[i * 3] = x * 5; // Scale up
      positions[i * 3 + 1] = y * 5;
      positions[i * 3 + 2] = z;

      // Colors
      const c = stroke.color || stroke.c || [255, 255, 255];
      colors[i * 3] = c[0] / 255;
      colors[i * 3 + 1] = c[1] / 255;
      colors[i * 3 + 2] = c[2] / 255;
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;

  }, [strokeData]);

  // 3. Animation Loop
  useFrame((state) => {
    if (pointsRef.current) {
      // Gentle floating animation
      pointsRef.current.rotation.y = state.clock.getElapsedTime() * 0.1;
    }
  });

  if (!geometry) return null;

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial 
        size={0.05} 
        vertexColors 
        sizeAttenuation 
        transparent 
        opacity={0.9} 
      />
    </points>
  );
}
