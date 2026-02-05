import React, { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// --- EMBEDDED SHADERS (No external files needed) ---

const vertexShader = `
  uniform float uTime;
  uniform float uProgress;

  // Instanced Attributes
  attribute vec3 aOffset;
  attribute vec3 aColor;
  attribute vec2 aSize;
  attribute float aMeta;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    
    // Pass UV to fragment
    vec3 transformed = position;

    // SCALING
    // Scale the quad based on the stroke width/height
    transformed.x *= aSize.x;
    transformed.y *= aSize.y;

    // POSITIONING
    // Apply the offset (x, y, z) from the JSON data
    vec3 finalPos = transformed + aOffset;

    // ANIMATION (The "Z-Fly" Effect)
    // As uProgress moves 0 -> 1, things fly toward camera
    float zDist = finalPos.z + (uProgress * 10.0);
    
    // Wrap around loop (Infinite Tunnel Illusion)
    // if (zDist > 5.0) zDist -= 20.0; 

    finalPos.z = zDist;

    // FADE LOGIC
    // Fade out if too close or too far
    float dist = -finalPos.z;
    vAlpha = smoothstep(0.0, 1.0, 1.0 - abs(finalPos.z / 10.0));

    gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // CIRCULAR BRUSH TIP
    // Calculate distance from center of the quad (0.5, 0.5)
    vec2 uv = gl_PointCoord - vec2(0.5);
    float dist = length(uv);

    // Soft edge circle
    float shape = 1.0 - smoothstep(0.45, 0.5, dist);

    // Discard transparent pixels
    if (shape < 0.01) discard;

    // Final Color
    gl_FragColor = vec4(vColor, vAlpha * shape);
  }
`;

// --- COMPONENT ---

const InfiniteCanvas = ({ activePaintingId, transitionProgress }) => {
  const meshRef = useRef();
  const [paintingData, setPaintingData] = useState(null);

  // 1. Load Data
  useEffect(() => {
    let isMounted = true;
    if (!activePaintingId) return;

    // Sanitize ID to prevent path traversal
    const safeId = activePaintingId.replace(/[^a-zA-Z0-9_\-.~]/g, ''); 
    const url = `data/${safeId}.json`;

    console.log(`[Canvas] Loading ${safeId}...`);

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (isMounted) {
           // Handle Legacy: If root is array, wrap it in object structure
           if (Array.isArray(data)) {
             setPaintingData({ strokes: data, meta: {} });
           } else {
             setPaintingData(data);
           }
        }
      })
      .catch(err => {
        console.warn(`[Canvas] Failed to load ${safeId}:`, err);
      });

    return () => { isMounted = false; };
  }, [activePaintingId]);

  // 2. Generate Geometry (The Sanitizer)
  const meshData = useMemo(() => {
    if (!paintingData || !paintingData.strokes) return null;

    const strokes = paintingData.strokes;
    const count = strokes.length;
    
    if (count === 0) return null;

    const positionBuffer = new Float32Array(count * 3);
    const colorBuffer = new Float32Array(count * 3);
    const sizeBuffer = new Float32Array(count * 2); 
    const metaBuffer = new Float32Array(count * 1); // Depth/Z

    for (let i = 0; i < count; i++) {
      const s = strokes[i];
      
      // --- DEFENSIVE CODING START ---
      // If stroke is null/undefined, skip it
      if (!s) continue;

      let r=0.5, g=0.5, b=0.5;
      let x=0, y=0, w=100, h=100;
      let z = 0;

      // Case A: Standard Object { color: [r,g,b], bbox: [x,y,w,h] }
      if (s.color && s.bbox) {
          r = (s.color[0] || 0) / 255;
          g = (s.color[1] || 0) / 255;
          b = (s.color[2] || 0) / 255;
          x = s.bbox[0] || 0;
          y = s.bbox[1] || 0;
          w = s.bbox[2] || 10;
          h = s.bbox[3] || 10;
          z = s.z || 0.5;
      }
      // Case B: Legacy Array [r, g, b, x, y, w, h] (Hypothetical fallback)
      else if (Array.isArray(s) && s.length >= 7) {
          r = s[0] / 255; g = s[1] / 255; b = s[2] / 255;
          x = s[3]; y = s[4]; w = s[5]; h = s[6];
      }
      // Case C: Just color (fallback)
      else if (s.color) {
          r = (s.color[0] || 0)/255; 
          g = (s.color[1] || 0)/255; 
          b = (s.color[2] || 0)/255;
      }
      // --- DEFENSIVE CODING END ---

      // Fill Buffers
      const i3 = i * 3;
      const i2 = i * 2;

      // Center the stroke (Mapping 1024x1024 to approx -5..5 space)
      const SCALE = 0.01;
      const cx = (x + w/2 - 512) * SCALE;
      const cy = -(y + h/2 - 512) * SCALE; // Flip Y for 3D

      positionBuffer[i3] = cx;
      positionBuffer[i3 + 1] = cy;
      positionBuffer[i3 + 2] = (z * 5) - 2.5; 

      colorBuffer[i3] = r;
      colorBuffer[i3 + 1] = g;
      colorBuffer[i3 + 2] = b;

      sizeBuffer[i2] = w * SCALE;
      sizeBuffer[i2 + 1] = h * SCALE;
      
      metaBuffer[i] = Math.random(); 
    }

    return {
      count,
      positions: positionBuffer,
      colors: colorBuffer,
      sizes: sizeBuffer,
      meta: metaBuffer
    };
  }, [paintingData]);

  // 3. Animation Uniforms
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uTexture: { value: null } 
  }), []);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.material.uniforms.uTime.value = state.clock.elapsedTime;
      meshRef.current.material.uniforms.uProgress.value = transitionProgress;
    }
  });

  if (!meshData) return null;

  return (
    <instancedMesh ref={meshRef} args={[null, null, meshData.count]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
      {/* Attach Attributes Directly to Geometry */}
      <instancedBufferAttribute attach="attributes-aOffset" args={[meshData.positions, 3]} />
      <instancedBufferAttribute attach="attributes-aColor" args={[meshData.colors, 3]} />
      <instancedBufferAttribute attach="attributes-aSize" args={[meshData.sizes, 2]} />
      <instancedBufferAttribute attach="attributes-aMeta" args={[meshData.meta, 1]} />
    </instancedMesh>
  );
};

export default InfiniteCanvas;
