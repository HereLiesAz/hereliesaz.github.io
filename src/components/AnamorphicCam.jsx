import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { useScroll } from '@react-three/drei';

export default function AnamorphicCam() {
  const { camera } = useThree();
  const scroll = useScroll(); 
  const isTransitioningRef = useRef(false);
  
  const transitionProgress = useStore(state => state.transitionProgress);
  const setTransitionProgress = useStore(state => state.setTransitionProgress);
  const completeTransition = useStore(state => state.completeTransition);
  
  const currentPathPoints = useStore(state => state.currentPath);
  
  // Create a spline from the store points
  const curve = useMemo(() => {
    if (!currentPathPoints || currentPathPoints.length < 2) return null;
    return new THREE.CatmullRomCurve3(currentPathPoints);
  }, [currentPathPoints]);

  const isTransitioning = useStore(state => state.isTransitioning);

  useFrame((state, delta) => {
    if (!curve) return;

    const r = scroll.offset;
    setTransitionProgress(r);
    
    // Follow the store-provided spline
    const point = curve.getPointAt(r);
    camera.position.copy(point); 
    
    // Fixed perspective for anamorphosis
    camera.rotation.set(0, 0, 0); 
    
    // Commit Transition (Window slide)
    if (r > 0.99 && !isTransitioningRef.current) {
        isTransitioningRef.current = true;
        
        // Reset scroll position to beginning for next segment
        if (scroll.el) {
            scroll.el.scrollTop = 0;
        }
        
        // Brief delay to prevent race conditions during reset
        setTimeout(() => {
            completeTransition();
            isTransitioningRef.current = false;
        }, 100);
    }
  });

  return null;
}
