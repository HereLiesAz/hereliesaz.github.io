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
    uSolutionViewpoint: new THREE.Matrix4(),
    uSolutionProjection: new THREE.Matrix4(),
    uFocalLength: 50.0,
  },
  // Vertex Shader
  `
    attribute vec3 aOffset; // Center of the shard
    attribute float aScale;
    attribute vec3 aRandom; // Random seed per instance (x, y, z)
    attribute float aDepth; // The "correct" Z depth for alignment
    attribute vec2 aUvOffset;
    attribute vec2 aUvScale;

    varying vec2 vUv;
    varying float vAlpha;

    uniform float uTime;
    uniform float uProgress; // 0.0 to 1.0 (Order to Chaos)
    uniform mat4 uSolutionViewpoint;
    uniform mat4 uSolutionProjection;
    uniform float uFocalLength;

    // Pseudo-random function
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    void main() {
        // Correct UV mapping
        vUv = aUvOffset + (uv * aUvScale);

        // --- 1. Compute Aligned Position (Order) ---
        // aOffset contains [x, y, z]. Z is the depth.
        vec3 alignedCenter = aOffset;
        
        // Optional: Apply Anamorphic Scale Compensation
        // Scale the shard based on depth so it maintains apparent size?
        // float dist = distance(cameraPosition, alignedCenter);
        // float perspectiveScale = dist / uFocalLength;
        // For now, simple uniform scale from attribute
        float finalScale = aScale;

        // Base quad position
        vec3 localPos = position * finalScale;

        // --- 2. Compute Chaos Position (Entropy) ---
        // Explode outwards based on random direction
        vec3 chaosDir = normalize(aRandom - 0.5);
        
        // Add some swirl/curl based on Time and Position
        vec3 curl = vec3(
            sin(uTime * 0.1 + alignedCenter.y),
            cos(uTime * 0.1 + alignedCenter.x),
            sin(uTime * 0.1 + alignedCenter.z)
        ) * 0.5;
        
        float explosionRadius = 20.0;
        vec3 chaosCenter = alignedCenter + (chaosDir + curl) * explosionRadius;

        // --- 3. Interpolate based on uProgress ---
        // uProgress: 0.0 (Order) -> 1.0 (Chaos)
        // Use a non-linear curve for more dramatic effect
        float t = smoothstep(0.0, 1.0, uProgress);
        
        vec3 finalCenter = mix(alignedCenter, chaosCenter, t);

        // Apply Tumble Rotation when in Chaos
        // Axis-Angle rotation logic could go here
        
        // Final World Position
        vec3 worldPos = finalCenter + localPos;
        
        // Project to Clip Space
        gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
        
        vAlpha = 1.0 - t; // Fade out alpha as it explodes
    }
  `,
  // Fragment Shader
  `
    uniform vec3 uColor;
    uniform sampler2D uTexture;
    uniform float uThreshold;
    uniform float uTime;

    varying vec2 vUv;
    varying float vAlpha;

    // 2D Simplex Noise for dissolve pattern
    vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    float snoise(vec2 v){
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
               -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy) );
      vec2 x0 = v -   i + dot(i, C.xx);
      vec2 i1;
      i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod(i, 289.0);
      vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
      + i.x + vec3(0.0, i1.x, 1.0 ));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m ;
      m = m*m ;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
      vec3 g;
      g.x  = a0.x  * x0.x  + h.x  * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    void main() {
        // Sample texture
        vec4 texColor = texture2D(uTexture, vUv);
        
        // Generate noise value based on UV and Time
        float noise = snoise(vUv * 10.0 + uTime * 0.1); // Scale noise
        noise = (noise + 1.0) * 0.5; // Normalize to 0..1

        // Dissolve Logic
        // If noise value is less than threshold, discard pixel
        // We use uThreshold. If uThreshold is 0, visible. If 1, invisible.
        // We map uThreshold to a range that covers the noise.
        
        if (noise < uThreshold) {
            discard;
        }

        // Apply color tint
        gl_FragColor = vec4(texColor.rgb * uColor, texColor.a);
        
        // Burn edge color (orange/fire)
        float edgeWidth = 0.05;
        if (noise < uThreshold + edgeWidth && uThreshold > 0.01) {
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.3, 0.0), 0.8);
            gl_FragColor.a = 1.0;
        }
    }
  `
);

extend({ ShardMaterial });

export default ShardMaterial;
