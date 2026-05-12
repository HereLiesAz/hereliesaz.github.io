import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { useScroll } from '@react-three/drei';

const PAGES_PER_SEGMENT = 4;

// Re-usable temp object so useFrame doesn't allocate per-tick.
const tmpLook = new THREE.Vector3();

/**
 * The camera always points at the painting it's heading toward — i.e. the
 * *endpoint* of the current segment (the next painting on the walk), not
 * at a midpoint along the swervy spline. This keeps the destination
 * centred while the lateral swerve arcs the camera around it, instead of
 * letting the look-direction wander off-axis with the spline curvature.
 *
 * Near the very end of a segment we blend toward the segment-after's
 * endpoint so the gaze doesn't snap at a boundary crossing.
 */
function lookTarget(segments, segmentIndex, r) {
  const cur = segments[segmentIndex];
  const here = cur.path[cur.path.length - 1];           // painting B's null
  const next = segments[segmentIndex + 1];
  if (next && r > 0.9) {
    const after = next.path[next.path.length - 1];      // painting C's null
    const t = (r - 0.9) / 0.1;
    tmpLook.set(
      THREE.MathUtils.lerp(here.x, after.x, t),
      THREE.MathUtils.lerp(here.y, after.y, t),
      THREE.MathUtils.lerp(here.z, after.z, t),
    );
    return tmpLook;
  }
  tmpLook.copy(here);
  return tmpLook;
}

export default function AnamorphicCam() {
  const { camera } = useThree();
  const scroll = useScroll();
  const isTransitioningRef = useRef(false);

  const segments = useStore(state => state.segments);
  const setTransitionProgress = useStore(state => state.setTransitionProgress);

  useFrame(() => {
    if (segments.length === 0) return;

    const totalPages = scroll.pages;
    const totalProgress = (scroll.offset * totalPages) / PAGES_PER_SEGMENT;
    const segmentIndex = Math.min(Math.floor(totalProgress), segments.length - 1);
    const r = totalProgress - Math.floor(totalProgress);

    const currentSegment = segments[segmentIndex];
    if (!currentSegment) return;

    setTransitionProgress(r);

    const curve = new THREE.CatmullRomCurve3(currentSegment.path);

    // Position on the segment spline; orientation by looking at a point a
    // little further along the same spline. This is a "follow the path"
    // camera — at each painting's null the tangent points down -Z so the
    // painting reads head-on; between nulls the camera naturally banks
    // through the mid-segment swerve.
    camera.position.copy(curve.getPointAt(r));
    camera.lookAt(lookTarget(segments, segmentIndex, r));

    if (r > 0.8 && segments.length < segmentIndex + 2) {
      useStore.getState().buildNextSegment();
    }

    if (useStore.getState().currentSegmentIndex !== segmentIndex) {
      useStore.getState().completeTransition();
    }

    if (scroll.offset > 0.999 && !isTransitioningRef.current) {
      isTransitioningRef.current = true;
      if (scroll.el) scroll.el.scrollTop = 0;
      setTimeout(() => { isTransitioningRef.current = false; }, 100);
    }
  });

  return null;
}
