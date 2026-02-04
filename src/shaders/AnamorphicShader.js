import * as THREE from 'three';

export const AnamorphicShader = {
  uniforms: {
    uTime: { value: 0 },
    uChaos: { value: 0 },
    uTexture: { value: null }
  },
  vertexShader: `
    precision highp float;
    attribute vec3 aColor;
    attribute vec4 aBounds;
    attribute float aDepth;
    attribute float aStability;
    varying vec3 vColor;
    varying float vDepth;
    varying vec2 vUv;
    uniform float uTime;
    uniform float uChaos;

    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    void main() {
      vColor = aColor;
      vDepth = aDepth;
      vUv = uv;

      vec2 center = vec2(aBounds.x + aBounds.z * 0.5, aBounds.y + aBounds.w * 0.5);
      vec2 size = vec2(aBounds.z, aBounds.w);

      vec3 pos = position;
      pos.x = (pos.x * size.x) + (center.x - 0.5);
      pos.y = (pos.y * size.y) + (center.y - 0.5);
      pos.z += aDepth * 0.5;

      // Entropy
      float rnd = random(center * 100.0);
      float noise = sin(uTime * 2.0 + rnd * 10.0) * uChaos;
      
      pos.x += (rnd - 0.5) * uChaos * 2.0;
      pos.y += (random(center * 200.0) - 0.5) * uChaos * 2.0;
      pos.x += noise * 0.05 * (1.0 - aStability);
      
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec3 vColor;
    uniform float uChaos;

    void main() {
      vec3 finalColor = vColor;
      float luminance = dot(finalColor, vec3(0.299, 0.587, 0.114));
      finalColor = mix(finalColor, vec3(luminance), uChaos);
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `
};
