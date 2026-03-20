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
  // Access the Three.js Camera instance
  const { camera } = useThree();

  // Access Store State & Actions
  const transitionProgress = useStore(state => state.transitionProgress);
  const setTransitionProgress = useStore(state => state.setTransitionProgress);
  
  // --- PHYSICS STATE ---
  // Refs are used for mutable values that don't trigger React re-renders.
  // This is crucial for high-performance animation loops (60/120 FPS).

  // The current speed of scrolling (for momentum)
  const scrollVelocity = useRef(0);

  // The target progress value we are trying to reach (for smoothing)
  const targetProgress = useRef(transitionProgress);

  // --- CONSTANTS ---
  // Tuning parameters for the "feel" of the flight.
  const FLIGHT_SPEED = 0.0005; // Sensitivity: How fast we fly per wheel tick
  const DAMPING = 0.05;        // Friction: Lower = Slower/Smoother interpolation

  // --- SYNC WITH EXTERNAL STATE ---
  // If the store updates transitionProgress (e.g. via a jump), we must sync our local ref.
  useEffect(() => {
    targetProgress.current = transitionProgress;
  }, [transitionProgress]);

  // --- INPUT HANDLING ---
  useEffect(() => {
    const handleWheel = (e) => {
      // DeltaY is positive when scrolling down (Forward), negative up (Backward).
      // We accumulate velocity rather than position directly to create momentum.
      // This feels like "pushing" the camera.
      scrollVelocity.current += e.deltaY * FLIGHT_SPEED;
    };

    // Add listener to the window.
    // passive: true improves performance by promising not to call preventDefault().
    window.addEventListener('wheel', handleWheel, { passive: true });

    // Cleanup listener on unmount
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  // --- ANIMATION LOOP ---
  // 'useFrame' runs before every render (60 times a second).
  useFrame((state, delta) => {
    // 1. APPLY FRICTION
    // Decay velocity over time. 0.95 means we lose 5% of speed per frame.
    // This creates the "glide" effect after you stop scrolling.
    scrollVelocity.current *= 0.95;
    
    // 2. APPLY VELOCITY
    // Only update if moving significantly to save float math.
    if (Math.abs(scrollVelocity.current) > 0.00001) {
       targetProgress.current += scrollVelocity.current;
    }
    
    // NOTE: We do NOT clamp targetProgress here.
    // We let it go > 1.0 or < 0.0 so the Store can detect the boundary crossing
    // and trigger the "Next Artwork" or "Previous Artwork" logic.

    // 3. SMOOTH INTERPOLATION
    // We strictly interpolate the VISUAL progress towards the target.
    // This removes jitter from the mouse wheel input.
    const smoothed = THREE.MathUtils.lerp(transitionProgress, targetProgress.current, DAMPING);
    
    // Update Store only if changed significantly (optimization)
    if (Math.abs(smoothed - transitionProgress) > 0.0001) {
      setTransitionProgress(smoothed);
    }
    
    // 4. MOVE CAMERA
    // Map progress (0->1) to Z-position (5 -> -5).
    // The artwork is typically centered at Z=0.
    // Start (0.0): Z=5 (Viewing position).
    // End (1.0): Z=-5 (Passed through).
    const zPos = THREE.MathUtils.lerp(5, -5, transitionProgress);

    // Apply the position. We stay centered on X/Y.
    camera.position.set(0, 0, zPos);
    
    // 5. HANDHELD MOTION (Noise)
    // Adds a subtle breathing/floating effect using sine waves.
    // This makes the void feel "alive" rather than static.
    const time = state.clock.elapsedTime;
    camera.position.x += Math.sin(time * 0.5) * 0.1; // Gentle sway X
    camera.position.y += Math.cos(time * 0.3) * 0.1; // Gentle sway Y
    
    // Always look slightly ahead into the distance (Z=-10).
    camera.lookAt(0, 0, -10);
  });

  return null; // Logic-only component, renders nothing
};

export default CameraRig;
