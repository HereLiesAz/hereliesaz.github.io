// Single source of truth for the geometry constants that tie the camera
// (AnamorphicCam.jsx / Scene.jsx), the world-space hinge placement math
// (useStore.jsx), and the rendered painting geometry (TheaterPainting.jsx)
// together. All three previously hand-duplicated their own copies of these
// same numbers, correct only because someone kept them in sync by hand --
// the exact bug class ("coalescence never quite aligns") already fixed
// once elsewhere in this app. A future edit to any one of them (a
// responsive FOV, a taller painting height) now only needs to happen here.

// Camera radius (from a painting's local origin, along its local +Z) that
// reads the painting exactly head-on -- the "null" every hinge transition
// coalesces at.
export const NULL_DISTANCE = 11.0;

// World-space height every painting's plane geometry is built at (before
// per-painting fitScale). Used to convert a hinge uv into a world offset,
// and to size the rendered plane geometry.
export const PAINTING_HEIGHT = 10.0;

// Must match the actual <PerspectiveCamera fov={...}> in Scene.jsx --
// needed wherever fitScale (or anything deriving the camera's visible
// frustum size) is computed outside the component that owns the camera.
export const CAMERA_FOV_DEG = 50;
