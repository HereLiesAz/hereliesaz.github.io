import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { useScroll } from '@react-three/drei';

// Scroll distance (in ScrollControls "pages") spent traversing one
// painting-to-painting segment. Long on purpose: a slow, deliberate
// scrub per artwork, and the extra distance is head-room for the next
// painting's textures to finish loading before it's needed. Keep in
// step with <ScrollControls pages> in Scene (pages = PAGES_PER_SEGMENT
// × segment capacity).
const PAGES_PER_SEGMENT = 10;

// Re-usable temp object so useFrame doesn't allocate per-tick.
const tmpLook = new THREE.Vector3();

/**
 * Three-phase look target: at each null the camera looks at the
 * painting's plane centre so the painting COALESCES dead centre. Only
 * mid-transit does the gaze route through the shared hinge (world
 * origin), so the shared patch is momentarily at screen centre with
 * both paintings dissolved around it. Outside those bands, smooth
 * blends carry the frame from one composition to the next.
 *
 *   r ≤ 0.15                 startLook   (painting A centre — coalesces)
 *   r ∈ (0.15, 0.35)         blend to focus
 *   r ∈ (0.35, 0.65)         focus       (hinge — chaos moment)
 *   r ∈ (0.65, 0.85)         blend to endLook
 *   r ≥ 0.85                 endLook     (painting B centre — coalesces)
 */
function lookTarget(segments, segmentIndex, r) {
  const cur = segments[segmentIndex];
  const path = cur?.path;
  if (!path || path.length === 0) return tmpLook.set(0, 0, 0);
  const endFallback = path[path.length - 1];
  const startLook = cur.startLook || path[0] || endFallback;
  const focus = cur.focus || endFallback;
  const endLook = cur.endLook || endFallback;

  if (r <= 0.15) return tmpLook.copy(startLook);
  if (r >= 0.85) return tmpLook.copy(endLook);
  if (r < 0.35) {
    return tmpLook.lerpVectors(startLook, focus,
      THREE.MathUtils.smoothstep(r, 0.15, 0.35));
  }
  if (r > 0.65) {
    return tmpLook.lerpVectors(focus, endLook,
      THREE.MathUtils.smoothstep(r, 0.65, 0.85));
  }
  return tmpLook.copy(focus);
}

export default function AnamorphicCam() {
  const { camera } = useThree();
  const scroll = useScroll();

  const segments = useStore(state => state.segments);
  const setTransitionProgress = useStore(state => state.setTransitionProgress);

  // Once segments exist, jump the scroll to the painting we open ON —
  // which sits a few segments IN, above the backward buffer — so the
  // viewer can immediately scroll UP into earlier paintings instead of
  // hitting a wall at the top.
  const didInit = useRef(false);

  useFrame(() => {
    if (segments.length === 0) return;

    const totalPages = scroll.pages;

    if (!didInit.current) {
      const startIdx = useStore.getState().startSegmentIndex || 0;
      const el = scroll.el;
      if (startIdx > 0 && el) {
        const offset = Math.min(0.999, (startIdx * PAGES_PER_SEGMENT) / totalPages);
        el.scrollTop = offset * (el.scrollHeight - el.clientHeight);
      }
      didInit.current = true;
    }
    // Total progress can span [0, segments.length]. We clamp to the
    // already-built range so the user can scroll back into segments they
    // have already visited (bidirectional navigation) while forward
    // scroll builds more.
    const totalProgress = (scroll.offset * totalPages) / PAGES_PER_SEGMENT;
    const clampedTotal = Math.max(0, Math.min(totalProgress, segments.length - 0.001));
    const segmentIndex = Math.min(Math.floor(clampedTotal), segments.length - 1);
    const rLin = clampedTotal - segmentIndex;

    const currentSegment = segments[segmentIndex];
    // A CatmullRom needs >=2 points; a half-built segment (or an index the
    // scroll briefly overshoots) would otherwise read .x off undefined.
    if (!currentSegment || !currentSegment.path || currentSegment.path.length < 2) return;

    // Ease each segment with a smootherstep so velocity → 0 at both ends.
    // The camera DECELERATES into every null and accelerates back out:
    // it visibly ARRIVES at each painting as it coalesces, then departs,
    // instead of coasting through at constant speed. The reveal reads the
    // same eased clock (via transitionProgress) so the art resolves
    // exactly as the motion settles — camera in, art revealed.
    const r = rLin * rLin * rLin * (rLin * (rLin * 6 - 15) + 10);

    setTransitionProgress(r);

    const curve = new THREE.CatmullRomCurve3(currentSegment.path);
    camera.position.copy(curve.getPointAt(r));
    camera.lookAt(lookTarget(segments, segmentIndex, r));

    // Build ahead early — the gaze handoff at r>0.6 wants the next
    // segment's focus to already exist. Only fires when the user is
    // actually near the frontier; scrolling backwards never extends.
    if (r > 0.5 && segments.length < segmentIndex + 2) {
      useStore.getState().buildNextSegment();
    }

    // Keep the store's currentSegmentIndex in sync with the scroll —
    // this is what drives which paintings are mounted in <Scene>. Update
    // in BOTH directions (forward and backward) so scrolling back
    // remounts the earlier paintings.
    const storeIdx = useStore.getState().currentSegmentIndex;
    if (storeIdx !== segmentIndex) {
      useStore.getState().backtrackTo(segmentIndex);
    }
  });

  return null;
}
