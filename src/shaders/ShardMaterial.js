import { shaderMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { extend } from '@react-three/fiber';

const ShardMaterial = shaderMaterial(
  // Uniforms
  {
    uCameraZ:     0.0,
    uTime:        0.0,
    uFocusWindow: 60.0,
    uTexture:     null,
    uHasTexture:  0.0,
  },

  // ---- Vertex Shader ----
  /* glsl */`
    attribute vec3  aOffset;      // world-space (baked + sweetSpotZ applied by CPU)
    attribute vec2  aScale;       // (sx, sy) in world units
    attribute vec3  aColor;
    attribute vec3  aRandom;      // deterministic per-shard entropy [0,1)
    attribute float aSweetSpotZ;  // world Z of this shard's painting sweet spot
    attribute vec2  aUvOffset;
    attribute vec2  aUvScale;

    uniform float uCameraZ;
    uniform float uTime;
    uniform float uFocusWindow;

    varying vec2  vUv;
    varying vec2  vLocalUv;
    varying vec3  vColor;
    varying float vAlpha;

    void main() {
      vUv      = aUvOffset + (uv * aUvScale);
      vLocalUv = uv;
      vColor   = aColor;

      float dist     = abs(uCameraZ - aSweetSpotZ);
      float progress = smoothstep(0.0, uFocusWindow, dist);

      // 1. Scale BEFORE rotation so aspect ratio is preserved in tumble
      vec3 pos = position;
      pos.xy *= aScale;

      // 2. Tumble: rotate the scaled quad when chaotic
      // Remap aRandom [0,1] → [-1,1] so axis covers the full sphere
      vec3  axis  = normalize(aRandom * 2.0 - 1.0);
      float angle = uTime * aRandom.z + progress * 8.0;
      vec3 tumbled = mix(dot(axis, pos) * axis, pos, cos(angle))
                   + cross(axis, pos) * sin(angle);
      pos = mix(pos, tumbled, progress);

      // 3. World-space chaos drift
      vec3 chaosOffset = vec3(
        sin(uTime * aRandom.z + aOffset.y) * 25.0,
        cos(uTime * aRandom.z + aOffset.x) * 25.0,
        sin(uTime * 0.3       + aRandom.x) * 60.0
      );

      vec3 finalPos = aOffset + pos + (chaosOffset * progress);

      vAlpha = 1.0 - smoothstep(0.0, uFocusWindow * 0.3, dist) * 0.4;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
    }
  `,

  // ---- Fragment Shader ----
  /* glsl */`
    uniform sampler2D uTexture;
    uniform float     uHasTexture;

    varying vec2  vUv;
    varying vec2  vLocalUv;
    varying vec3  vColor;
    varying float vAlpha;

    void main() {
      // Soft circular mask on the unit quad
      float d    = length(vLocalUv - 0.5) * 2.0;
      float mask = smoothstep(1.0, 0.4, d);

      vec3 color = vColor;
      if (uHasTexture > 0.5) {
        vec4 tex = texture2D(uTexture, vUv);
        if (tex.a > 0.1) color = tex.rgb;
      }

      float alpha = mask * vAlpha;
      if (alpha < 0.05) discard;

      gl_FragColor = vec4(color, alpha);
    }
  `
);

extend({ ShardMaterial });
export default ShardMaterial;