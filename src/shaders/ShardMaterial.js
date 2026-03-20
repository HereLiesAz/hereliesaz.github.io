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

  void main() {
    vLocalUv = uv;
    vUv = aUvOffsetScale.xy + uv * aUvOffsetScale.zw;
    vRandom = aRandom.x;
    
    // 1. Initial Position
    vec4 instancePos = instanceMatrix * vec4(position, 1.0);
    
    // 2. Vertex Displacement (The 3D Scene)
    // Sample texture in vertex shader for physical height
    vec4 tex = texture2D(uTexture, vUv);
    float luminance = (tex.r + tex.g + tex.b) / 3.0;
    
    // Displacement correlates with brightness ('thick paint' highlights)
    // We also use aZVar to scale the intensity of the 'relief'
    float spread = (luminance - 0.5) * uDisplacementScale * (0.5 + aZVar * 2.0);
    instancePos.z += spread;

    // 3. Atmosphere
    float dist = abs(uCameraZ - instancePos.z);
    // Darker as we move away from the specific 'sweet spot' focal range
    vProgress = clamp(dist / 12.0, 0.0, 1.0);

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

  // More organic noise for torn edges
  float noise(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    // 1. Texture Sample
    vec4 texColor = texture2D(uTexture, vUv);
    
    // 2. Torn Edge Mask (Haphazard shape)
    vec2 centerDelta = vLocalUv - 0.5;
    float distFromCenter = length(centerDelta);
    
    // Organic 'ripped' edge using multiple octaves of simple noise
    float n = noise(vLocalUv * 15.0 + vRandom);
    n += noise(vLocalUv * 30.0 - vRandom) * 0.5;
    
    float threshold = 0.46 + n * 0.06;
    float alphaMask = smoothstep(threshold, threshold - 0.05, distFromCenter);
    
    if (alphaMask < 0.1) discard;

    // 3. Dark Closet Atmosphere
    // Subliminal highlights to suggest volume
    float brightness = smoothstep(1.0, 0.1, vProgress);
    
    // Mock specular on 'paint' surface
    float spec = pow(max(0.0, 1.0 - distFromCenter * 2.5), 12.0) * 0.4 * (1.0 - vProgress);
    
    vec3 finalColor = texColor.rgb * brightness + spec;
    
    gl_FragColor = vec4(finalColor, texColor.a * alphaMask * brightness);
  }
  `
);

extend({ ShardMaterial });
export default ShardMaterial;