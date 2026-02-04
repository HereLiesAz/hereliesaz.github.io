import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import useStore from '../store/useStore';

const CameraRig = () => {
  const { camera } = useThree();
  const transitionProgress = useStore(state => state.transitionProgress);
  const setTransitionProgress = useStore(state => state.setTransitionProgress);
  
  const scrollVelocity = useRef(0);
  const targetProgress = useRef(transitionProgress); // Sync ref with state initially

  const FLIGHT_SPEED = 0.0005;
  const DAMPING = 0.05;
  
  // Sync Ref if external state changes (e.g. after a swap)
  useEffect(() => {
    targetProgress.current = transitionProgress;
  }, [transitionProgress]);

  useEffect(() => {
    const handleWheel = (e) => {
      // DeltaY is positive when scrolling down (Forward), negative up (Backward)
      scrollVelocity.current += e.deltaY * FLIGHT_SPEED;
    };
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  useFrame((state, delta) => {
    // 1. Apply Friction
    scrollVelocity.current *= 0.95; 
    
    // 2. Apply Velocity
    if (Math.abs(scrollVelocity.current) > 0.00001) {
       targetProgress.current += scrollVelocity.current;
    }
    
    // NOTE: We do NOT clamp targetProgress here anymore.
    // We let it go > 1 or < 0 so the Store can detect the boundary crossing.

    // 3. Smooth Interpolation
    // We strictly interpolate the VISUAL progress, but we send the RAW target to the store
    // so it knows we crossed the line.
    
    const smoothed = THREE.MathUtils.lerp(transitionProgress, targetProgress.current, DAMPING);
    
    // Update Store
    if (Math.abs(smoothed - transitionProgress) > 0.0001) {
      setTransitionProgress(smoothed);
    }
    
    // 4. Move Camera
    // Forward Flight: Z goes 5 -> -5
    // At 0.0, we are at 5. At 1.0, we are at -5.
    const zPos = THREE.MathUtils.lerp(5, -5, transitionProgress); // Use state, not ref, for visual consistency
    camera.position.set(0, 0, zPos);
    
    // Handheld motion
    const time = state.clock.elapsedTime;
    camera.position.x = Math.sin(time * 0.5) * 0.1;
    camera.position.y = Math.cos(time * 0.3) * 0.1;
    
    camera.lookAt(0, 0, -10);
  });

  return null;
};

export default CameraRig;
