import { shaderMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { extend } from '@react-three/fiber';

const ShardMaterial = shaderMaterial(
  // Uniforms
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
    attribute vec3  aOffset;      
    attribute vec2  aScale;       
    attribute vec3  aColor;
    attribute vec3  aRandom;      
    attribute float aSweetSpotZ;  
    attribute vec2  aUvOffset;
    attribute vec2  aUvScale;

    uniform float uCameraZ;
    uniform float uTime;
    uniform float uFocusWindow;

    varying vec2  vUv;
    varying vec2  vLocalUv;
    varying vec3  vColor;
    varying float vAlpha;
    varying float vSharpness;

    void main() {
      vUv      = aUvOffset + (uv * aUvScale);
      vLocalUv = uv;
      vColor   = aColor;

      float dist     = abs(uCameraZ - aSweetSpotZ);
      float progress = smoothstep(0.0, uFocusWindow, dist);
      
      // Higher sharpness when close to sweet spot
      vSharpness = 1.0 - smoothstep(0.0, uFocusWindow * 0.1, dist);

      // 1. Base Scale & Growth
      // Grow slightly when near sweet spot to ensure no gaps (coalescence)
      float growth = mix(1.25, 1.0, progress);
      vec3 pos = position;
      pos.xy *= aScale * growth;

      // 2. Static Random Rotation (The 'Shard' look)
      float rot = aRandom.x * 6.28318;
      mat2 rotMat = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
      pos.xy = rotMat * pos.xy;

      // 4. Tumble (Only when chaotic)
      vec3  axis  = normalize(aRandom * 2.0 - 1.0);
      float tumbleAngle = uTime * (0.5 + aRandom.z) + progress * 8.0;
      vec3 tumbled = mix(dot(axis, pos) * axis, pos, cos(tumbleAngle))
                   + cross(axis, pos) * sin(tumbleAngle);
      pos = mix(pos, tumbled, progress);

      // 5. World-space chaos drift
      vec3 chaosOffset = vec3(
        sin(uTime * aRandom.z + aOffset.y) * 20.0,
        cos(uTime * aRandom.z + aOffset.x) * 20.0,
        sin(uTime * 0.3       + aRandom.x) * 40.0
      );

      vec3 finalPos = aOffset + pos + (chaosOffset * progress);

      vAlpha = 1.0 - smoothstep(0.0, uFocusWindow * 0.5, dist) * 0.5;

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
    varying float vSharpness;

    void main() {
      // Liquid Shard Mask: Elongated soft ellipsoid
      vec2 centerDelta = vLocalUv - 0.5;
      // Intrinsic aspect ratio of the shard (roughly) + stretching
      float d = length(centerDelta * vec2(1.0, 2.0)) * 2.5;
      
      // Transitions from a soft splat to a sharp stroke at sweet spot
      float mask = smoothstep(1.0, 0.4 - (vSharpness * 0.3), d);

      vec3 color = vColor;
      if (uHasTexture > 0.5) {
        vec4 tex = texture2D(uTexture, vUv);
        if (tex.a > 0.1) color = tex.rgb;
      }

      float alpha = mask * vAlpha;
      if (alpha < 0.02) discard;

      // Pulse color slightly at sweet spot
      vec3 finalColor = mix(color, color * 1.1, vSharpness);

      gl_FragColor = vec4(finalColor, alpha);
    }
  `
);

extend({ ShardMaterial });
export default ShardMaterial;