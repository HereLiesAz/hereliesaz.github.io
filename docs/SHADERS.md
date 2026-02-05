# Shaders & Mathematics

The visual magic of the Infinite Void relies on custom GLSL shaders found in `src/shaders/`.

## Anamorphic Projection Logic

The goal is to have particles that look chaotic from most angles but form a perfect image when the camera is at a specific Z-coordinate (the "Sweet Spot").

### Vertex Shader (`anamorphic.vert`)

The vertex shader calculates the position of each particle in 3D space.

1279 P_{final} = P_{base} + ( \vec{V}_{chaos} \times f(dist) ) 1279

Where:
- {base}$ is the "perfect" position of the stroke (from the 2D image).
- $ is the distance between the Camera's current Z and the Image's Sweet Spot Z.
- (dist)$ is a progress function (0.0 when aligned, 1.0 when far away).
- $\vec{V}_{chaos}$ is a procedural noise vector based on the particle's random attributes.

**Key Uniforms:**
- `uScroll`: The global scroll position (Camera Z).
- `uSweetSpot`: The Z position where this specific artwork resolves.
- `uChaosLevel`: A multiplier for the entropy.

**The "Explosion" Effect:**
As `abs(uScroll - uSweetSpot)` increases, the shader interpolates the particle's position from its organized state to a random, tumbled state.

### Fragment Shader (`anamorphic.frag`)

A simple shader that handles:
1.  **Texture Mapping**: Mapping the brush stroke texture to the particle quad.
2.  **Colorizing**: Multiplying the texture by the stroke's color (from attributes).
3.  **Alpha Testing**: Discarding transparent pixels.
