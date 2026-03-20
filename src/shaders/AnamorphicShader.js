import * as THREE from 'three';

export const AnamorphicShader = {
  vertexShader: `
    uniform float uTime;
    uniform float uChaos; // 0.0 = Ordered (Image), 1.0 = Chaos (Cloud)
    
    attribute vec3 aOffset;
    attribute vec3 aColor;
    attribute float aSize;
    attribute float aRandom;
    
    varying vec3 vColor;
    varying float vAlpha;
    
    // Simplex Noise (Simplified)
    vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    float snoise(vec2 v){
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
               -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy) );
      vec2 x0 = v -   i + dot(i, C.xx);
      vec2 i1;
      i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod(i, 289.0);
      vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
      + i.x + vec3(0.0, i1.x, 1.0 ));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m ;
      m = m*m ;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
      vec3 g;
      g.x  = a0.x  * x0.x  + h.x  * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    void main() {
      vColor = aColor;
      
      // -- CHAOS CALCULATION --
      // Base position is aOffset (The Image)
      vec3 pos = aOffset;
      
      // Chaos position is noise-driven explosion
      float noiseVal = snoise(vec2(pos.x * 0.01 + uTime * 0.1, pos.y * 0.01));
      vec3 chaosPos = pos + vec3(
        sin(uTime * 0.5 + aRandom * 10.0) * 500.0,
        cos(uTime * 0.3 + aRandom * 10.0) * 500.0,
        (aRandom - 0.5) * 1000.0
      );
      
      // Interpolate based on uChaos (0 to 1)
      // Ease function for smoother transition
      float t = smoothstep(0.0, 1.0, uChaos);
      vec3 finalPos = mix(pos, chaosPos, t);
      
      // -- SIZE ANIMATION --
      float size = aSize * (1.0 + sin(uTime * 2.0 + aRandom * 100.0) * 0.2);
      
      // Fade out when chaotic
      vAlpha = 1.0 - (t * 0.8);

      vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
      gl_PointSize = size * (1000.0 / -mvPosition.z); // Perspective scaling
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vAlpha;
    
    void main() {
      // Circular particle
      vec2 coord = gl_PointCoord - vec2(0.5);
      if(length(coord) > 0.5) discard;
      
      gl_FragColor = vec4(vColor, vAlpha);
    }
  `
};
