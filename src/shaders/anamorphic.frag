// src/shaders/anamorphic.frag
uniform sampler2D uTexture;

varying vec4 vColor;
varying vec2 vUv;

void main() {
    // Sample the brush stroke texture
    vec4 tex = texture2D(uTexture, vUv);
    
    // Apply the instance color (from the painting pixels)
    vec4 finalColor = tex * vColor;
    
    // Alpha Test (Discard transparent pixels for performance)
    if (finalColor.a < 0.1) discard;
    
    gl_FragColor = finalColor;
}
