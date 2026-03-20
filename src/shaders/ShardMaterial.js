import * as THREE from 'three';
import { extend } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';

/**
 * ShardMaterial - The aesthetic engine of the Infinite Canvas.
 * Supports:
 * 1. Texture-mapped feature slices.
 * 2. Vertex displacement for 3D weighting.
 * 3. Torn-edge "ripped canvas" masks.
 * 4. 'Dark Closet' atmosphere (emergence from shadow).
 */
const ShardMaterial = shaderMaterial(
  {
    uTexture: null,
    uSweetZ: 0,
    uCameraZ: 0,
    uFocalDist: 10.0,
    uTime: 0,
    uDisplacementScale: 0.8,
  },
  // Vertex Shader
  `
  varying vec2 vUv;
  varying vec2 vLocalUv;
  varying float vProgress;
  varying float vRandom;
  varying vec3 vWorldPos;
  
  attribute vec4 aUvOffsetScale;
  attribute float aZOffset;
  attribute float aZLocal;
  attribute float aZVar;
  attribute vec3 aRandom;

  uniform sampler2D uTexture;
  uniform float uTime;
  uniform float uDisplacementScale;
  uniform float uCameraZ;

  void main() {
    vLocalUv = uv;
    vUv = aUvOffsetScale.xy + uv * aUvOffsetScale.zw;
    vRandom = aRandom.x;
    
    // 1. Initial Position (Instance Matrix includes sweetZ + aZOffset)
    vec4 instancePos = instanceMatrix * vec4(position, 1.0);
    
    // 2. Structural Depth (aZLocal)
    instancePos.z += (aZLocal - 0.5) * 5.0;

    // 3. Liquidy Vertex Displacement (Organic Relief)
    vec4 tex = texture2D(uTexture, vUv);
    float luminance = (tex.r + tex.g + tex.b) / 3.0;
    
    // Smooth, organic displacement for the "thick paint" look
    float wave = sin(vLocalUv.x * 10.0 + uTime * 0.5 + aRandom.y * 6.28) * 0.05;
    float relief = (luminance - 0.5) * uDisplacementScale * (0.5 + aZVar * 5.0) + wave;
    instancePos.z += relief;

    // 4. Atmosphere
    float dist = abs(uCameraZ - instancePos.z);
    vProgress = clamp(dist / 30.0, 0.0, 1.0);

    vWorldPos = instancePos.xyz;
    gl_Position = projectionMatrix * viewMatrix * instancePos;
  }
  `,
  // Fragment Shader
  `
  varying vec2 vUv;
  varying vec2 vLocalUv;
  varying float vProgress;
  varying float vRandom;
  varying vec3 vWorldPos;

  uniform sampler2D uTexture;
  uniform float uTime;

  // Faster hash-based noise
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    
    // 2. Optimized Liquidy Mask
    vec2 edge = vLocalUv - 0.5;
    float distToCenter = length(edge * 2.1); // Slightly broader
    
    // Single-pass hash noise for wobbly edges
    float h = hash(vUv * 0.5 + uTime * 0.05);
    float wobble = h * 0.2;
    
    // Smoother organic transition
    float alphaMask = 1.0 - smoothstep(0.75 - wobble, 1.1 + wobble, distToCenter);
    
    if (alphaMask < 0.01) discard;

    // 3. Dark Closet Atmosphere (Bubble-up Fading)
    // We want a very soft arrival from the darkness
    float brightness = pow(1.0 - vProgress, 2.0);
    
    // Subtle wet paint specular
    float spec = pow(max(0.0, 1.0 - distToCenter), 4.0) * 0.3 * (1.0 - vProgress);
    
    vec3 finalColor = texColor.rgb * brightness + spec;
    gl_FragColor = vec4(finalColor, texColor.a * alphaMask * brightness);
  }
  `
);

extend({ ShardMaterial });
export default ShardMaterial;