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

    // Pseudo-random function
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    void main() {
        // Correct UV mapping for atlas/texture portion
        vUv = aUvOffset + (uv * aUvScale);

        // Base position (The "Shard" geometry itself, usually a 1x1 quad centered at 0)
        vec3 pos = position * aScale; // Scale the quad to match its bbox size

        // Retrieve instance position from the matrix (column 3)
        // If using standard InstancedMesh, instanceMatrix is available.
        // However, we are manually passing aOffset buffer which contains the CENTER of the shard.
        // If we use 'position={...}' on <instancedMesh>, the whole cloud is moved.
        // Each instance is just an index. We need to construct the position from aOffset.
        
        // If we use 'instancedMesh' without manually setting matrices, all instances are at (0,0,0).
        // We must rely on our custom attributes.
        
        vec3 instanceCenter = aOffset;
        
        // Calculate Chaos Vector
        // We want shards to fly *outwards* or *drift* based on uProgress.
        // Direction is based on aRandom.
        vec3 chaosDir = normalize(aRandom - 0.5); 
        float chaosDist = uProgress * 20.0; // Explosion radius (tuned)

        // Apply displacement
        // Current Pos = Center + QuadOffset + Chaos
        // We add some rotation/tumble based on progress
        
        // Tumble Rotation (Axis-Angle)
        float angle = uProgress * (aRandom.x * 10.0 + uTime * 0.5);
        vec3 axis = normalize(aRandom);
        
        // Rodrigues Rotation Formula (Simplified)
        // actually just adding noise to position is enough for now.
        
        vec3 finalPos = instanceCenter + pos + (chaosDir * chaosDist);
        
        // Project to clip space
        // Use modelViewMatrix since we are manually handling instance positioning relative to the mesh origin
        gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
        
        // Pass alpha/progress to fragment
        vAlpha = 1.0; 
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
