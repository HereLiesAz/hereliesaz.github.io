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
    attribute vec2 aUvOffset;
    attribute vec2 aUvScale;

    varying vec2 vUv;

    void main() {
        vUv = aUvOffset + (uv * aUvScale);
        
        // 1. Scale the quad to its shard dimensions
        vec3 pos = position;
        pos.xy *= aScale;

        // 2. Position is statically offset in 3D space
        vec3 finalPos = aOffset + pos;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
    }
  `,
  // Fragment Shader
  `
    uniform vec3 uColor;
    uniform sampler2D uTexture;

    varying vec2 vUv;

    void main() {
        vec4 texColor = texture2D(uTexture, vUv);
        
        // Purely static output
        vec3 color = texColor.rgb * uColor;
        gl_FragColor = vec4(color, texColor.a);
    }
  `
);

extend({ ShardMaterial });

export default ShardMaterial;
