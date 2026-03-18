import React, { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { useScroll } from '@react-three/drei';

export default function AnamorphicCam() {
  const { camera } = useThree();
  const scroll = useScroll(); // Requires <ScrollControls> wrapper in Scene
  
  const transitionProgress = useStore(state => state.transitionProgress);
  const setTransitionProgress = useStore(state => state.setTransitionProgress);
  const completeTransition = useStore(state => state.completeTransition);
  
  // Define the path
  // Start: 0,0,10 (Looking at Current)
  // End: 0,0,-10 (Looking at Next, which is at -20)
  // We want the path to be dynamic or at least smooth.
  // Start: 0,0,10 (Looking at Current at 0,0,0)
  // Mid: High arc for "exploding" look
  // End: 0,0,-10 (Looking at Next at 0,0,-20)
  const [curve] = useState(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 10),
    new THREE.Vector3(5, 5, 0),   
    new THREE.Vector3(-5, 2, -10),
    new THREE.Vector3(0, 0, -10),
  ]));
  const isTransitioning = useStore(state => state.isTransitioning);

  useFrame((state, delta) => {
    const r = scroll.offset;
    
    // Debug Log (throttled)
    if (Math.random() < 0.01) {
        console.log(`[AnamorphicCam] R: ${r.toFixed(3)}, Transitioning: ${isTransitioning}`);
    }

    setTransitionProgress(r);
    
    const point = curve.getPointAt(r);
    camera.position.lerp(point, 0.1); 
    
    const targetA = new THREE.Vector3(0, 0, 0);
    const targetB = new THREE.Vector3(0, 0, -20);
    const currentTarget = new THREE.Vector3().lerpVectors(targetA, targetB, r);
    
    camera.lookAt(currentTarget);

    // Commit Transition (Trigger once at end of scroll)
    if (r > 0.99 && !isTransitioningRef.current) {
        isTransitioningRef.current = true;
        console.log("[AnamorphicCam] Triggering CompleteTransition");
        
        // Reset scroll before completing internal state to avoid feedback
        if (scroll.el) {
            scroll.el.scrollTop = 0;
        }
        
        // Use a slight delay to allow scroll reset to propagate
        setTimeout(() => {
            completeTransition();
            isTransitioningRef.current = false;
        }, 50);
    }
  });

  const isTransitioningRef = useRef(false);

  return null;
}
