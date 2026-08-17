import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { useScroll } from '@react-three/drei';

// The whole gallery is driven by scrolling drei's internal ScrollControls
// div, which is never a Tab stop and has no keyboard affordance of its own
// — without this, the experience is 100% unreachable without a
// mouse/trackpad/touchscreen. A window-level keydown listener works
// regardless of DOM focus (there's nothing on this page a keyboard user
// would tab into besides the signature button and, when open, the menu
// modal), so it doesn't require making the scroll div itself focusable.
// Arrow/Page/Home/End only — deliberately not Space, since Space is the
// native "activate" key when the signature button has focus (the only
// other Tab stop on this page) and intercepting it there would break that
// existing, expected behaviour. None of these keys carry a conflicting
// native meaning on that button.
const SCROLL_KEYS = new Set([
  'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End',
]);

// Scroll distance (in ScrollControls "pages") spent traversing one
// painting-to-painting segment. Long on purpose: a slow, deliberate
// scrub per artwork, and the extra distance is head-room for the next
// painting's textures to finish loading before it's needed. Exported so
// Scene can derive <ScrollControls pages> from the actual corpus size
// (pages = PAGES_PER_SEGMENT × segment capacity) instead of a hardcoded
// constant that caps how much of the gallery a full scroll can reach.
export const PAGES_PER_SEGMENT = 10;

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
 *
 * `reduced` (prefers-reduced-motion) skips the mid-transit detour through
 * the shared hinge entirely in favour of one smooth, monotonic pan from
 * the outgoing painting's centre straight to the incoming one's. The
 * sudden gaze redirection toward the hinge is a bigger vestibular-comfort
 * problem than the camera's translation along the dive path — CSS alone
 * (see index.html's prefers-reduced-motion rule) can't reach this, since
 * it only touches the DOM overlay, not this WebGL camera.
 */
function lookTarget(segments, segmentIndex, r, reduced) {
  const cur = segments[segmentIndex];
  const path = cur?.path;
  if (!path || path.length === 0) return tmpLook.set(0, 0, 0);
  const endFallback = path[path.length - 1];
  const startLook = cur.startLook || path[0] || endFallback;
  const focus = cur.focus || endFallback;
  const endLook = cur.endLook || endFallback;

  if (reduced) {
    return tmpLook.lerpVectors(startLook, endLook, THREE.MathUtils.smoothstep(r, 0, 1));
  }

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
  const updateFrame = useStore(state => state.updateFrame);

  // Cache of {index, gen, curve} — CatmullRomCurve3 (and the arc-length LUT
  // it builds internally on first sample) is only rebuilt when the segment
  // actually changes, not every frame. This also means a segment's curve
  // is built exactly once from a stable, fully-formed points array, rather
  // than freshly re-parametrized every tick. `gen` also invalidates it:
  // useStore's recomputePlacements (fired on window resize) can rewrite a
  // segment's path IN PLACE at the same index, which an index-only check
  // would miss until the next transition — bumping placementGeneration
  // forces a rebuild from the fresh path on the very next frame instead.
  const curveCache = useRef({ index: -1, gen: -1, curve: null });

  // Once segments exist, jump the scroll to the painting we open ON —
  // which sits a few segments IN, above the backward buffer — so the
  // viewer can immediately scroll UP into earlier paintings instead of
  // hitting a wall at the top.
  const didInit = useRef(false);

  // Read live (not just at mount) via a change listener, since a user can
  // toggle this OS-level setting without reloading the page.
  const reducedMotionRef = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const onChange = (e) => { reducedMotionRef.current = e.matches; };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (!SCROLL_KEYS.has(e.key)) return;
      // The menu modal is the only other keyboard surface on this page;
      // while it's open, these keys shouldn't also drive the gallery
      // underneath it.
      if (useStore.getState().showMenu) return;
      const el = scroll.el;
      if (!el) return;
      const total = el.scrollHeight - el.clientHeight;
      if (total <= 0) return;
      e.preventDefault();
      if (e.key === 'Home') {
        el.scrollTop = 0;
      } else if (e.key === 'End') {
        el.scrollTop = total;
      } else {
        const step = (e.key === 'PageDown' || e.key === 'PageUp' ? 0.1 : 0.02) * total;
        const dir = (e.key === 'ArrowDown' || e.key === 'PageDown') ? 1 : -1;
        el.scrollTop = Math.max(0, Math.min(total, el.scrollTop + dir * step));
      }
      // The scroll div is a plain native-scrollable element (see drei's
      // ScrollControls) — setting scrollTop directly doesn't itself fire
      // a 'scroll' event in every browser the way user-driven scrolling
      // does, so dispatch one explicitly to make sure drei's internal
      // offset tracking picks up the change on the very next frame.
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [scroll]);

  useFrame(() => {
    if (segments.length === 0) return;

    const totalPages = scroll.pages;

    if (!didInit.current) {
      const startIdx = useStore.getState().startSegmentIndex || 0;
      const el = scroll.el;
      if (startIdx > 0 && el && totalPages > 0) {
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

    const reduced = reducedMotionRef.current;
    // Ease each segment with a smootherstep so velocity → 0 at both ends.
    // The camera DECELERATES into every null and accelerates back out:
    // it visibly ARRIVES at each painting as it coalesces, then departs,
    // instead of coasting through at constant speed. The reveal reads the
    // same eased clock (via transitionProgress) so the art resolves
    // exactly as the motion settles — camera in, art revealed. Reduced
    // motion falls back to a gentler quadratic smoothstep instead of this
    // quintic one, so the acceleration/deceleration swing at each end is
    // less extreme (see lookTarget above for the bigger reduced-motion
    // change — skipping the mid-transit gaze detour).
    const r = reduced
      ? rLin * rLin * (3 - 2 * rLin)
      : rLin * rLin * rLin * (rLin * (rLin * 6 - 15) + 10);
    // getPointAt requires u in [0,1]; the upstream clamp keeps rLin just
    // under 1 in the normal case, but a large/instant scroll jump (a
    // scrollbar-thumb drag, Home/End) can hand this a value that's
    // *effectively* 1 after float rounding, which THREE's arc-length
    // lookup doesn't tolerate gracefully — clamp explicitly rather than
    // trust every upstream path to land inside range.
    const rSafe = Math.min(1, Math.max(0, r));

    const placementGen = useStore.getState().placementGeneration;
    if (curveCache.current.index !== segmentIndex || curveCache.current.gen !== placementGen) {
      curveCache.current = {
        index: segmentIndex,
        gen: placementGen,
        curve: new THREE.CatmullRomCurve3(currentSegment.path),
      };
    }
    try {
      const p = curveCache.current.curve.getPointAt(rSafe);
      // A degenerate segment (e.g. near-coincident start/hinge/end points
      // from an edge case in the placement math) can hand back a
      // non-finite point even without throwing. Never feed that to the
      // camera — hold the last good position instead of snapping to
      // NaN/Infinity, which would blank the canvas.
      if (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
        camera.position.copy(p);
      }
      camera.lookAt(lookTarget(segments, segmentIndex, rSafe, reduced));
    } catch (err) {
      // Never let a curve-sampling edge case turn into a permanent,
      // every-frame-repeating crash loop (observed: CatmullRomCurve3's
      // arc-length search throwing on a large/instant scroll jump) — hold
      // the camera at its last good position for this frame and recover
      // on the next one instead of freezing the whole experience.
      if (!curveCache.current.warned) {
        console.warn('[AnamorphicCam] curve sample failed, holding position:', err);
        curveCache.current.warned = true;
      }
    }

    // Single atomic update: transitionProgress and currentSegmentIndex
    // (which drives which paintings <Scene> mounts) always change
    // together here, in one set() call, so subscribers never observe one
    // fresh and the other stale (see updateFrame's doc comment). This
    // replaces what used to be a separate setTransitionProgress() call
    // plus a conditional backtrackTo() call. Update in BOTH directions
    // (forward and backward) so scrolling back remounts earlier paintings.
    updateFrame(segmentIndex, r);

    // Build ahead early — the gaze handoff at r>0.6 wants the next
    // segment's focus to already exist. Only fires when the user is
    // actually near the frontier; scrolling backwards never extends.
    // Second condition is a safety net for a fast/large scroll jump that
    // outruns what's built (clampedTotal above would otherwise leave the
    // camera pinned on a stale trailing segment until r next climbs
    // past 0.5): if the raw scroll target has already outrun the built
    // segments, catch up immediately regardless of r.
    if (segments.length < segmentIndex + 2 &&
        (r > 0.5 || totalProgress > segments.length - 1)) {
      useStore.getState().buildNextSegment();
    }
  });

  return null;
}
