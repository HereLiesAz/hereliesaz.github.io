/**
 * UI INTERFACE
 * ============
 * The Heads-Up Display (HUD) overlaying the 3D scene.
 * It renders the artwork title/year when in focus, and provides access to the menu.
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useActiveMetadata } from '../hooks/useActiveMetadata';
import GlassMenu from './GlassMenu';
import Signature from './Signature'; // Your SVG component

const Interface = () => {
  // Local state for the menu overlay
  const [menuOpen, setMenuOpen] = useState(false);

  // Hook that queries the store to find out which artwork is currently "Sweet Spotted".
  // It returns opacity 1.0 when perfectly aligned, fading to 0.0 as you scroll away.
  const { visible, opacity, data } = useActiveMetadata();

  return (
    <>
      {/*
        1. Fixed Signature (Top Left)
        Functions as the "Hamburger Menu" button.
        Uses 'mix-blend-mode: difference' to ensure visibility against bright/dark backgrounds.
      */}
      <div 
        style={{ position: 'fixed', top: 30, left: 30, zIndex: 50, cursor: 'pointer', mixBlendMode: 'difference' }}
        onClick={() => setMenuOpen(true)}
      >
        <Signature width={120} color="#ffffff" />
      </div>

      {/*
        2. Dynamic Metadata (Bottom Center)
        Displays the Title and Year of the current artwork.
        Fades in/out based on the 'opacity' returned by the hook.
      */}
      <motion.div
        animate={{ opacity: visible ? opacity : 0 }}
        transition={{ duration: 0.2 }}
        style={{
          position: 'fixed',
          bottom: 40,
          left: 0,
          right: 0,
          textAlign: 'center',
          pointerEvents: 'none', // Allows clicks to pass through to the canvas
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

      {/*
        3. The Glass Menu Overlay
        Full-screen navigation menu (hidden by default).
      */}
      <GlassMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
};

export default Interface;
