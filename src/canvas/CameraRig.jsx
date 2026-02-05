/**
 * CAMERA RIG
 * ==========
 * Controls the camera movement and translates user scroll input into 3D navigation.
 */

import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useScroll } from '@react-three/drei'; // Standard R3F ScrollControls
import useStore from '../store/useStore';

const CameraRig = ({ spacing }) => {
  const { camera } = useThree();
  const setTransitionProgress = useStore(state => state.setTransitionProgress);
  const transitionProgress = useStore(state => state.transitionProgress);
  
  // Ref to track smooth scroll position
  const scrollRef = useRef(0);

  // --- MOUSE PARALLAX ---
  // We want the camera to slightly look towards the mouse cursor.
  // This adds a feeling of "depth" and responsiveness.
  const mouse = useRef(new THREE.Vector2());

  useEffect(() => {
    const onMouseMove = (e) => {
        // Normalize mouse to -1 to +1
        mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  // --- ANIMATION LOOP ---
  useFrame((state, delta) => {
    // 1. UPDATE SCROLL
    // In a real implementation, we would hook into 'useScroll()' or 'lenis' here.
    // For this demo, let's simulate a scroll or assume 'transitionProgress' is driven elsewhere.

    // Let's say we interpolate the camera Z based on the store's progress.
    // If activeIndex is 0 and progress is 0.5, we are at Z = 0 + (200 * 0.5) = 100.
    
    // We need to know WHICH index we are at.
    // The store has 'activeId'. We need to find its index in the manifest.
    const manifest = useStore.getState().manifest;
    const activeId = useStore.getState().activeId;
    const activeIndex = manifest.findIndex(n => n.id === activeId);
    
    if (activeIndex === -1) return;

    // Target Z Position
    const currentZ = activeIndex * spacing;
    const nextZ = (activeIndex + 1) * spacing; // Simplified: assumes next is always index+1
    
    // Interpolate Z based on transitionProgress (0.0 -> 1.0)
    const targetZ = THREE.MathUtils.lerp(currentZ, nextZ, transitionProgress);
    
    // Smooth dampening
    // scrollRef.current = THREE.MathUtils.damp(scrollRef.current, targetZ, 4, delta);
    // Direct assignment for responsiveness in this example:
    camera.position.z = targetZ;
    
    // 2. MOUSE LOOK
    // Create a target point for the camera to look at.
    // It looks at (0,0, targetZ - 10) but offset by mouse.
    const lookAtTarget = new THREE.Vector3(
        mouse.current.x * 5, // Parallax X strength
        mouse.current.y * 5, // Parallax Y strength
        targetZ - 20         // Look slightly ahead
    );
    
    // Smoothly interpolate the camera's lookAt
    // Note: We manipulate quaternion or just use lookAt with damping
    const currentLook = new THREE.Vector3(0, 0, targetZ - 20); // Placeholder
    currentLook.lerp(lookAtTarget, 0.1);
    camera.lookAt(currentLook);
    
    // 3. SHAKE / NOISE (Optional)
    // Adding subtle perlin noise to the camera position makes it feel organic.
  });

  return null; // This component has no visual representation
};

export default CameraRig;
