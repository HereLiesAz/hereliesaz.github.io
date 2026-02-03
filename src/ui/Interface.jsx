import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useActiveMetadata } from '../hooks/useActiveMetadata';
import GlassMenu from './GlassMenu';
import Signature from './Signature'; // Your SVG component

const Interface = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { visible, opacity, data } = useActiveMetadata();

  return (
    <>
      {/* 1. Fixed Signature (Top Left) */}
      <div 
        style={{ position: 'fixed', top: 30, left: 30, zIndex: 50, cursor: 'pointer', mixBlendMode: 'difference' }}
        onClick={() => setMenuOpen(true)}
      >
        <Signature width={120} color="#ffffff" />
      </div>

      {/* 2. Dynamic Metadata (Bottom Center) */}
      <motion.div
        animate={{ opacity: visible ? opacity : 0 }}
        transition={{ duration: 0.2 }}
        style={{
          position: 'fixed',
          bottom: 40,
          left: 0,
          right: 0,
          textAlign: 'center',
          pointerEvents: 'none',
          zIndex: 40,
          fontFamily: "'Helvetica Neue', sans-serif",
          letterSpacing: '0.2em',
          color: '#ffffff',
          textTransform: 'uppercase'
        }}
      >
        {data && (
          <>
            <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>{data.year}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 300 }}>{data.title}</div>
          </>
        )}
      </motion.div>

      {/* 3. The Overlay */}
      <GlassMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
};

export default Interface;
