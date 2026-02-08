import { shaderMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { extend } from '@react-three/fiber';

const ShardMaterial = shaderMaterial(
  {
    uTime: 0,
    uColor: new THREE.Color(1, 1, 1),
    uTexture: null, // Texture Array or Atlas
    uNoiseMap: null, // Perlin noise for dissolve
    uProgress: 0, // 0 = Aligned (Order), 1 = Exploded (Chaos)
    uResolution: new THREE.Vector2(1, 1),
    uThreshold: 0.0, // Dissolve threshold (0 = fully visible, 1 = fully dissolved)
  },
  // Vertex Shader
  `
    attribute float aScale;
    attribute vec3 aRandom; // Random seed per instance (x, y, z)
    attribute float aDepth; // The "correct" Z depth for alignment

    varying vec2 vUv;
    varying float vAlpha;

    uniform float uTime;
    uniform float uProgress; // 0.0 to 1.0 (Order to Chaos)

    // Pseudo-random function
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    // 3D Noise function (Simplex or similar)
    // Simplified for performance
    vec3 noise3(vec3 p) {
        return vec3(
            sin(p.x * 10.0 + uTime),
            cos(p.y * 10.0 + uTime),
            sin(p.z * 10.0 + uTime)
        );
    }

    void main() {
        vUv = uv;

        // Base position (The "Shard" geometry itself, likely a quad)
        vec3 pos = position * aScale;

        // Instance position (The "Aligned" position in the painting)
        // In InstancedMesh, this is usually handled by the instanceMatrix.
        // But here we might want manual control if we are not using standard instanceMatrix for everything.
        // Assuming standard InstancedMesh, 'instanceMatrix' transforms 'pos' to world space.
        
        // However, we want to displace the instance *from* its origin.
        // We can add the displacement *before* or *after* the instance matrix.
        // Usually, 'instanceMatrix' places the shard at its final (x,y,z) in the painting.
        // We want to add chaos to that.

        // Retrieve instance position from the matrix (column 3)
        vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        
        // Calculate Chaos Vector
        // We want shards to fly *outwards* or *drift* based on uProgress.
        // Direction is based on aRandom.
        vec3 chaosDir = normalize(aRandom - 0.5); 
        float chaosDist = uProgress * 50.0; // Explosion radius

        // Apply displacement
        // We modify the *local* position relative to the instance center, 
        // OR we modify the instance position itself.
        // Modifying the instance position:
        vec3 finalPos = pos + instancePos + (chaosDir * chaosDist);
        
        // Also add some rotation/tumble based on progress
        // (Simplified: handled by standard matrix if updated on CPU, or here if GPU only)
        
        // Project to clip space
        // Note: We bypass modelMatrix because instanceMatrix handles the transform?
        // Actually, standard material uses: projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0)
        // We need to manually construct the transformation.

        // Let's use the standard approach for InstancedMesh with custom chunks or raw shader.
        // For simplicity in a custom shaderMaterial, we assume usage with <instancedMesh> which binds instanceMatrix automatically.
        
        // But shaderMaterial in R3F usually replaces the *entire* material.
        // So we must handle instancing manually if we don't extend StandardMaterial.
        
        // Simplest approach: Apply displacement to the 'position' attribute, 
        // but since we are instanced, we rely on the host mesh to provide instanceMatrix.
        // Three.js ShaderMaterial handles instancing if 'instancing: true' is passed? 
        // No, we need to add the instance transform code manually or use 'onBeforeCompile'.

        // FORCE MANUAL INSTANCING LOGIC:
        #ifdef USE_INSTANCING
            mat4 localInstanceMatrix = instanceMatrix;
            
            // Add Chaos to the matrix translation
            localInstanceMatrix[3][0] += chaosDir.x * chaosDist;
            localInstanceMatrix[3][1] += chaosDir.y * chaosDist;
            localInstanceMatrix[3][2] += chaosDir.z * chaosDist;

            vec4 worldPosition = modelMatrix * localInstanceMatrix * vec4(pos, 1.0);
        #else
            vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        #endif

        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        
        // Pass alpha/progress to fragment
        vAlpha = 1.0 - uThreshold; 
    }
  `,
  // Fragment Shader
  `
    uniform vec3 uColor;
    uniform sampler2D uTexture; // Assuming single texture for now, or atlas
    uniform sampler2D uNoiseMap;
    uniform float uThreshold;

    varying vec2 vUv;
    varying float vAlpha;

    void main() {
        // Sample texture
        vec4 texColor = texture2D(uTexture, vUv);
        
        // Sample noise for dissolve
        // We map noise to screen space or UV space?
        // UV space of the shard is better for "burning" effect.
        float noise = texture2D(uNoiseMap, vUv).r;

        // Dissolve Logic
        // If noise value is less than threshold, discard pixel
        // We add a small edge/burn line
        float edge = 0.05;
        if (noise < uThreshold - edge) {
            discard;
        }

        // Apply color tint
        gl_FragColor = vec4(texColor.rgb * uColor, texColor.a);
        
        // Burn edge color (orange/fire)
        if (noise < uThreshold) {
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.5, 0.0), 0.5);
        }
    }
  `
);

extend({ ShardMaterial });

export default ShardMaterial;
