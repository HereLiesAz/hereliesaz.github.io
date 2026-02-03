import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const GlassMenu = ({ isOpen, onClose }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
          animate={{ opacity: 1, backdropFilter: "blur(20px)" }}
          exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
          transition={{ duration: 0.5 }}
          onClick={onClose}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(5, 5, 5, 0.6)', // Dark semi-transparent
            zIndex: 100,
            cursor: 'pointer'
          }}
        >
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ delay: 0.2 }}
            style={{
              fontFamily: "'Courier New', monospace",
              color: '#eee',
              textAlign: 'center',
              pointerEvents: 'none' // Clicks pass through to close
            }}
          >
            <h1 style={{ fontSize: '2rem', marginBottom: '1rem', letterSpacing: '-0.05em' }}>
              JEFF SMITH-LUEDKE
            </h1>
            <p style={{ opacity: 0.7 }}>Volumetric Artist / Developer</p>
            
            <div style={{ marginTop: '3rem', display: 'flex', gap: '2rem', justifyContent: 'center', pointerEvents: 'auto' }}>
              <a href="https://github.com/hereliesaz" target="_blank" style={{ color: '#fff' }}>GITHUB</a>
              <a href="mailto:azrienoch@gmail.com" style={{ color: '#fff' }}>EMAIL</a>
            </div>
            
            <div style={{ marginTop: '4rem', maxWidth: '400px', lineHeight: '1.6', fontSize: '0.9rem', opacity: 0.6 }}>
              "The painting is not a flat surface, but a cloud of geometric data that momentarily aligns to form meaning."
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default GlassMenu;
