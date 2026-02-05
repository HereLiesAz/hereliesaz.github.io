// src/shaders/anamorphic.vert
uniform float uTime;
uniform float uScroll;      // Current Camera Z
uniform float uSweetSpot;   // The Z-depth where this painting aligns
uniform float uChaosLevel;  // 0.0 = Order, 1.0 = Max Entropy

attribute vec3 aOffset;     // The "Perfect" position (from Grinder)
attribute vec3 aRandom;     // x=random offset, y=random rotation axis, z=speed
attribute vec4 aColor;      // Stroke color
attribute float aScale;     // The depth-compensated scale factor

varying vec4 vColor;
varying vec2 vUv;

// Simple pseudo-random noise
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

// Rotate vector around axis
vec3 rotate(vec3 v, vec3 axis, float angle) {
    return mix(dot(axis, v) * axis, v, cos(angle)) + cross(axis, v) * sin(angle);
}

void main() {
    vUv = uv;
    vColor = aColor;

    // 1. Calculate "Alignment Strength"
    // How close is the camera to the sweet spot?
    // We define a "Focus Window" of +/- 50 units.
    float dist = abs(uScroll - uSweetSpot);
    float focusWindow = 50.0;
    
    // progress: 0.0 (Aligned) -> 1.0 (Chaotic)
    float progress = smoothstep(0.0, focusWindow, dist);
    
    // 2. The Chaos Function
    // As we move away, we add noise to the position
    vec3 chaosOffset = vec3(
        sin(uTime * aRandom.z + aOffset.y) * 20.0, // Wavy drift X
        cos(uTime * aRandom.z + aOffset.x) * 20.0, // Wavy drift Y
        sin(uTime * 0.5 + aRandom.x) * 50.0        // Deep drift Z
    );
    
    // 3. The Tumble
    // Strokes rotate randomly when not aligned
    vec3 axis = normalize(aRandom.xyz);
    float angle = uTime * aRandom.z + (progress * 10.0);
    
    // 4. Composition
    // Start with the model vertex (the quad)
    vec3 pos = position;
    
    // Apply Scale (Critical for Inverse Projection)
    pos *= aScale;
    
    // Apply Tumble (Only when chaotic)
    // We mix the rotation: 0 rot when aligned, full rot when chaotic
    vec3 tumbled = rotate(pos, axis, angle * progress);
    pos = mix(pos, tumbled, progress);
    
    // Apply Translation
    // Target Position + Chaos * Progress
    vec3 finalPos = aOffset + (chaosOffset * progress * uChaosLevel);
    
    // 5. Final Projection
    // We manually handle the Z-positioning relative to scroll
    // The "World" moves, the Camera stays (or vice versa, handled by ViewMatrix)
    vec4 worldPosition = modelMatrix * vec4(finalPos, 1.0);
    vec4 viewPosition = viewMatrix * worldPosition;
    gl_Position = projectionMatrix * viewPosition;
}
