/**
 * ANAMORPHIC SHADER
 * =================
 * The GLSL heart of the visual effect.
 *
 * This shader handles the "Explosion" and "Reassembly" of the strokes.
 *
 * Concept:
 * - Every stroke has a "Perfect Position" where it forms the image.
 * - We modify this position in the Vertex Shader based on `uChaos`.
 * - Chaos is driven by the camera's distance from the "Sweet Spot".
 */

import * as THREE from 'three';

export const AnamorphicShader = {
  // --- UNIFORMS ---
  // Global variables passed from the CPU to the GPU.
  uniforms: {
    uTime: { value: 0 },    // Elapsed time (for noise animation)
    uChaos: { value: 0 },   // 0.0 = Assembled, 1.0 = Exploded
    uTexture: { value: null } // Optional brush texture (unused in current flat color mode)
  },

  // --- VERTEX SHADER ---
  // Runs once per vertex (4 verts per stroke).
  // Calculates where the pixel should appear on screen.
  vertexShader: `
    precision highp float;

    // Attributes provided by InstancedBufferGeometry
    attribute vec3 aColor;      // RGB Color of the stroke
    attribute vec4 aBounds;     // [x, y, w, h] - Normalized bounding box
    attribute float aDepth;     // Z-depth (0.0 to 1.0)
    attribute float aStability; // Stability score (0.0 to 1.0)

    // Varyings passed to Fragment Shader
    varying vec3 vColor;
    varying float vDepth;
    varying vec2 vUv;

    // Uniforms
    uniform float uTime;
    uniform float uChaos;

    // Pseudo-random number generator
    // Returns a float between 0.0 and 1.0 based on a 2D vector seed.
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    void main() {
      // Pass attributes to fragment shader
      vColor = aColor;
      vDepth = aDepth;
      vUv = uv;

      // 1. Calculate the Center of the stroke in UV space
      vec2 center = vec2(aBounds.x + aBounds.z * 0.5, aBounds.y + aBounds.w * 0.5);

      // 2. Calculate the Size of the stroke
      vec2 size = vec2(aBounds.z, aBounds.w);

      // 3. Map the base quad vertices (position) to the stroke's location
      vec3 pos = position;
      // Scale the quad to match the stroke width/height
      pos.x = (pos.x * size.x) + (center.x - 0.5);
      pos.y = (pos.y * size.y) + (center.y - 0.5);
      // Apply depth offset
      pos.z += aDepth * 0.5;

      // --- CHAOS MATH ---

      // Calculate a random seed for this stroke
      float rnd = random(center * 100.0);

      // Calculate a noise wave
      float noise = sin(uTime * 2.0 + rnd * 10.0) * uChaos;
      
      // Displace X/Y based on Chaos
      // The more chaotic, the further it flies from its center.
      pos.x += (rnd - 0.5) * uChaos * 2.0;
      pos.y += (random(center * 200.0) - 0.5) * uChaos * 2.0;

      // Apply "Jitter" based on stability.
      // Unstable strokes (low stability) vibrate more.
      pos.x += noise * 0.05 * (1.0 - aStability);
      
      // Transform final position to Screen Space
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,

  // --- FRAGMENT SHADER ---
  // Runs once per pixel.
  // Determines the color of the pixel.
  fragmentShader: `
    precision highp float;

    // Inputs from Vertex Shader
    varying vec3 vColor;

    // Uniforms
    uniform float uChaos;

    void main() {
      vec3 finalColor = vColor;

      // Desaturation Effect during Chaos
      // As the image explodes, it turns black & white.
      // Standard luminance formula: 0.299R + 0.587G + 0.114B
      float luminance = dot(finalColor, vec3(0.299, 0.587, 0.114));

      // Mix between Color (at chaos 0) and B&W (at chaos 1)
      finalColor = mix(finalColor, vec3(luminance), uChaos);

      // Output RGBA
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `
};
