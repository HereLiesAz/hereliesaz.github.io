import { shaderMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { extend } from '@react-three/fiber';

const ShardMaterial = shaderMaterial(
  {
    uTime: 0,
    uColor: new THREE.Color(1, 1, 1),
    uTexture: null,
    uProgress: 0, // 0 = Order, 1 = Chaos
    uThreshold: 0.0, // 0 = Visible, 1 = Dissolved
  },
  // Vertex Shader
  `
    attribute vec3 aOffset; 
    attribute vec2 aScale;
    attribute vec3 aRandom; 
    attribute vec2 aUvOffset;
    attribute vec2 aUvScale;

    varying vec2 vUv;
    varying float vChaos;

    uniform float uTime;
    uniform float uProgress; 

    void main() {
        vUv = aUvOffset + (uv * aUvScale);
        
        // 1. Scale the quad to its original shard aspect ratio
        vec3 pos = position;
        pos.xy *= aScale;

        // 2. Calculate Chaos
        // uProgress: 0.0 (Aligned) -> 1.0 (Exploded)
        vec3 chaosDir = normalize(aRandom - 0.5);
        float explosionStrength = uProgress * 30.0;
        
        // Add some noise to the movement
        vec3 drift = vec3(
            sin(uTime * 0.5 + aRandom.x * 10.0),
            cos(uTime * 0.3 + aRandom.y * 10.0),
            sin(uTime * 0.2 + aRandom.z * 10.0)
        ) * uProgress * 5.0;

        // 3. Tumble Rotation
        float angle = uProgress * (aRandom.x * 6.28 + uTime * 0.2);
        float s = sin(angle);
        float c = cos(angle);
        mat2 rot = mat2(c, -s, s, c);
        pos.xy = rot * pos.xy;

        // 4. Combine
        vec3 finalPos = aOffset + pos + (chaosDir * explosionStrength) + drift;
        
        vChaos = uProgress;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
    }
  `,
  // Fragment Shader
  `
    uniform vec3 uColor;
    uniform sampler2D uTexture;
    uniform float uThreshold;
    uniform float uTime;

    varying vec2 vUv;
    varying float vChaos;

    // Simple Noise for dissolve
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
        vec4 texColor = texture2D(uTexture, vUv);
        
        // Noise-Discard Transition
        float n = hash(vUv * 10.0 + floor(uTime * 10.0) * 0.01);
        
        if (n < uThreshold) {
            discard;
        }

        // Edge "Burning" effect during dissolve
        vec3 color = texColor.rgb * uColor;
        if (uThreshold > 0.1 && n < uThreshold + 0.05) {
            color += vec3(0.8, 0.4, 0.1) * (1.0 - (n - uThreshold) / 0.05);
        }

        gl_FragColor = vec4(color, texColor.a);
    }
  `
);

extend({ ShardMaterial });

export default ShardMaterial;
