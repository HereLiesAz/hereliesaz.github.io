import React from 'react';
import Scene from './components/Scene';
import Overlay from './components/Overlay';
import { Loader } from '@react-three/drei';

const App = () => {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#050505' }}>
      
      {/* 3D Scene */}
      <Scene />

      {/* Loading Screen */}
      <Loader />

      {/* UI Overlay */}
      <Overlay />

    </div>
  );
};

export default App;
