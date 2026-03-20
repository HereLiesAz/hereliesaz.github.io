import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import ShardMaterial from '../shaders/ShardMaterial';

/**
 * Renders a single painting deconstructed into 3D "strips of canvas".
 * Each strip is a high-density mesh with vertex displacement.
 */
const ShardCloud = ({ paintingId, imageFile, sweetZ, active }) => {
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
  const texture = useLoader(THREE.TextureLoader, `/assets/raw/${imageFile || '1717383357.jpg'}`);
  if (texture) {
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
  }

  // 3. Base Geometry (Extreme optimization: 8x8)
  const baseGeom = useMemo(() => new THREE.PlaneGeometry(1, 1, 8, 8), []);

  // 4. Update Instances
  useEffect(() => {
    if (!data || !meshRef.current) return;

    const mesh = meshRef.current;
    
    // Support two formats:
    // 1. "slices" (new organic strips)
    // 2. "attributes" (baked buffers from previous system)
    
    if (data.slices && data.slices.length > 0) {
      const slices = data.slices;
      const count = slices.length;

      const uvOffsetScale = new Float32Array(count * 4);
      const zOffsets      = new Float32Array(count);
      const zLocals       = new Float32Array(count);
      const zVars         = new Float32Array(count);
      const randoms       = new Float32Array(count * 3);
      
      const dummy = new THREE.Object3D();
      const [imgW, imgH] = data.res || [1024, 1024];
      const aspect = imgW / imgH;
      const FOCAL_DIST = 10.0;

      slices.forEach((s, i) => {
        const [rx, ry, rw, rh] = s.b;
        uvOffsetScale[i * 4 + 0] = rx / imgW;
        uvOffsetScale[i * 4 + 1] = 1.0 - (ry + rh) / imgH; 
        uvOffsetScale[i * 4 + 2] = rw / imgW;
        uvOffsetScale[i * 4 + 3] = rh / imgH;

        zOffsets[i] = s.z;
        zLocals[i]  = s.zl || 0.5;
        zVars[i]    = s.zv || 0.1;
        
        randoms[i * 3 + 0] = s.r ? s.r[0] : Math.random();
        randoms[i * 3 + 1] = s.r ? s.r[1] : Math.random();
        randoms[i * 3 + 2] = s.r ? s.r[2] : Math.random();

        const nx = (rx + rw / 2) / imgW - 0.5;
        const ny = -((ry + rh / 2) / imgH - 0.5);
        const worldW = 10.0 * aspect;
        const worldH = 10.0;
        
        // INTERLEAVED PLACEMENT: z is already centered in baked data [-22, 22]
        dummy.position.set(nx * worldW, ny * worldH, sweetZ + s.z);
        
        // Scale to maintain anamorphic perspective at sweetZ
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
      mesh.geometry.setAttribute('aZLocal', new THREE.InstancedBufferAttribute(zLocals, 1));
      mesh.geometry.setAttribute('aZVar', new THREE.InstancedBufferAttribute(zVars, 1));
      mesh.geometry.setAttribute('aRandom', new THREE.InstancedBufferAttribute(randoms, 3));
      mesh.count = count;

    } else {
      // FALLBACK: One single organic interleaved slice
      const count = 1;
      const dummy = new THREE.Object3D();
      const uvOffsetScale = new Float32Array([0, 0, 1, 1]); // Full image
      const zOffsets = new Float32Array([0]);
      const zLocals = new Float32Array([0.5]);
      const zVars = new Float32Array([0.2]);
      const randoms = new Float32Array([Math.random(), Math.random(), Math.random()]);

      // Just a standard full-frame placement at sweetZ
      const aspect = (data.res ? data.res[0]/data.res[1] : 1);
      const worldW = 10.0 * aspect;
      const worldH = 10.0;
      
      dummy.position.set(0, 0, sweetZ);
      dummy.scale.set(worldW, worldH, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(0, dummy.matrix);

      mesh.geometry.setAttribute('aUvOffsetScale', new THREE.InstancedBufferAttribute(uvOffsetScale, 4));
      mesh.geometry.setAttribute('aZOffset', new THREE.InstancedBufferAttribute(zOffsets, 1));
      mesh.geometry.setAttribute('aZLocal', new THREE.InstancedBufferAttribute(zLocals, 1));
      mesh.geometry.setAttribute('aZVar', new THREE.InstancedBufferAttribute(zVars, 1));
      mesh.geometry.setAttribute('aRandom', new THREE.InstancedBufferAttribute(randoms, 3));
      mesh.count = 1;
    }
    
    mesh.instanceMatrix.needsUpdate = true;
  }, [data, sweetZ]);

  // 5. Material Instance (Unique per cloud to prevent uniform collisions)
  const materialInstance = useMemo(() => {
    return new ShardMaterial();
  }, []);

  useFrame((state) => {
    if (!meshRef.current || !materialInstance) return;
    
    materialInstance.uniforms.uTexture.value = texture;
    materialInstance.uniforms.uSweetZ.value = sweetZ;
    materialInstance.uniforms.uCameraZ.value = state.camera.position.z;
    materialInstance.uniforms.uDisplacementScale.value = 0.8;
    materialInstance.uniforms.uTime.value = state.clock.elapsedTime;
  });

  if (!data) return null;

  return (
    <instancedMesh key={data.id + '_' + data.count} ref={meshRef} args={[baseGeom, null, data.count]}>
       <primitive object={materialInstance} attach="material" transparent />
    </instancedMesh>
  );
};

export default ShardCloud;
