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
    // DO NOT set store state here! It triggers global re-renders.
    // shards will read from scroll directly if needed, or we use a uniform.
    
    // Follow the store-provided spline
    const point = curve.getPointAt(r);
    camera.position.copy(point); 
    
    // --- CINEMATIC SWAY ---
    const activeClusters = useStore.getState().activeClusters;
    const currentCluster = activeClusters[activeClusters.length - 1];
    
    if (currentCluster && currentCluster.rotSway) {
        const swayFactor = Math.sin(r * Math.PI); 
        camera.rotation.set(
            currentCluster.rotSway[0] * swayFactor * (Math.PI / 180),
            currentCluster.rotSway[1] * swayFactor * (Math.PI / 180),
            currentCluster.rotSway[2] * swayFactor * (Math.PI / 180)
        );

        // Verification Log at 35% mark
        if (r >= 0.35 && r < 0.40 && !state.hasLogged35) {
            const total = Math.abs(currentCluster.rotSway[0]) + Math.abs(currentCluster.rotSway[1]) + Math.abs(currentCluster.rotSway[2]);
            console.log(`[VERIFY] 35% mark. Progress: ${r.toFixed(2)}. Cinematic Transformation: ${total.toFixed(2)} deg`);
            state.hasLogged35 = true; 
        }
    } else {
        camera.rotation.set(0, 0, 0); 
    }
    if (r < 0.1) state.hasLogged35 = false; 
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
    
    // BACKWARD Traversal
    if (r < 0.001 && !isTransitioningRef.current) {
        const historyDepth = useStore.getState().history.length;
        if (historyDepth > 0) {
            isTransitioningRef.current = true;
            
            // Set scroll to bottom for the previous segment
            if (scroll.el) {
                scroll.el.scrollTop = scroll.el.scrollHeight;
            }
            
            setTimeout(() => {
                const { goBackward } = useStore.getState();
                goBackward();
                isTransitioningRef.current = false;
            }, 100);
        }
    }
  });

  return null;
}
