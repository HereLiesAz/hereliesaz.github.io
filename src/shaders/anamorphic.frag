// Anamorphic Fragment Shader
// ==========================
// This shader handles the pixel-level rendering of each stroke.
// It is relatively simple compared to the vertex shader.

// --- UNIFORMS ---
// The texture of the brush stroke (e.g., an oil paint smear).
uniform sampler2D uTexture;

// --- VARYINGS ---
// Received from Vertex Shader.
varying vec4 vColor; // The color of this specific stroke instance.
varying vec2 vUv;    // Texture coordinates.

void main() {
    // 1. Sample Texture
    // Get the grayscale intensity/alpha from the brush texture.
    vec4 tex = texture2D(uTexture, vUv);
    
    // 2. Colorize
    // Multiply the texture by the instance color.
    // Since the texture is likely white with alpha transparency,
    // this tints the stroke to the correct color.
    vec4 finalColor = tex * vColor;
    
    // 3. Alpha Test
    // Discard pixels that are too transparent.
    // This improves performance and prevents z-fighting artifacts
    // in the transparent sorting (though 'depthWrite' is off anyway).
    // A threshold of 0.1 filters out the soft edges of the brush texture.
    if (finalColor.a < 0.1) discard;
    
    // 4. Output
    gl_FragColor = finalColor;
}
