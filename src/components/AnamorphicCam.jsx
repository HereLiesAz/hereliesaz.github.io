import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { useScroll } from '@react-three/drei';

export default function AnamorphicCam() {
  const { camera } = useThree();
  const scroll = useScroll(); 
  const isTransitioningRef = useRef(false);
  
  const segments = useStore(state => state.segments);
  const activeClusters = useStore(state => state.activeClusters);
  const completeTransition = useStore(state => state.completeTransition);
  const setTransitionProgress = useStore(state => state.setTransitionProgress);

  const PAGES_PER_SEGMENT = 4;

  useFrame((state, delta) => {
    if (segments.length === 0) return;

    // --- SEGMENT MAPPING ---
    // totalPages is what we set in Scene.jsx (e.g. 100)
    const totalPages = scroll.pages; 
    const totalProgress = (scroll.offset * totalPages) / PAGES_PER_SEGMENT;
    const segmentIndex = Math.min(Math.floor(totalProgress), segments.length - 1);
    const r = totalProgress - Math.floor(totalProgress);

    const currentSegment = segments[segmentIndex];
    if (!currentSegment) return;

    // Push live segment progress to the store so the chrome (caption fade,
    // active-painting hand-off) can read it without listening on r3f frames.
    setTransitionProgress(r);

    // Create a spline for this specific segment if not already done
    // (Optimization: we could pre-calculate these in the store, but here is fine for now)
    const curve = new THREE.CatmullRomCurve3(currentSegment.path);
    
    // Follow the segment spline
    const point = curve.getPointAt(r);
    camera.position.copy(point); 
    
    // --- ROTATION ALIGNMENT & COALESCENCE ---
    // Rotation A = Start of segment, Rotation B = End of segment
    const rotA = activeClusters[segmentIndex]?.rotSway || [0,0,0];
    const rotB = activeClusters[segmentIndex + 1]?.rotSway || [0,0,0];

    const rx = THREE.MathUtils.lerp(rotA[0], rotB[0], r);
    const ry = THREE.MathUtils.lerp(rotA[1], rotB[1], r);
    const rz = THREE.MathUtils.lerp(rotA[2], rotB[2], r);

    camera.rotation.set(
        THREE.MathUtils.degToRad(rx),
        THREE.MathUtils.degToRad(ry),
        THREE.MathUtils.degToRad(rz)
    );

    // Update store state (for visibility and pre-loading)
    if (r > 0.8 && segments.length < segmentIndex + 2) {
        // Pre-build next segment when getting close
        useStore.getState().buildNextSegment();
    }

    // Sync current segment index to store for ShardCloud visibility
    if (useStore.getState().currentSegmentIndex !== segmentIndex) {
        useStore.getState().completeTransition(); // This increments currentSegmentIndex
    }

    // ONLY reset if we hit the ABSOLUTE end of the 100 pages
    if (scroll.offset > 0.999 && !isTransitioningRef.current) {
        isTransitioningRef.current = true;
        if (scroll.el) scroll.el.scrollTop = 0;
        // Logic to clear old segments could go here if memory is an issue
        setTimeout(() => { isTransitioningRef.current = false; }, 100);
    }
  });

  return null;
}
