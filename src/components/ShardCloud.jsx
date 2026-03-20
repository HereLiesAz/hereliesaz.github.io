import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import ShardMaterial from '../shaders/ShardMaterial';

/**
 * Renders a single painting deconstructed into 3D "strips of canvas".
 * Each strip is a high-density mesh with vertex displacement.
 */
const ShardCloud = ({ paintingId, sweetZ, active }) => {
  const meshRef = useRef();
  const [data, setData] = useState(null);
  
  // 1. Load Baked Data
  useEffect(() => {
    fetch(`/data/baked/${paintingId}.baked.json`)
      .then(r => r.json())
      .then(setData)
      .catch(e => console.error(`Failed to load ${paintingId}:`, e));
  }, [paintingId]);

  // 2. Load Texture
  const texture = useLoader(THREE.TextureLoader, `/assets/raw/${paintingId}.jpg`);
  if (texture) {
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
  }

  // 3. Base Geometry (High density for 3D displacement)
  const baseGeom = useMemo(() => new THREE.PlaneGeometry(1, 1, 32, 32), []);

  // 4. Update Instances
  useEffect(() => {
    if (!data || !meshRef.current) return;

    const mesh = meshRef.current;
    const slices = data.slices;
    const count = slices.length;

    const uvOffsetScale = new Float32Array(count * 4);
    const zOffsets = new Float32Array(count);
    const randoms = new Float32Array(count * 3);
    
    const dummy = new THREE.Object3D();
    const [imgW, imgH] = data.res;
    const aspect = imgW / imgH;
    
    // Constant for anamorphic scaling (distance from sweet spot to camera origin)
    // In our store, SEGMENT_LENGTH is 21.44. Let's assume a focal distance of 10.
    const FOCAL_DIST = 10.0;

    slices.forEach((s, i) => {
      const [rx, ry, rw, rh] = s.b;
      
      // Normalized UVs
      uvOffsetScale[i * 4 + 0] = rx / imgW;
      uvOffsetScale[i * 4 + 1] = 1.0 - (ry + rh) / imgH; // Flip Y for Three.js
      uvOffsetScale[i * 4 + 2] = rw / imgW;
      uvOffsetScale[i * 4 + 3] = rh / imgH;

      zOffsets[i] = s.z;
      randoms[i * 3 + 0] = s.r[0];
      randoms[i * 3 + 1] = s.r[1];
      randoms[i * 3 + 2] = s.r[2];

      // Position in world space at sweet spot
      const nx = (rx + rw / 2) / imgW - 0.5;
      const ny = -((ry + rh / 2) / imgH - 0.5);
      
      const worldW = 10.0 * aspect;
      const worldH = 10.0;
      
      dummy.position.set(nx * worldW, ny * worldH, sweetZ + s.z);
      
      // Anamorphic Scaling: Resize so it looks perfect from front
      // Scale = (FocalDist - offsetZ) / FocalDist
      // Since s.z is negative if it's further away, we use (FocalDist - s.z)
      const scaleToCompensate = (FOCAL_DIST - s.z) / FOCAL_DIST;
      dummy.scale.set(
        (rw / imgW) * worldW * scaleToCompensate, 
        (rh / imgH) * worldH * scaleToCompensate, 
        1
      );
      
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });

    mesh.geometry.setAttribute('aUvOffsetScale', new THREE.InstancedBufferAttribute(uvOffsetScale, 4));
    mesh.geometry.setAttribute('aZOffset', new THREE.InstancedBufferAttribute(zOffsets, 1));
    mesh.geometry.setAttribute('aRandom', new THREE.InstancedBufferAttribute(randoms, 3));
    
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = count;
  }, [data, sweetZ]);

  // 5. Material Uniforms
  const uniforms = useMemo(() => ({
    uTexture: { value: null },
    uSweetZ: { value: 0 },
    uCameraZ: { value: 0 },
    uFocalDist: { value: 10.0 }
  }), []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const { cameraZ } = state.camera.position; // R3F camera usually at 0,0,5+
    
    meshRef.current.material.uniforms.uTexture.value = texture;
    meshRef.current.material.uniforms.uSweetZ.value = sweetZ;
    meshRef.current.material.uniforms.uCameraZ.value = state.camera.position.z;
  });

  if (!data) return null;

  return (
    <instancedMesh ref={meshRef} args={[baseGeom, null, data.count]}>
      <primitive object={ShardMaterial} attach="material" transparent />
    </instancedMesh>
  );
};

export default ShardCloud;
