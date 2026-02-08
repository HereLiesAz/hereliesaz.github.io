import React, { useEffect, useRef } from 'react';
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
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 10),
    new THREE.Vector3(2, 1, 0), // Slight curve for interest
    new THREE.Vector3(0, 0, -10),
  ]);

  useFrame(() => {
    // Get scroll offset (0 to 1)
    const r = scroll.offset;
    
    // Update store progress
    if (Math.abs(r - transitionProgress) > 0.001) {
        setTransitionProgress(r);
    }
    
    // Move Camera
    const point = curve.getPoint(r);
    camera.position.copy(point);
    camera.lookAt(0, 0, -20 * r); // Look ahead

    // Trigger Transition
    if (r > 0.99) {
        completeTransition();
        // Reset scroll? usually handled by ScrollControls or we manually reset.
        // With useScroll, hard to reset programmatically without access to its ref or imperative handle.
        // For now, we assume standard scroll behavior where user scrolls back or loop.
    }
  });

  return null;
}
