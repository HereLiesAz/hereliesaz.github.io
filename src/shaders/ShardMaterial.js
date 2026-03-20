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
  attribute vec3 aRandom;

  void main() {
    vLocalUv = uv;
    // Map local plane UV to the part of the painting texture it represents
    vUv = aUvOffsetScale.xy + uv * aUvOffsetScale.zw;
    vRandom = aRandom.x;
    
    // 1. Initial Position (Instance Mesh handles scaling/translation)
    vec4 instancePos = instanceMatrix * vec4(position, 1.0);
    
    // 2. Vertex Displacement (The 3D Scene)
    // We use a noise-like displacement in the vertex shader to give strips volume.
    // In a future pass, this will use the luminance of uTexture or a depth map.
    float displacement = (aRandom.y - 0.5) * 0.4;
    instancePos.z += displacement;

    // 3. Atmosphere (Progress towards sweet spot)
    // Distance from camera to this specific instance's Z
    float dist = abs(uCameraZ - instancePos.z);
    // Progress 0.0 at sweet spot, increasing as we move away
    vProgress = clamp(dist / 15.0, 0.0, 1.0);

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

  // Simple noise for torn edges
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    // 1. Texture Sample
    vec4 texColor = texture2D(uTexture, vUv);
    
    // 2. Torn Edge Mask (Haphazard shape)
    vec2 centerDelta = vLocalUv - 0.5;
    float distFromCenter = length(centerDelta);
    
    // Noisy threshold for 'ripped canvas' edge
    float noise = hash(vLocalUv * 10.0 + vRandom);
    float alphaMask = smoothstep(0.48 + noise * 0.05, 0.45, distFromCenter);
    
    if (alphaMask < 0.1) discard;

    // 3. Dark Closet Atmosphere (How little light does it take?)
    // Far away = near black. Sweet spot = full color.
    float brightness = smoothstep(1.0, 0.2, vProgress);
    
    // Subliminal highlights (specular sheen on 'thick paint')
    float highlight = pow(clamp(1.0 - distFromCenter * 2.0, 0.0, 1.0), 8.0) * 0.3 * (1.0 - vProgress);
    
    vec3 finalColor = texColor.rgb * brightness + highlight;
    
    gl_FragColor = vec4(finalColor, texColor.a * brightness);
  }
  `
);

extend({ ShardMaterial });
export default ShardMaterial;