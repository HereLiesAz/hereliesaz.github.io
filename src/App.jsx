import React, { Suspense } from 'react';
import InfiniteVoid from './canvas/InfiniteVoid';
import Interface from './ui/Interface';

function App() {
  return (
    <>
      {/* The 3D World (Background) */}
      <Suspense fallback={null}>
        <InfiniteVoid />
      </Suspense>
      
      {/* The UI Layer (Foreground) */}
      <Interface />
    </>
  );
}

export default App;
