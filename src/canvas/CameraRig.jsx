/**
 * CAMERA RIG
 * ==========
 * The physics-based camera controller.
 *
 * Responsibilities:
 * 1. Listen for user input (Wheel for scroll/flight).
 * 2. Manage "Scroll Velocity" for smooth momentum.
 * 3. Update the global 'transitionProgress' in the store.
 * 4. Move the Three.js camera based on the progress.
 * 5. Apply subtle handheld motion/noise.
 */

import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import useStore from '../store/useStore';

const CameraRig = () => {
  const { camera } = useThree();
  const transitionProgress = useStore(state => state.transitionProgress);
  const setTransitionProgress = useStore(state => state.setTransitionProgress);
  
  // Physics State
  const scrollVelocity = useRef(0);
  const targetProgress = useRef(transitionProgress); // Local tracker for smooth dampening

  // Tuning Constants
  const FLIGHT_SPEED = 0.0005; // How fast we fly per wheel tick
  const DAMPING = 0.05;        // Friction/Lerp factor (Lower = Smoother/Slower)

  // Sync Ref if external state changes (e.g. after a hard jump to a new artwork)
  useEffect(() => {
    targetProgress.current = transitionProgress;
  }, [transitionProgress]);

  // --- INPUT HANDLING ---
  useEffect(() => {
    const handleWheel = (e) => {
      // DeltaY is positive when scrolling down (Forward), negative up (Backward)
      // We accumulate velocity rather than position for momentum.
      scrollVelocity.current += e.deltaY * FLIGHT_SPEED;
    };

    // Passive listener for performance
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  // --- ANIMATION LOOP ---
  useFrame((state, delta) => {
    // 1. APPLY FRICTION
    // Decay velocity over time (0.95 per frame is a simple friction model)
    scrollVelocity.current *= 0.95;
    
    // 2. APPLY VELOCITY
    // Only update if moving significantly to save calc
    if (Math.abs(scrollVelocity.current) > 0.00001) {
       targetProgress.current += scrollVelocity.current;
    }
    
    // NOTE: We do NOT clamp targetProgress here.
    // We let it go > 1.0 or < 0.0 so the Store can detect the boundary crossing
    // and trigger the "Next Artwork" or "Previous Artwork" logic.

    // 3. SMOOTH INTERPOLATION
    // We strictly interpolate the VISUAL progress.
    const smoothed = THREE.MathUtils.lerp(transitionProgress, targetProgress.current, DAMPING);
    
    // Update Store only if changed
    if (Math.abs(smoothed - transitionProgress) > 0.0001) {
      setTransitionProgress(smoothed);
    }
    
    // 4. MOVE CAMERA
    // Map progress (0->1) to Z-position (5 -> -5).
    // The artwork is typically centered at Z=0.
    // Start (0.0): Z=5 (Viewing position).
    // End (1.0): Z=-5 (Passed through).
    const zPos = THREE.MathUtils.lerp(5, -5, transitionProgress);
    camera.position.set(0, 0, zPos);
    
    // 5. HANDHELD MOTION (Noise)
    // Adds a subtle breathing/floating effect using sine waves.
    const time = state.clock.elapsedTime;
    camera.position.x += Math.sin(time * 0.5) * 0.1;
    camera.position.y += Math.cos(time * 0.3) * 0.1;
    
    // Always look slightly ahead
    camera.lookAt(0, 0, -10);
  });

  return null; // Logic-only component
};

export default CameraRig;
