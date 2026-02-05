// Anamorphic Vertex Shader
// ========================
// This shader handles the positioning and movement of the "Stroke Cloud" particles.
// It is responsible for the core visual mechanic: transforming a chaotic cloud of
// particles into a coherent image based on the camera's Z-position.

// --- UNIFORMS ---
// Global time (for continuous animation)
uniform float uTime;

// The current "virtual" scroll position of the camera (Z-axis).
uniform float uScroll;

// The specific Z-coordinate where THIS artwork is meant to be viewed.
// When uScroll == uSweetSpot, the image is perfect.
uniform float uSweetSpot;

// Controls the intensity of the chaos/explosion effect.
// 0.0 = Locked in place (boring).
// 1.0 = Standard drift.
// 5.0 = Massive explosion.
uniform float uChaosLevel;

// --- ATTRIBUTES ---
// These are passed per-instance (per particle).

// The "Perfect" position of the stroke in 3D space relative to the artwork center.
// x, y = 2D position on the canvas.
// z = Depth layer (calculated by MiDaS).
attribute vec3 aOffset;

// Random seed values for this particle.
// x = Random offset phase for drift.
// y = Random rotation axis selection.
// z = Random speed multiplier.
attribute vec3 aRandom;

// The color of the stroke (R, G, B, A).
attribute vec4 aColor;

// The scale factor for this specific stroke.
// This compensates for perspective projection so that strokes further back
// appear the correct size when viewed from the sweet spot.
attribute float aScale;

// --- VARYINGS ---
// Passed to the fragment shader.
varying vec4 vColor;
varying vec2 vUv;

// --- HELPER FUNCTIONS ---

/**
 * Pseudo-random number generator.
 * Returns a float between 0.0 and 1.0 based on a 2D vector seed.
 */
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

/**
 * Rotates a vector around an arbitrary axis.
 * Used to tumble the strokes when they are in the "chaotic" state.
 *
 * @param v - The vector to rotate (the vertex position).
 * @param axis - The axis to rotate around.
 * @param angle - The angle of rotation in radians.
 */
vec3 rotate(vec3 v, vec3 axis, float angle) {
    return mix(dot(axis, v) * axis, v, cos(angle)) + cross(axis, v) * sin(angle);
}

void main() {
    // Pass UVs and Color to the fragment shader
    vUv = uv;
    vColor = aColor;

    // --- 1. CALCULATE ALIGNMENT (THE SWEET SPOT) ---

    // Calculate the distance between the current camera position and the sweet spot.
    float dist = abs(uScroll - uSweetSpot);

    // Define the "Focus Window".
    // Within +/- 50 units of the sweet spot, the image begins to form.
    float focusWindow = 50.0;
    
    // Calculate 'progress' (normalized chaos factor).
    // 0.0 = Perfectly Aligned (Camera is at Sweet Spot).
    // 1.0 = Fully Chaotic (Camera is far away).
    // smoothstep creates a smooth transition curve.
    float progress = smoothstep(0.0, focusWindow, dist);
    
    // --- 2. CALCULATE CHAOS VECTORS ---

    // We create a procedural drift vector based on time and random attributes.
    // This gives the "floating in space" feeling.
    vec3 chaosOffset = vec3(
        sin(uTime * aRandom.z + aOffset.y) * 20.0, // Wavy drift on X
        cos(uTime * aRandom.z + aOffset.x) * 20.0, // Wavy drift on Y
        sin(uTime * 0.5 + aRandom.x) * 50.0        // Deep breathing drift on Z
    );
    
    // --- 3. APPLY TUMBLE ROTATION ---

    // Determine a random rotation axis for this particle.
    vec3 axis = normalize(aRandom.xyz);

    // Determine the rotation angle.
    // It rotates slowly over time, but spins faster as 'progress' increases.
    float angle = uTime * aRandom.z + (progress * 10.0);
    
    // Start with the basic vertex position (the corners of the quad).
    vec3 pos = position;
    
    // Apply Scale.
    // This is critical. The scale ensures that even though strokes are at different Z-depths,
    // they fit together like a puzzle when projected onto the screen.
    pos *= aScale;
    
    // Apply Rotation.
    // We linearly mix between the "Ordered" state (pos) and the "Tumbled" state (rotated).
    // When progress is 0, mix is 0 (No rotation, perfect alignment).
    vec3 tumbled = rotate(pos, axis, angle * progress);
    pos = mix(pos, tumbled, progress);
    
    // --- 4. APPLY TRANSLATION ---

    // The final position in world space is:
    // Original Position + (Chaos Vector * Chaos Strength * Global Chaos Level)
    vec3 finalPos = aOffset + (chaosOffset * progress * uChaosLevel);
    
    // --- 5. PROJECTION ---

    // Standard MVP matrix multiplication.
    // Note: 'modelMatrix' here is the InstancedMesh matrix.
    vec4 worldPosition = modelMatrix * vec4(finalPos, 1.0);
    vec4 viewPosition = viewMatrix * worldPosition;
    gl_Position = projectionMatrix * viewPosition;
}
