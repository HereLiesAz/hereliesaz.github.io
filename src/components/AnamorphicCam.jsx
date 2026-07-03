import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { useScroll } from '@react-three/drei';

const PAGES_PER_SEGMENT = 4;

// Re-usable temp object so useFrame doesn't allocate per-tick.
const tmpLook = new THREE.Vector3();

/**
 * Look target is the segment's focus — always world origin under the
 * hinge-aligned model. Both paintings' hinge patches sit at origin;
 * pointing the camera at origin keeps the shared patch fixed at screen
 * centre for the whole transit while the paintings rotate and dissolve
 * around it. No blends needed — origin IS the head-on target from both
 * paintings' viewing nulls because those nulls lie on the painting's
 * normal through the hinge.
 */
function lookTarget(segments, segmentIndex) {
  const cur = segments[segmentIndex];
  return tmpLook.copy(cur.focus || cur.path[cur.path.length - 1]);
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
    camera.lookAt(lookTarget(segments, segmentIndex));

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
