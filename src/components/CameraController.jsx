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

    // 2. Continuous Trajectory (Global history spline)
    if (history.length > 0) {
      // Assemble the entire path so far
      const allPoints = history.flatMap((h, i) => {
        // Skip the first point of each segment to avoid overlap, except the very first
        return i === 0 ? h.splinePoints : h.splinePoints.slice(1);
      });
      
      if (allPoints.length < 2) return;

      const curve = new THREE.CatmullRomCurve3(
        allPoints.map(p => new THREE.Vector3(...p))
      );

      // Map cameraZ into [0, 1] of the global trajectory
      const firstZ = allPoints[0][2];
      const lastZ  = allPoints[allPoints.length - 1][2];
      const totalDist = firstZ - lastZ;
      
      if (totalDist > 0) {
        const u = Math.max(0, Math.min(1, (firstZ - cameraZ.current) / totalDist));
        const pt = curve.getPointAt(u);
        
        camera.position.x = pt.x;
        camera.position.y = pt.y;
        camera.position.z = cameraZ.current;
      }
    } else {
      camera.position.z = cameraZ.current;
    }

    // Look slightly ahead in Z to maintain the 'Infinite Void' feel
    camera.lookAt(camera.position.x, camera.position.y, cameraZ.current - 10);
  });

  return null;
}