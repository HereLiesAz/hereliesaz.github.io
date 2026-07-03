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
function lookTarget(segments, segmentIndex, r) {
  const cur = segments[segmentIndex];
  const endFallback = cur.path[cur.path.length - 1];
  const startLook = cur.startLook || cur.path[0];
  const focus = cur.focus || endFallback;
  const endLook = cur.endLook || endFallback;

  if (r <= 0.15) return tmpLook.copy(startLook);
  if (r >= 0.85) return tmpLook.copy(endLook);
  if (r < 0.35) {
    return tmpLook.lerpVectors(startLook, focus, THREE.MathUtils.smoothstep(r, 0.15, 0.35));
  }
  if (r > 0.65) {
    return tmpLook.lerpVectors(focus, endLook, THREE.MathUtils.smoothstep(r, 0.65, 0.85));
  }
  return tmpLook.copy(focus);
}

export default function AnamorphicCam() {
  const { camera } = useThree();
  const scroll = useScroll();

  const segments = useStore(state => state.segments);
  const setTransitionProgress = useStore(state => state.setTransitionProgress);

  useFrame(() => {
    if (segments.length === 0) return;

    const totalPages = scroll.pages;
    // Total progress can span [0, segments.length]. We clamp to the
    // already-built range so the user can scroll back into segments they
    // have already visited (bidirectional navigation) while forward
    // scroll builds more.
    const totalProgress = (scroll.offset * totalPages) / PAGES_PER_SEGMENT;
    const clampedTotal = Math.max(0, Math.min(totalProgress, segments.length - 0.001));
    const segmentIndex = Math.min(Math.floor(clampedTotal), segments.length - 1);
    const r = clampedTotal - segmentIndex;

    const currentSegment = segments[segmentIndex];
    if (!currentSegment) return;

    setTransitionProgress(r);

    const curve = new THREE.CatmullRomCurve3(currentSegment.path);
    camera.position.copy(curve.getPointAt(r));
    camera.lookAt(lookTarget(segments, segmentIndex, r));
    if (currentSegment.bank) {
      camera.rotateZ(currentSegment.bank * Math.sin(Math.PI * r));
    }

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
