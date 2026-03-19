import { shaderMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { extend } from '@react-three/fiber';

const ShardMaterial = shaderMaterial(
  {
    uColor: new THREE.Color(1, 1, 1),
    uTexture: null,
  },
  // Vertex Shader
  `
    attribute vec3 aOffset; 
    attribute vec2 aScale;
    attribute vec3 aColor;
    attribute vec3 aRandom;
    attribute float aIndex;
    attribute vec2 aUvOffset;
    attribute vec2 aUvScale;

    varying vec2 vUv;
    varying vec2 vLocalUv;
    varying vec3 vRandom;
    varying vec3 vColor;
    varying float vIndex;

    void main() {
        vUv = aUvOffset + (uv * aUvScale);
        vLocalUv = uv; 
        vRandom = aRandom;
        vColor = aColor;
        vIndex = aIndex;
        
        vec3 pos = position;
        pos.xy *= aScale;
        vec3 finalPos = aOffset + pos;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
    }
  `,
  // Fragment Shader
  `
    uniform vec3 uColor;
    uniform sampler2D uTexture;
    uniform float uAnchorId;
    uniform float uAnchorGlow;

    varying vec2 vUv;
    varying vec2 vLocalUv;
    varying vec3 vRandom;
    varying vec3 vColor;
    varying float vIndex;

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
        // --- LIQUID CLIPPING ---
        float dist = length(vLocalUv - 0.5) * 2.0; 
        float noise = hash(vLocalUv * 5.0 + vRandom.xy * 10.0);
        float mask = smoothstep(0.8, 0.4, dist + noise * 0.3);
        
        if (mask < 0.1) discard;

        vec4 texColor = texture2D(uTexture, vUv);
        
        // --- ANCHOR HIGHLIGHT ---
        float glow = 0.0;
        if (abs(vIndex - uAnchorId) < 0.5) {
            glow = uAnchorGlow;
        }

        // Combine instance color with texture and global tint
        vec3 coreColor = texColor.rgb * vColor * uColor;
        vec3 finalColor = coreColor + (vec3(1.0, 0.9, 0.8) * glow);
        
        gl_FragColor = vec4(finalColor, texColor.a * mask);
    }
  `
);

extend({ ShardMaterial });

export default ShardMaterial;
