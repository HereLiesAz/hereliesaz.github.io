import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { SEGMENT_LENGTH } from '../store/storeHelpers.js';

const SCROLL_SENSITIVITY = 0.004;
const DAMPING            = 0.88;

export default function CameraController() {
  const { camera } = useThree();
  const velocity   = useRef(0);
  const cameraZ    = useRef(0);

  const setCameraZ  = useStore(s => s.setCameraZ);
  const history     = useStore(s => s.history);
  const historyPos  = useStore(s => s.historyPosition);

  // Wheel input
  useEffect(() => {
    const onWheel = (e) => {
      e.preventDefault();
      velocity.current -= e.deltaY * SCROLL_SENSITIVITY;
    };
    const onTouch = (() => {
      let lastY = null;
      return {
        start: (e) => { lastY = e.touches[0].clientY; },
        move:  (e) => {
          if (lastY === null) return;
          const delta = lastY - e.touches[0].clientY;
          velocity.current -= delta * SCROLL_SENSITIVITY;
          lastY = e.touches[0].clientY;
        },
      };
    })();

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouch.start, { passive: true });
    window.addEventListener('touchmove',  onTouch.move,  { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouch.start);
      window.removeEventListener('touchmove',  onTouch.move);
    };
  }, []);

  useFrame(() => {
    // Physics
    velocity.current  *= DAMPING;
    cameraZ.current   += velocity.current;

    // Notify store (triggers preload and rollover logic)
    setCameraZ(cameraZ.current);

    // Camera lateral position follows the spline for the current segment
    const entry = history[historyPos];
    const next  = history[historyPos + 1];
    if (entry && next) {
      const curve  = new THREE.CatmullRomCurve3(
        entry.splinePoints.map(p => new THREE.Vector3(...p))
      );
      const sweetZ = entry.sweetZ;
      const t      = Math.max(0, Math.min(1, (sweetZ - cameraZ.current) / SEGMENT_LENGTH));
      const pt     = curve.getPointAt(t);
      camera.position.x = pt.x;
      camera.position.y = pt.y;
      camera.position.z = cameraZ.current;  // Z driven directly by scroll
    } else {
      camera.position.z = cameraZ.current;
    }

    camera.lookAt(camera.position.x, camera.position.y, cameraZ.current - 1);
  });

  return null;
}