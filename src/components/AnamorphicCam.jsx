import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { useScroll } from '@react-three/drei';

const PAGES_PER_SEGMENT = 4;

// Re-usable temp object so useFrame doesn't allocate per-tick.
const tmpLook = new THREE.Vector3();

/**
 * The bubbles rule (from the reference video): mid-transit the camera
 * stays pointed at ONE central point — the segment's `focus`, the
 * shared patch it orbits on nested spheres. At either NULL, though, the
 * gaze must be dead-ahead on the current painting so the paper theater
 * reassembles head-on. The choreography per segment:
 *
 *    r ≤ 0.15   look at cur.startLook  (current painting, head-on)
 *    r ∈ (0.15, 0.35)   blend startLook → focus
 *    r ∈ (0.35, 0.65)   look at focus  (orbiting the hinge)
 *    r ∈ (0.65, 0.85)   blend focus → endLook
 *    r ≥ 0.85   look at cur.endLook  (next painting, head-on)
 *
 * Both nulls therefore frame their painting dead centre; only the
 * middle of the transit routes the gaze through the off-centre hinge.
 */
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

function lerpTo(out, from, to, t) {
  out.set(
    THREE.MathUtils.lerp(from.x, to.x, t),
    THREE.MathUtils.lerp(from.y, to.y, t),
    THREE.MathUtils.lerp(from.z, to.z, t),
  );
  return out;
}

function lookTarget(segments, segmentIndex, r) {
  const cur = segments[segmentIndex];
  const endFallback = cur.path[cur.path.length - 1];
  const startLook = cur.startLook || cur.path[0];
  const focus = cur.focus || endFallback;
  const endLook = cur.endLook || endFallback;

  if (r <= 0.15) return tmpLook.copy(startLook);
  if (r >= 0.85) return tmpLook.copy(endLook);
  if (r < 0.35) {
    return lerpTo(tmpLook, startLook, focus, THREE.MathUtils.smoothstep(r, 0.15, 0.35));
  }
  if (r > 0.65) {
    return lerpTo(tmpLook, focus, endLook, THREE.MathUtils.smoothstep(r, 0.65, 0.85));
  }
  return tmpLook.copy(focus);
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
