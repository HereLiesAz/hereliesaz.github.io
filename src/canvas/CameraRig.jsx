import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useScroll } from '@react-three/drei';
import * as THREE from 'three';
import { easing } from 'maath';
import { useStore } from '../store';

const CameraRig = ({ totalDepth = 5000 }) => {
  const scroll = useScroll(); // From <ScrollControls>
  const { setScrollZ } = useStore();
  const cameraRef = useRef();
  
  // Vectors to avoid garbage collection
  const vec = new THREE.Vector3();
  const lookAtTarget = new THREE.Vector3(0, 0, -10000); // Look into the void

  useFrame((state, delta) => {
    // 1. Map Scroll to Z-Depth
    // offset is 0.0 (top) to 1.0 (bottom)
    const currentZ = -scroll.offset * totalDepth;
    
    // Update global store for the Shaders/UI to react
    setScrollZ(currentZ);

    // 2. Parallax (The "Volumetric Proof")
    // Move camera X/Y based on mouse position
    // dampened by 0.1 for a "heavy" feel
    easing.damp3(
      state.camera.position,
      [
        state.pointer.x * 2.0,      // Move X with mouse
        state.pointer.y * 2.0,      // Move Y with mouse
        currentZ + 10               // The Scroll Z (offset +10 so we don't clip)
      ],
      0.1,
      delta
    );

    // 3. Camera Roll (Subtle vertigo effect)
    // Tilt the head slightly when moving mouse left/right
    easing.dampE(
      state.camera.rotation,
      [
        state.pointer.y * 0.05,     // Pitch
        state.pointer.x * 0.05,     // Yaw
        0                           // Roll (Keep 0 for now to maintain horizon)
      ],
      0.2,
      delta
    );
    
    // Ensure we always face the void
    // We manually set rotation above, but lookAt ensures directionality
    // state.camera.lookAt(0, 0, currentZ - 100); 
  });

  return null; // The camera is controlled via state, no mesh needed
};

export default CameraRig;
