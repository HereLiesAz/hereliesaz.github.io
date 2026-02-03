import React from 'react';

const Signature = ({ width = 100, color = "#fff" }) => (
  <svg 
    width={width} 
    viewBox="0 0 300 150" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'block' }}
  >
    <path 
      d="M20 80 C 20 80, 50 20, 80 50 C 110 80, 80 120, 50 120 M 60 90 L 150 50 M 140 50 L 140 100 M 180 60 L 220 60 M 200 60 L 200 110" 
      stroke={color} 
      strokeWidth="8" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    />
    {/* This is a stylized abstract 'Az' - replace path d="" with your actual SVG signature path if you have one */}
  </svg>
);

export default Signature;
