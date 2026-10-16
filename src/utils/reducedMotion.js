// Cached prefers-reduced-motion state. Read every frame by the camera
// (AnamorphicCam.jsx) and the painting shaders (TheaterPainting.jsx), so it
// must NOT call matchMedia() per frame — one MediaQueryList is created at
// module load and a change listener keeps the cached value live (the OS
// setting can be toggled without a reload).

let reduced = false;

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduced = mq.matches;
  const onChange = (e) => { reduced = e.matches; };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else if (typeof mq.addListener === 'function') mq.addListener(onChange); // Safari < 14
}

/** True when the viewer has asked the OS for reduced motion. */
export function prefersReducedMotion() {
  return reduced;
}
