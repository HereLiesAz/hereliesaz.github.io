import * as THREE from 'three';

export const AnamorphicShader = {
  uniforms: {
    uTime: { value: 0 },
    uScroll: { value: 0 }, // The driver of the universe
    uChaos: { value: 0 }, // 0 = Ordered, 1 = Liquid/Exploded
    uTexture: { value: null }, // Optional: Global grit texture
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uFocusPlane: { value: 0.5 }, // Depth of field focus
  },

  vertexShader: `
    attribute vec3 aColor;      // Stroke color from JSON
    attribute vec4 aBounds;     // [x, y, width, height] in UV space (0-1)
    attribute float aDepth;     // Z-depth from ZoeDepth
    attribute float aRotation;  // Stroke orientation
    attribute float aStability; // SAM stability score (used for "glitch" resistance)

    varying vec3 vColor;
    varying vec2 vUv;
    varying float vDepth;

    uniform float uTime;
    uniform float uChaos;
    uniform float uScroll;

    // Pseudo-random function for organic noise
    float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    void main() {
      vUv = uv;
      vColor = aColor;
      vDepth = aDepth;

      // 1. BASE POSITION (The "Perfect" View)
      // Convert 0-1 UV bounds to Centered World Space
      // Assumes a viewing plane at Z=0 for the "perfect" shot
      vec2 center = aBounds.xy + aBounds.zw * 0.5;
      vec2 pos2D = (center - 0.5) * 20.0; // Scale world units (adjust to taste)
      
      // Anamorphic Projection Logic:
      // Objects further back (high aDepth) need to be LARGER to look correct in perspective
      float perspectiveFactor = 1.0 + (aDepth * 5.0); // Depth scale
      
      vec3 finalPos = vec3(pos2D.x * perspectiveFactor, pos2D.y * perspectiveFactor, -aDepth * 10.0);

      // 2. CHAOS / TRANSITION DYNAMICS
      // When uChaos is high, strokes drift apart based on their stability and depth
      float noise = random(vec2(float(gl_InstanceID), aDepth));
      
      // Turbulence: Strokes float like dust in a fluid
      float driftX = sin(uTime * 0.5 + aDepth * 10.0) * uChaos * 5.0;
      float driftY = cos(uTime * 0.3 + noise * 10.0) * uChaos * 5.0;
      float driftZ = sin(uTime * 0.2 + aDepth) * uChaos * 15.0;

      finalPos += vec3(driftX, driftY, driftZ);

      // 3. INSTANCE TRANSFORM (The Quad itself)
      // Scale the quad to match the stroke size
      float w = aBounds.z * 20.0 * perspectiveFactor;
      float h = aBounds.w * 20.0 * perspectiveFactor;

      // Apply rotation (if we had it, standard 0 for now)
      vec3 transformed = position;
      transformed.x *= w;
      transformed.y *= h;

      // Move vertex to position
      transformed += finalPos;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    }
  `,

  fragmentShader: `
    varying vec3 vColor;
    varying vec2 vUv;
    varying float vDepth;

    uniform float uChaos;

    void main() {
      // 1. PROCEDURAL BRUSH STROKE
      // Create a soft edge and a "bristly" center
      vec2 uv = vUv * 2.0 - 1.0;
      float dist = length(uv);
      
      // Soft circle shape for the stroke tip
      float alpha = 1.0 - smoothstep(0.5, 1.0, dist);

      // Add "Bristle" noise
      // We use the UV coordinates to create streaks
      float bristles = sin(uv.x * 20.0 + uv.y * 10.0) * 0.1;
      alpha -= bristles;

      // 2. EDGE FADE
      // If alpha is too low, discard (optimization)
      if (alpha < 0.1) discard;

      // 3. COLOR DYNAMICS
      // Darken strokes slightly based on depth for volumetric shadowing
      vec3 finalColor = vColor * (1.0 - vDepth * 0.3);

      gl_FragColor = vec4(finalColor, alpha);
    }
  `
};
