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
  const [curve] = useState(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 10), // Start (Sweet spot for Current)
    new THREE.Vector3(2, 1, 0),  // Midpoint (Looking slightly away)
    new THREE.Vector3(0, 0, -10), // End (Sweet spot for Next relative to camera)
    // Actually, Next is at -20. Sweet spot for it is usually Z distance away.
    // If Next is at -20, and we want to see it, we should be at -10 looking at -20?
    // Let's assume sweet spot distance is 10 units.
  ]));

  useFrame((state, delta) => {
    // Get scroll offset (0 to 1) from ScrollControls
    // useScroll provides .offset (current scroll position 0..1)
    const r = scroll.offset;
    
    // Update store progress to drive shaders
    // We update the store so other components (Overlay, ShardCloud) stay in sync.
    if (Math.abs(r - transitionProgress) > 0.001) {
        setTransitionProgress(r);
    }
    
    // Move Camera along spline
    const point = curve.getPoint(r);
    
    // Smooth Camera Movement (Lerp)
    // We use a small factor to smooth out scroll steps.
    camera.position.lerp(point, 0.1); 
    
    // Look Ahead Logic (Target Interpolation)
    // Current is at 0,0,0. Next is at 0,0,-20.
    // As we move forward (r goes 0->1), we shift focus from 0,0,0 to 0,0,-20.
    const lookAtTarget = new THREE.Vector3(0, 0, -20 * r);
    
    camera.lookAt(lookAtTarget);

    // Trigger Transition
    // When we reach the end of the scroll container, we trigger the graph update.
    if (r > 0.98) {
        completeTransition();
        // Reset scroll position to 0 (top) to start the next segment
        if (scroll.el) scroll.el.scrollTop = 0; 
    }
  });

  return null;
}
