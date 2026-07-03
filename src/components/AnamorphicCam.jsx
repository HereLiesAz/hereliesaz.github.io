import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { useScroll } from '@react-three/drei';

const PAGES_PER_SEGMENT = 4;

// Re-usable temp object so useFrame doesn't allocate per-tick.
const tmpLook = new THREE.Vector3();

/**
 * The bubbles rule (from the reference video): however the camera moves,
 * it stays pointed at ONE central point — the segment's `focus`, the
 * pareidolia hinge the camera orbits on its nested spheres. Late in the
 * segment the gaze hands off: preferably straight to the NEXT segment's
 * focus (so consecutive orbits share a continuous line of sight),
 * falling back to `endLook` (the destination painting's shell front,
 * dead ahead at the null) while the next segment hasn't been built yet.
 */
function lookTarget(segments, segmentIndex, r) {
  const cur = segments[segmentIndex];
  const next = segments[segmentIndex + 1];
  const from = cur.focus || cur.path[cur.path.length - 1];
  const to = next?.focus || cur.endLook || cur.path[cur.path.length - 1];
  const t = THREE.MathUtils.smoothstep(r, 0.6, 0.95);
  tmpLook.set(
    THREE.MathUtils.lerp(from.x, to.x, t),
    THREE.MathUtils.lerp(from.y, to.y, t),
    THREE.MathUtils.lerp(from.z, to.z, t),
  );
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

    // Position on the segment's orbit; gaze locked on the segment focus
    // (see lookTarget). A touch of bank through the middle of the orbit
    // keeps the sweep from feeling like it's on rails.
    camera.position.copy(curve.getPointAt(r));
    camera.lookAt(lookTarget(segments, segmentIndex, r));
    if (currentSegment.bank) {
      camera.rotateZ(currentSegment.bank * Math.sin(Math.PI * r));
    }

    // Build ahead early — the gaze handoff at r>0.6 wants the next
    // segment's focus to already exist.
    if (r > 0.5 && segments.length < segmentIndex + 2) {
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
