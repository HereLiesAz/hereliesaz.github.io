import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import useStore from '../store/useStore';

const CameraRig = () => {
  const { camera } = useThree();
  const transitionProgress = useStore(state => state.transitionProgress);
  const setTransitionProgress = useStore(state => state.setTransitionProgress);
  
  // Refs for smooth dampening
  const scrollVelocity = useRef(0);
  const targetProgress = useRef(0);

  // Constants
  const FLIGHT_SPEED = 0.0005; // How fast we fly per scroll tick
  const DAMPING = 0.05; // Smoothness (0.01 = icy, 0.9 = stiff)
  
  useEffect(() => {
    const handleWheel = (e) => {
      // Normalize wheel delta across browsers
      const delta = e.deltaY;
      
      // Update velocity (additive for momentum)
      scrollVelocity.current += delta * FLIGHT_SPEED;
    };

    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  useFrame((state, delta) => {
    // 1. Apply Friction to Velocity
    scrollVelocity.current *= 0.95; // Decay
    
    // 2. Update Target Progress
    // We only move forward for now (The "River" flows one way)
    if (Math.abs(scrollVelocity.current) > 0.00001) {
       targetProgress.current += scrollVelocity.current;
    }
    
    // Clamp target to current segment (0 to 1)
    // Actual wrapping happens in the Store when we hit 1.0
    if (targetProgress.current < 0) targetProgress.current = 0;
    if (targetProgress.current > 1) targetProgress.current = 1;

    // 3. Smoothly Interpolate Store Value
    const smoothed = THREE.MathUtils.lerp(transitionProgress, targetProgress.current, DAMPING);
    
    // Only update React state if changed significantly to avoid render thrashing
    if (Math.abs(smoothed - transitionProgress) > 0.0001) {
      setTransitionProgress(smoothed);
    }
    
    // 4. Move Camera
    // CONCEPT: 
    // At progress 0, Camera is at Z=5 (Viewing Active)
    // At progress 1, Camera is at Z=-5 (Past Active, approaching Next)
    // But we need to trick the eye. 
    
    // Simple Flight: Move camera on Z axis.
    // Active Painting is at Z=0.
    // Camera starts at Z=5.
    // As progress goes 0->1, Camera goes 5 -> -5.
    
    const zPos = THREE.MathUtils.lerp(5, -5, smoothed);
    camera.position.set(0, 0, zPos);
    
    // Add slight "breathing" or "handheld" motion based on Perlin noise
    const time = state.clock.elapsedTime;
    camera.position.x = Math.sin(time * 0.5) * 0.1;
    camera.position.y = Math.cos(time * 0.3) * 0.1;
    
    camera.lookAt(0, 0, -10); // Look forward into the void
  });

  return null; // This component has no visual geometry
};

export default CameraRig;
