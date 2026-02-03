# **Volumetric Anamorphosis: The Convergence of Stroke-Based Rendering, Monocular Depth Estimation, and Perspective Projection in 3D Virtual Environments**

## **The Evolution of the Anamorphic Vantage Point**

The history of visual representation has largely been defined by the constraints of the two-dimensional plane. From the earliest cave paintings to the high realism of the Renaissance, the artist's challenge was to simulate depth on a flat surface. However, the phenomenon of anamorphosis—the distorted projection of an image that requires a specific vantage point to be resolved—introduced a dynamic relationship between the viewer and the artwork. Historically, this interaction was physical and static. In Hans Holbein the Younger’s *The Ambassadors* (1533), a distorted skull slashes across the bottom of the composition, intelligible only when viewed from an acute angle.2 This technique, rooted in the projective geometry of the 16th century, was a manipulation of the viewing frustum long before the concept of a digital frustum existed. It relied on the fixed position of the observer relative to a physical canvas.

In the contemporary era of spatial computing and volumetric rendering, anamorphosis has evolved from a parlor trick of perspective into a sophisticated architectural principle of virtual environments. The user’s request to explode a painting into constituent slices or strokes, distribute them along the Z-axis, and have them coalesce into a coherent image only at a specific coordinate, speaks to the very heart of this evolution. It transforms the painting from a static object into a spatial event. This concept, which we might term "Volumetric Anamorphosis," liberates the brushstroke from the tyranny of the XY plane. It posits that a painting is not a flat surface, but a cloud of geometric data that momentarily aligns to form meaning.3

The realization of this effect requires a convergence of three distinct technological domains: **Stroke-Based Rendering (SBR)** to decompose the image into discrete elements; **Monocular Depth Estimation (MDE)** to assign a meaningful Z-coordinate to each element; and **Inverse Perspective Projection** to ensure that, despite their displacement in depth, the strokes align perfectly when viewed from the "Sweet Spot".5 This report provides an exhaustive analysis of the mathematical, algorithmic, and perceptual mechanisms required to construct such a system.

### **The Philosophy of the View-Dependent Truth**

The core philosophical proposition of volumetric anamorphosis is that "truth" or "coherence" is position-dependent. In a standard 3D scene, objects have an objective shape—a cube looks like a cube from any angle, though its profile changes. In a volumetric anamorphic painting, the "painting" itself does not exist objectively in 3D space. From the side, the viewer sees a chaotic cloud of floating polygons, a "nebula" of color and texture that resembles nothing recognizable.8 It is only when the viewer navigates to the precise locus of the camera—the ![][image1] (view position)—that the chaos resolves into order.

This creates a narrative of discovery. As the user navigates through the Z-axis, moving through the field of floating strokes, they are essentially traveling through the deconstructed components of the artwork. The "flythrough" becomes a journey of assembly. This aligns with theories of perception where the brain actively synthesizes sensory data into coherent wholes, a process closely linked to pareidolia, which will be discussed in later sections.10 The technical execution of this narrative relies heavily on the manipulation of the WebGL Model-View-Projection (MVP) matrix, effectively turning the rendering pipeline inside out to prioritize the view-dependent image over the objective 3D geometry.5

## **Mathematical Derivation of the Volumetric Illusion**

To implement the user's vision—where strokes are resized and offset on the Z-axis yet align perfectly on a 2D plane from a specific view—we must rigorously define the relationship between 3D world space and 2D clip space. The standard graphics pipeline projects 3D points onto a 2D screen. Our task is the inverse: we start with a desired 2D result (the painting) and "unproject" it into 3D space at varying depths, solving for the necessary scale and position to maintain the original 2D appearance.12

### **The Model-View-Projection (MVP) Architecture**

In WebGL and libraries like Three.js, the position of a vertex on the screen is determined by the MVP matrix product.

![][image2]  
Where ![][image3] is the vertex position in the object's local space, and ![][image4] is the position in clip space (homogeneous coordinates ![][image5]).5

Clip space is a cube ranging from ![][image6] to ![][image7]. The crucial step in rendering is the "perspective divide," where the ![][image8], ![][image9], and ![][image10] components are divided by ![][image11]. In a perspective projection, ![][image11] is typically proportional to the distance from the camera (specifically ![][image12] in view space). This division by ![][image10] is what causes distant objects to appear smaller—perspective foreshortening.5

To create volumetric anamorphosis, we must counteract this foreshortening. If we move a brushstroke from ![][image13] to ![][image14] (further away), the perspective divide will shrink it by a factor of 10\. Therefore, to make it appear identical to the viewer at the origin, we must physically scale the stroke's geometry by a factor of 10\.

### **The Inverse Projection (Unproject) Logic**

The user's requirement is to take a slice of a painting at 2D screen coordinates ![][image15] and place it at an arbitrary depth ![][image16] in the 3D world. This is achieved via "unprojection".12 Let ![][image17] be the Normalized Device Coordinate of the stroke center, where ![][image18] and ![][image19]. In standard unprojection, we assume a depth value ![][image20] for the NDC coordinate. However, we want to specify the depth in *world units*, not NDC units.

The algorithm for placing a stroke ![][image21] originating from pixel ![][image15] is as follows:

1. **Normalize Coordinates**: Convert pixel coordinates ![][image15] to NDC ![][image22].  
   ![][image23]  
   ![][image24]  
2. **Define Target Depth**: Let ![][image25] be the desired Z-position of the stroke in world space. This ![][image25] is derived either randomly or from a depth map (discussed in Section 4).  
3. **Construct Ray**: Create a ray from the camera position passing through ![][image22] on the near clipping plane.14  
   ![][image26]  
   ![][image27]  
   (Note: The Z value in Unproject is arbitrary here, we just need the direction vector).12  
4. **Intersect Ray with Plane**: We define a plane parallel to the camera's image plane at distance ![][image25]. We calculate the intersection of ![][image28] with this plane to find the precise world position ![][image29].3

This ensures that the center of the stroke is perfectly aligned with the original pixel. However, position is only half the equation; the scale must also be corrected.

### **The Scale-Depth Compensation Formula**

To satisfy the user's condition that strokes "look like they're on the same 2D plane," the angular size of the stroke must remain constant regardless of its ![][image30] position.

In a perspective projection, the projected height ![][image31] of an object with world height ![][image32] at distance ![][image33] is:

![][image34]  
If we want ![][image31] to be constant (equal to the size of the stroke in the source image) as we vary ![][image33], we must vary ![][image32].

![][image35]  
Where ![][image36] is a constant related to the screen resolution.

Simplifying this, the scale factor ![][image21] applied to the stroke mesh is linearly proportional to the distance from the camera.

![][image37]  
Where ![][image38] is the distance of the "virtual canvas" plane (e.g., the plane where the painting would normally sit), and ![][image33] is the actual distance of the stroke.3

This linear scaling ensures that a stroke placed 1000 units away is 100 times larger than a stroke placed 10 units away, such that their projection on the screen occupies the exact same number of pixels. This is the mathematical backbone of the anamorphic illusion. Without this compensation, the volumetric cloud would look sparse and tiny in the distance and overwhelmingly large in the foreground.

## **Deconstructing the Image: Stroke Extraction and Synthesis**

Before we can project strokes into 3D space, we must generate them. The user's request involves "slices of paintings" or "strokes." This requires decomposing a raster image (a grid of pixels) into a vector-like collection of distinct entities. This process is known as Stroke-Based Rendering (SBR) or Image Stylization. We analyze three primary approaches for generating these assets: Algorithmic SBR, Neural Painting Transformers, and Segmentation-Based Extraction.

### **Classical Stroke-Based Rendering (SBR)**

Early approaches, most notably by Aaron Hertzmann (1998), utilize a greedy algorithm to place strokes.17 The algorithm operates on a "coarse-to-fine" hierarchy:

1. **Blur**: Create a series of reference images with varying degrees of Gaussian blur.  
2. **Difference Analysis**: Compare the canvas (initially blank) to the blurred reference. Identify areas of highest error (difference in color).  
3. **Stroke Placement**: Place a spline stroke at the point of highest error. The stroke color is sampled from the reference image. The stroke direction is determined by the gradient (the direction of zero color change).18  
4. **Iteration**: Repeat with progressively smaller brush sizes (radii) until the canvas matches the source image within a threshold.

While effective for static 2D images, Hertzmann’s method can be computationally slow (minutes per image) and produces spline data that must be triangulated into 3D meshes for our volumetric application.17 The "curved brush strokes" generated by this method are ideal for the "slices" the user envisions, as they naturally separate the image into organic components rather than rigid tiles.

### **Deep Learning Approaches: PaintTransformer**

For real-time or high-fidelity applications, neural networks offer a more robust solution. **PaintTransformer** represents a significant leap forward, framing stroke generation as a set prediction problem.20 Unlike sequential reinforcement learning agents that place one stroke at a time, PaintTransformer utilizes a feed-forward Transformer architecture to predict the parameters of hundreds of strokes simultaneously.

The architecture consists of two modules:

* **Stroke Predictor**: A Transformer encoder-decoder that takes the source image and the current canvas state as input and outputs a set of stroke parameters (position ![][image39], width ![][image11], height ![][image40], rotation ![][image41], color ![][image42]).22  
* **Stroke Renderer**: A differentiable rendering module that rasterizes the predicted strokes onto the canvas for loss calculation.

For the volumetric anamorphosis project, PaintTransformer is superior because it outputs *parameters*. We do not get a flat image; we get a list of vectors: ![][image43]. These parameters are directly mappable to 3D instances. The ![][image44] becomes the unprojection target; the ![][image45] becomes the base scale; and the rotation ![][image41] is applied to the Z-axis of the 3D mesh.21 This allows for the generation of thousands of "brush stroke" objects that are semantically meaningful parts of the image, rather than arbitrary pixel clusters.

### **Segmentation-Based Extraction: Segment Anything (SAM)**

While PaintTransformer mimics the *act* of painting, the **Segment Anything Model (SAM)** allows for the extraction of semantic *objects*.24 The user mentioned "slices of paintings." In many cases, these slices might correspond to distinct objects—an apple, a face, a tree. SAM utilizes a Vision Transformer (ViT) based image encoder to generate mask embeddings. It supports "promptable" segmentation, where points or bounding boxes can guide the extraction.24

For a volumetric scene, SAM can be used to "lift" entire objects.

1. **Grid Prompting**: Pass a grid of points to SAM to generate masks for everything in the image.24  
2. **Vectorization**: Convert the resulting binary masks into SVG paths or meshes using algorithms like Potrace or vtracer.27  
3. **Layering**: These object meshes become the "slices."

Comparing SAM to PaintTransformer for this use case: SAM preserves the exact contours of objects but may result in large, irregular meshes. PaintTransformer produces uniform "brush stroke" primitives (e.g., textured quads) which are easier to instance and optimize in WebGL.29 The recommended approach for a "painterly" feel is to use PaintTransformer to generate the background and texture, and SAM to isolate key foreground elements for specific Z-layering (e.g., ensuring the "eyes" of a portrait are on a separate, coherent layer).

## **The Z-Axis: Monocular Depth Estimation and Distribution**

The critical innovation in the user's request is the Z-axis distribution. "Imagine strokes all resized and offset on the z-axis." This implies a distribution that is not random but meaningful. If we simply randomize the Z-offset, the "flythrough" will feel like moving through static, uncorrelated noise. If we map the Z-offset to the actual depth of the scene, the flythrough becomes a journey *into* the painting.7

To achieve this from a single 2D image, we employ **Monocular Depth Estimation (MDE)**.

### **Metric vs. Relative Depth: ZoeDepth and MiDaS**

MDE models predict a depth map from a single RGB image. The state-of-the-art models currently are **MiDaS** and **ZoeDepth**.7

**MiDaS** (Multiple Depth Estimation in the Wild) treats depth as a relative quantity. It outputs an inverse depth map where values indicate "closer" or "further," but the scale is arbitrary and non-linear.30 This can lead to distortion when mapping to a linear 3D coordinate system. Background objects might be "flattened" against the far plane.

**ZoeDepth** builds upon MiDaS but is fine-tuned to output *metric* depth (real-world units, e.g., meters).7 This is crucial for volumetric anamorphosis.

* **Metric Accuracy**: ZoeDepth estimates the absolute distance. This allows us to place the "mountain" strokes at 1000 units and the "flower" strokes at 2 units with geometric plausibility.7  
* **Detail Preservation**: While MiDaS is "sharper" in edge detection, ZoeDepth has better handling of complex overlaps (e.g., an arm crossing a leg), ensuring that the "slices" are separated correctly in Z-space.30

**Implementation Strategy:**

1. **Generate Depth Map**: Pass the source painting through ZoeDepth to get a 16-bit float depth tensor.30  
2. **Sampling**: For each stroke generated by PaintTransformer, sample the depth map at the stroke's center ![][image15].  
3. **Mapping**: Map the depth value $d\_{map} \\in $ to World Z ![][image46]. A non-linear mapping (e.g., exponential) often looks better for landscapes, pushing the sky very far back.  
   ![][image47]  
4. **Clustering**: To prevent "tearing" where a single object (like a face) is ripped apart by depth noise, we can average the depth values within the mask generated by SAM. This ensures that semantically coherent "slices" remain planar-coherent in 3D space.25

### **The Point Cloud Fallacy vs. Stroke Volumetrics**

It is important to distinguish this technique from simple Point Cloud projection.33 In point cloud rendering, every pixel becomes a vertex. This requires millions of points and often looks sparse or "ghostly" when viewed from the side. By using *strokes* (larger textured quads) instead of points, we gain two advantages:

1. **Aesthetic Integrity**: The side view looks like a flurry of paint, an abstract art piece, rather than a sparse point cloud.  
2. **Fill Rate**: Large strokes cover more screen space, maintaining the illusion of solidity with fewer geometric primitives.35 The "scale-depth compensation" ensures that gaps don't appear between strokes as they recede, provided the original overlap was sufficient.

## **The Rendering Pipeline: Optimization and Implementation**

Rendering 10,000 to 100,000 individual brush strokes in a web browser (WebGL/Three.js) presents significant performance challenges, particularly on mobile devices. The naive approach of creating a THREE.Mesh for every stroke will result in thousands of draw calls, crushing the CPU.35 We must employ hardware instancing and batching.

### **InstancedMesh vs. BatchedMesh**

**InstancedMesh** is the standard solution for rendering many copies of the same geometry.29 If our "strokes" are all identical quads (just scaled and rotated), InstancedMesh is extremely efficient, reducing the rendering to a single draw call. We can use a texture atlas or a texture array to give different strokes different appearances.36

* *Pros*: Extremely fast, low memory overhead.  
* *Cons*: All strokes must share the same geometry. You cannot mix a "long thin stroke" mesh with a "round splat" mesh in the same instance.29

**BatchedMesh** (introduced recently in Three.js) allows for the bundling of *different* geometries into a single draw call.29 This is ideal if we are using the SAM-based approach where we have unique mesh shapes for different "slices" of the painting. We can merge the geometry of the "apple slice," the "face slice," and the "tree slice" into one BatchedMesh.

* *Pros*: Allows unique geometry per stroke/slice.  
* *Cons*: Higher memory usage; modifying individual matrices can be slower than instancing due to texture/uniform upload overhead on some mobile GPUs.39

**Recommendation**: For the "brush stroke" aesthetic (PaintTransformer), use **InstancedMesh**. The "stroke" can be a generic quad or a slightly curved mesh. The variation in shape (long vs short) can be achieved by non-uniform scaling of the instance matrix, which is computationally free.37 For the "object slice" aesthetic (SAM), use **BatchedMesh** or merge geometries into a single BufferGeometry if they are static.36

### **Shader Logic and The "Reveal"**

To enhance the user's experience of the "alignment," we can use custom shaders (GLSL). The vertex shader can include a "turbulence" factor. When the user is far from the sweet spot, the strokes can undulate or rotate slightly, emphasizing their 3D nature. As the camera approaches the alignment point (![][image1]), this turbulence can be dampened to zero.41

The vertex shader calculation for position would look like:

OpenGL Shading Language

// GLSL Pseudo-code for Vertex Shader  
attribute vec3 offset; // The calculated unprojected position  
attribute float scale; // The calculated depth-compensation scale  
uniform float revealProgress; // 0.0 \= chaotic, 1.0 \= aligned  
uniform vec3 targetCameraPos;

void main() {  
  vec3 pos \= position \* scale; // Apply scale-depth compensation  
    
  // Apply rotation to face the camera at the sweet spot  
  // In the 'chaos' state, we might add noise  
  vec3 noise \= curlNoise(pos \+ time);   
  pos \+= mix(noise, vec3(0.0), revealProgress);  
    
  // Translate to world position  
  vec3 worldPos \= pos \+ offset;  
    
  gl\_Position \= projectionMatrix \* viewMatrix \* vec4(worldPos, 1.0);  
}

This allows for a dynamic transition where the painting "snaps" into place as the user arrives.42

### **Mobile Optimization Strategy**

On mobile devices, fill rate (the number of pixels drawn) is often a bottleneck. Overlapping semi-transparent strokes (alpha blending) causes significant overdraw.36

* **Alpha Test**: Instead of expensive transparency blending, use "Alpha Test" (discard pixels with alpha \< threshold). This is faster but produces jagged edges.44  
* **Precision**: Use precision mediump float in shaders. It is 2x faster on many mobile GPUs.36  
* **Texture Compression**: Use KTX2 / Basis Universal for the stroke textures to reduce VRAM usage and download time.45

## **Interaction Design: The Narrative of the Flythrough**

The user asked to "imagine the view takes you through them." This implies a cinematic camera movement.

### **Scroll-Jacking and Camera Paths**

We map the user's scroll input to the camera's Z-position. Libraries like **GSAP** (GreenSock) with ScrollTrigger or **Theatre.js** are standard for this.47

* **The Approach**: As the user scrolls down, the camera moves from ![][image48] towards ![][image49]. The strokes, distributed from ![][image50] to ![][image13], stream past the camera.  
* **The Sweet Spot**: We can set the alignment point at ![][image49]. However, to allow the user to see the painting *as a painting*, we usually position the camera at ![][image51] looking at the origin.  
* **Parallax**: Because the strokes are physically separated in Z, moving the mouse (simulating head movement) creates immediate, realistic parallax. The background strokes move slower than the foreground strokes. This confirms to the user that they are looking at a volume, not a flat image.49

### **Gaze-Contingent Rendering**

To further heighten the immersion, we can employ gaze-contingent rendering.51 Using the mouse position as a proxy for gaze (or actual eye-tracking APIs if available), we can subtly shift the projection matrix (shearing) to create "ocular parallax." This mimics the way real 3D objects shift relative to each other when we move our focus, reinforcing the illusion that the floating strokes are physical objects suspended in space.49

## **Perceptual Psychology: Pareidolia and the Goldilocks Zone**

Why does this illusion work? It relies on **Pareidolia**, the brain's tendency to resolve patterns (especially faces) from noise.11 When the user is "flying through" the strokes, the visual input is high-entropy noise. As they approach the sweet spot, the entropy decreases, and the geometric correlation increases. The brain is actively searching for the pattern.

MIT research suggests there is a "Goldilocks Zone" of complexity for pareidolia.10 If the strokes are too dense, the volume is opaque and the "flythrough" feels like moving through fog. If too sparse, the image never resolves. **Implication**: We should tune the stroke density based on the depth.

* **Foreground**: High density, small strokes (high detail).  
* **Background**: Lower density, larger strokes.  
* This mimics the "Level of Detail" (LOD) systems in game engines but applied to the artistic density of the stroke cloud.53

The moment of alignment triggers a dopamine response associated with pattern recognition. The "reveal" is not just visual; it is cognitive. The user "solves" the puzzle of the chaotic strokes by finding the vantage point.55

## **Implementation Roadmap: Building the System**

To build this system using today's web stack (React, Three.js, R3F), the following architecture is recommended:

| Component | Technology | Role |
| :---- | :---- | :---- |
| **Asset Gen** | PaintTransformer \+ ZoeDepth | Generate stroke params ![][image52] and Depth ![][image30]. |
| **Scene Graph** | React Three Fiber (R3F) | Manage the scene lifecycle and component structure.57 |
| **Geometry** | InstancedMesh | Render 50k+ strokes. Use a generic "brush" texture on a quad.29 |
| **Material** | ShaderMaterial | Custom vertex shader for scale-depth compensation and "reveal" effects.58 |
| **Motion** | GSAP / Theatre.js | Animate camera on scroll. Interpolate between "chaos" and "order".48 |
| **Optimization** | gltf-transform / KTX2 | Compress assets for fast loading. Prune unseen attributes.45 |

**Step-by-Step Construction:**

1. **Preprocessing (Python)**:  
   * Input: painting.jpg.  
   * Run ZoeDepth \-\> depth.png.  
   * Run PaintTransformer \-\> strokes.json (list of 20k strokes).  
   * For each stroke in JSON, sample depth.png to get ![][image10]. Calculate scale \= z \* k.  
   * Output: scene\_data.json containing arrays for Position, Rotation, Scale, Color.  
2. **Frontend (Three.js)**:  
   * Load scene\_data.json.  
   * Create InstancedMesh(geometry, material, count=20000).  
   * Fill the instance matrices using the data.  
   * Implement the Unproject logic to place the instances in the 3D world such that they align with the original ![][image15] when viewed from Camera(0, 0, 100).  
3. **Interaction**:  
   * Bind scroll to camera.position.z.  
   * Add mousemove listener to camera.position.x/y for parallax.

## **Conclusion and Future Outlook**

The transition from 2D anamorphosis to volumetric anamorphosis represents a fundamental shift in digital art. By leveraging Monocular Depth Estimation to provide semantic structure, and Stroke-Based Rendering to provide texture, we can explode a static image into a navigable world. The "Z-axis offset" requested by the user is not merely a visual trick; it is a mechanism that turns the passive act of viewing into an active act of exploration. The mathematics of inverse perspective projection ensure that this exploration always leads to a moment of resolution—the "sweet spot" where the scattered fragments of the world align into a coherent whole. As WebGL and WebGPU continue to mature, enabling millions of particles to be simulated in real-time, the density and fidelity of these volumetric paintings will only increase, blurring the line between a 2D image and a 3D world. The painting is no longer a surface; it is a space.

# **Theoretical Foundations of Anamorphic Projection in Virtual Space**

To fully appreciate the technical leap required to implement volumetric anamorphosis, we must first ground the concept in the history of projective geometry and its digital successor, the virtual camera frustum. The user's vision—a painting exploded in Z-space that resolves from a single point—is a direct descendant of the catoptric and oblique anamorphosis of the Renaissance, but liberated from physical constraints by the infinite flexibility of the virtual coordinate system.

## **Historical Context: From Holbein to Holography**

The term "anamorphosis" is derived from the Greek *ana* (back/again) and *morphe* (shape/form). It refers to a distorted projection or perspective requiring the viewer to occupy a specific vantage point (or use a special device, like a cylindrical mirror) to reconstitute the image.2

* **Oblique Anamorphosis**: The most relevant historical precursor. In artworks like *The Ambassadors* or the corridors of the Church of Santa Maria presso San Satiro by Bramante, the image is stretched along a plane. The viewer must stand at a grazing angle to shorten the elongated lines back to normal proportions.2  
* **Catoptric Anamorphosis**: Uses a curved mirror (cylinder or cone) to correct the distortion. This introduces non-linear warping, similar to the distortions we see in wide-angle VR lenses.4

In the digital realm, we are not constrained by physical corridors or mirrors. The "canvas" can be the entire 3D frustum. The user's "Z-offset" idea essentially turns the viewing frustum into a volume of data. This connects with the concept of **Holography**, where interference patterns reconstruct a 3D light field. Volumetric anamorphosis is a "discrete holography"—it reconstructs a light field not through wave interference, but through the precise placement of occluding geometry (strokes).3

## **The Virtual Frustum and The "Sweet Spot"**

In computer graphics, the "Sweet Spot" is mathematically defined as the **Center of Projection (COP)**.

When we render a 3D scene, we define a camera by:

1. **Eye Position**: The COP.  
2. **Target**: Where the camera is looking.  
3. **Up Vector**: Orientation.  
4. **Field of View (FOV)**: The angle of the frustum.

For volumetric anamorphosis, we fix these parameters to define the "solution" state. Let's call this ![][image53].

Any stroke ![][image54] in the volume is placed such that its projection onto the image plane of ![][image53] is identical to a specific patch of the source painting.

### **The Paradox of View-Dependency**

This technique introduces a paradox: the 3D scene is "false" from every angle except one.

* **From ![][image53]**: The strokes align. Overlapping strokes (in Z) merge to form continuous colors. Gaps are hidden by foreground strokes. The image is perfect.  
* **From Offset Angle**: The illusion breaks. This is the "Pre-recognition" or "Chaos" state. This breakdown is desirable; it allows the user to inspect the *construction* of the image. The parallax effect (foreground moving faster than background) confirms the spatial nature of the work.49

This duality is what elevates the experience from a simple image viewer to an interactive installation. It forces the user to engage in **active perception**. They must "find" the image.

# **Mathematical Derivation of Volumetric Anamorphosis**

This section provides the rigorous mathematical framework necessary to implement the system. We will derive the "Unprojection" vector and the "Scale-Depth" compensation function.

## **The Projection Matrix Pipeline**

To understand how to reverse the process (unproject), we must understand the forward process. A vertex ![][image55] is transformed to clip space ![][image56] via the Projection Matrix ![][image57] and View Matrix ![][image58].5

![][image59]  
The Perspective Projection Matrix in WebGL (column-major) is typically:

![][image60]  
Where ![][image61].

The critical operation is the **Perspective Divide**:

![][image62]  
![][image63]  
In this matrix, ![][image64] ends up being ![][image65] (the distance from the camera).

Thus, ![][image66]. This confirms that as ![][image10] increases (object moves away), ![][image67] (screen position) decreases towards zero.

## **Deriving the Unprojection Vector**

We start with a pixel ![][image15] from a painting of size ![][image68].

1. **NDC Conversion**:  
   ![][image69]  
   (Note: Y is often flipped in WebGL vs Image coordinates).  
2. **Clip Space Ray**:  
   We want a ray originating from the camera. In clip space, the camera is at ![][image70] (or similar depending on convention), but it's easier to work in View Space.  
   Inverse Projection Matrix ![][image71]:  
   ![][image72]  
   ![][image73]  
   The ray direction in view space is ![][image74].  
3. **World Space Ray**: Apply the Inverse View Matrix ![][image75] (which represents the Camera's World Matrix).59  
   ![][image76]  
   ![][image77]

Now we have a ray ![][image78]. Every point on this ray projects back to the exact pixel ![][image15]. The "Z-offset" requested by the user is essentially choosing a specific ![][image79] for each stroke.15

## **The Scale-Depth Compensation Function**

We have a stroke texture of resolution ![][image80]. We want it to occupy exactly that size on screen.

Let's assume we place the stroke at distance ![][image16] from the camera along the ray.

How big must the 3D quad be?

From similar triangles in the camera frustum:

![][image81]  
Technically, ![][image82] is the focal length ![][image83].

So, ![][image84].

In Three.js/WebGL terms, the visible height of the frustum at a given depth ![][image16] is:

![][image85]  
If our painting resolution covers the full height of the screen (NDC \-1 to 1), then the required world height of a stroke ![][image86] that covers a fraction ![][image87] of the screen height is:

![][image88]  
![][image89]  
**Key Insight**: The scale is **linear** with respect to depth ![][image16].

![][image90]  
This makes the implementation highly efficient. We can calculate ![][image91] once (based on FOV) and then simply multiply the depth of each stroke by ![][image91] to get its required scale.6

### **Dealing with Aspect Ratio**

If the window aspect ratio changes, the horizontal FOV changes (in most WebGL engines which lock vertical FOV).

To maintain the illusion on resize:

1. Listen for resize events.  
2. Recalculate ![][image92] based on the new aspect ratio if necessary (though usually Vertical FOV is fixed, so height scales are stable).  
3. Ideally, fit the painting to the viewport (e.g., background-size: cover logic) by adjusting the camera distance or FOV dynamically.60

# **Algorithmic Stroke Synthesis: From Pixels to Geometry**

The user asks for "slices of paintings." This implies we are not just projecting pixels (point cloud) but creating meaningful geometric entities. We explore three tiers of extraction.

## **Tier 1: Procedural Tiling (The Baseline)**

The simplest approach is to divide the image into a grid (e.g., ![][image93]).

* **Method**: Each cell is a quad.  
* **Pros**: Trivial to implement.  
* **Cons**: Looks like a mosaic or "exploding bricks." Lacks the "painterly" feel. The side view reveals a rigid grid structure, breaking the organic illusion.

## **Tier 2: Stroke-Based Rendering (SBR) \- The Hertzmann Method**

To achieve the look of a hand-painted oil canvas, we use the algorithm described by **Aaron Hertzmann** in "Painterly Rendering with Curved Brush Strokes of Multiple Sizes".17

### **The Algorithm**

1. **Layer Generation**: We process the image in layers, from largest brush size ![][image94] to smallest ![][image95].  
2. **Reference Canvas**: Maintain a current buffer ![][image96]. Initially black.  
3. **Diff**: Calculate $D \= |

| Source \- C ||$.

4\. **Spline Generation**: Find point ![][image87] with max ![][image33]. Start a stroke.

\* Move ![][image87] along the normal to the image gradient (isophotes).

\* Stop when the color of the source image deviates too much from the stroke color.

5\. **Rendering**: Draw the spline as a 3D tube or a series of overlapping quads.

**Relevance to Volumetric Anamorphosis**: The splines generated by Hertzmann’s method are inherently continuous. If we assign a single Z-depth to an entire spline, we get long, flowing ribbons floating in space. This creates a beautiful "confetti" or "ribbon" aesthetic during the flythrough.19

## **Tier 3: Deep Learning \- PaintTransformer & Neural Best Buddies**

**PaintTransformer** 20 offers a modern, GPU-accelerated alternative.

* **Input**: Source Image.  
* **Output**: A list of stroke parameters ![][image97].  
* **Mechanism**: A self-supervised pipeline. A "Stroke Predictor" network estimates the parameters that would best recreate the image patches. A "Stroke Renderer" (differentiable) draws them to compute the loss.

This method is ideal because it outputs **structured data**. We get distinct "objects" (strokes) that we can manipulate. We can sort them by size, placing larger strokes in the background (Z-far) and smaller strokes in the foreground (Z-near), reinforcing the depth effect naturally.21

**Neural Best Buddies (NBB)** 61 can be used if the user wants to morph between *two* paintings. NBB finds semantic correspondence (e.g., "left eye of Mona Lisa" maps to "left eye of Marilyn Monroe"). We can use these correspondences to interpolate the stroke positions, creating a volumetric morphing effect.62

## **Tier 4: Semantic Segmentation \- Segment Anything (SAM)**

For a "pop-up book" aesthetic, we use **SAM**.24 Instead of brush strokes, we slice the painting into objects.

* Use SAM to generate masks for "Person", "Tree", "House".  
* Vectorize masks to meshes.  
* Place "House" at ![][image14], "Person" at ![][image98].  
* Unproject/Scale logic remains the same. This creates fewer, larger slices. The "flythrough" feels like moving past cardboard cutouts (the "2.5D" effect often seen in motion graphics), but fully realized in a 3D volume.25

**Comparison of Extraction Methods**:

| Method | Geometric Primitive | Visual Style | Count | Performance |
| :---- | :---- | :---- | :---- | :---- |
| **Grid** | Quad | Digital / Glitch | 10k+ | High |
| **Hertzmann** | Spline / Ribbon | Oil Painting | 5k-20k | Moderate |
| **PaintTransformer** | Textured Quad | Impressionist | 20k-50k | High |
| **SAM** | Complex Mesh | Pop-up Book / Collage | \< 100 | Low (Complex geometry) |

# **Depth Estimation: The Architecture of the Z-Axis**

The user's request "strokes offset on the z-axis" allows for creative freedom. We *could* use random noise, but that creates a "disorganized cloud." A better approach is to reconstruct the scene's actual depth.

## **Monocular Depth Estimation (MDE)**

Since we only have a 2D painting, we must hallucinate the 3D structure.

**MiDaS vs. ZoeDepth**:

* **MiDaS** 30 provides relative depth. It tells us "pixels A is behind pixel B." It is robust on diverse artistic styles.  
* **ZoeDepth** 7 provides metric depth (![][image10] in meters).

For volumetric anamorphosis, **ZoeDepth** is superior. Why? Because the "Scale-Depth Compensation" relies on the ratio ![][image99]. If ![][image16] is arbitrary (relative), the scaling might become extreme or inconsistent. Metric depth gives us a controlled range (e.g., 0.5m to 10m). We can clamp the depth range to fit our 3D scene bounds (e.g., Three.js camera far plane).32

## **Handling Occlusion and Inpainting**

A major issue when "exploding" a painting is **Occlusion holes**.

If we move the foreground "person" stroke forward, the space *behind* them is empty. When the user flies through and passes the person, they see a hole in the background.

* **Solution**: Inpainting.  
* Use **Stable Diffusion** or **LaMa** to inpaint the background layer *behind* the segmented foreground objects.32  
* We generate a "clean" background plate and treat it as a separate deep layer. The foreground strokes float above it. This creates a complete immersive world, not just a hollow shell.

# **The Rendering Pipeline: Three.js and WebGL**

This section details the specific implementation of the system using **Three.js** and **React Three Fiber (R3F)**.

## **The Problem of Draw Calls**

Drawing 50,000 individual strokes (Mesh objects) will run at \< 5 FPS. Each draw call incurs CPU overhead (driver validation, state changes).

We need **O(1)** draw calls.

## **InstancedMesh Strategy**

We use THREE.InstancedMesh.

* **Geometry**: A simple plane geometry (2 triangles).  
* **Material**: ShaderMaterial with a texture atlas of brush strokes.  
* **Instance Matrix**: Stores position, rotation, and scale for each stroke.  
* **Instance Color**: Stores the RGB color of the stroke.

**Texture Atlas**: PaintTransformer outputs parameters. We can select 16-32 distinct "brush tip" images (round, flat, dry, wet) and pack them into a single texture. We assign a texture index to each instance attribute.36

## **BatchedMesh Strategy**

If we use the **SAM** approach (complex arbitrary shapes), InstancedMesh fails because geometries differ.

We use THREE.BatchedMesh (r159+).

* Allocates a massive vertex buffer.  
* Packs different geometries into it.  
* Renders everything in 1 draw call.  
* Allows individual frustum culling per geometry (optional, can be expensive on CPU). **Performance Warning**: On mobile, updating the BatchedMesh matrices every frame (for animation) can be slow due to data upload bandwidth.36 Static batching is preferred.

## **The Custom Shader (GLSL)**

The magic happens in the vertex shader. We pass the "reveal progress" as a uniform.

OpenGL Shading Language

uniform float uProgress; // 0.0 to 1.0  
uniform float uTime;  
attribute float aDepth;  
attribute vec3 aRandom;

void main() {  
  // Current instance matrix gives us the 'aligned' position (Perfect Painting)  
  vec3 alignedPos \= instanceMatrix.\[1\]xyz;   
    
  // Calculate a 'chaotic' position for the flythrough  
  // e.g., add sine wave noise based on depth  
  vec3 chaoticPos \= alignedPos;  
  chaoticPos.x \+= sin(uTime \+ alignedPos.z) \* 10.0;  
  chaoticPos.y \+= cos(uTime \+ alignedPos.z) \* 10.0;  
    
  // Interpolate based on progress  
  // But wait\! The user wants the flythrough to BE the chaotic state.  
  // The 'reveal' happens only at the specific spot.  
    
  // Actually, the instanceMatrix should store the 3D WORLD position (distributed in Z).  
  // The 'Scale-Depth' logic has already been applied to the scale component of the matrix.  
  // So standard rendering IS the anamorphic effect.  
    
  // We can add a "disintegration" effect if we want to morph to a different painting.  
    
  vec4 mvPosition \= modelViewMatrix \* instanceMatrix \* vec4(position, 1.0);  
  gl\_Position \= projectionMatrix \* mvPosition;  
}

**Crucial Logic**: The "Scale-Depth" logic derived in Section 2 is applied **CPU-side** when building the matrices. The shader just renders them. This ensures the bounding boxes are correct for raycasting/frustum culling.29

## **Transparency and Sorting**

Brush strokes often have alpha transparency.

* **Problem**: Incorrect sorting leads to visual artifacts (background drawn on top of foreground).  
* **Solution**: InstancedMesh does not sort instances automatically.  
* **Manual Sort**: We must sort the instance matrices by their Z-depth (from far to near) before creating the mesh. This ensures the "Painter's Algorithm" holds true: background strokes are drawn first, foreground on top.64

# **Interaction Design: The Reveal**

The user experience relies on the *movement* to the vantage point.

## **The Scroll Trigger**

We bind the scroll bar to the camera's Z position.

* ScrollTop: Camera at ![][image100] (Deep inside the stroke cloud).  
* ScrollBottom: Camera at ![][image101] (The Alignment Point).  
  Using **GSAP ScrollTrigger**:

JavaScript

gsap.to(camera.position, {  
  z: 100,  
  scrollTrigger: {  
    scrub: true,  
    end: "bottom bottom"  
  }  
});

This gives the user tactile control over the speed of the flythrough. They can scrub back and forth, watching the image explode and coalesce.47

## **The "Lock-in" Haptic**

When the user reaches the exact scroll point for alignment, we can add a "snap" effect.

* The camera gently locks into the perfect coordinate ![][image102].  
* A subtle "bloom" or lighting flash occurs to signal the completion of the puzzle.  
* The "turbulence" noise in the vertex shader fades to 0.0.58

# **Perceptual Psychology: Why It Works**

## **Pareidolia and Pattern Recognition**

The effectiveness of volumetric anamorphosis relies on the brain's eagerness to find order. **Pareidolia** is the phenomenon of perceiving a specific, meaningful image in a random or ambiguous visual pattern.52 During the flythrough, the user sees a cloud of strokes. The brain tries to assemble them.

* **Hypothesis**: The "Goldilocks Zone" of complexity.10  
* If we use too few strokes (low complexity), the cloud looks like random debris.  
* If we use too many (high complexity), it looks like white noise.  
* The sweet spot (approx 20k-50k strokes for a 1080p image) provides enough density for color continuity but enough porosity to see the depth parallax.

## **The Dopamine of Alignment**

The moment the image aligns is a "Gestalt shift." The parts suddenly sum to a whole. This cognitive closure is rewarding. It transforms the passive viewing of a JPEG into an active, spatial achievement. This is why the technique is so popular in modern web design and creative coding portfolios.66

# **Conclusion**

Volumetric Anamorphosis is more than a graphical trick; it is a reconstruction of the relationship between image and space. By applying the rigorous mathematics of inverse perspective projection to the expressive output of neural painting algorithms, we can create virtual environments where art is not an object, but a destination. The integration of Monocular Depth Estimation ensures that this destination has spatial logic, while high-performance WebGL instancing ensures it is accessible in real-time. The result is a system where the "slice" of a painting becomes a building block of a new, view-dependent reality, satisfying the user's desire to traverse the internal geometry of a masterpiece.

#### **Works cited**

1. Anamorphosis \- Wikipedia, accessed February 3, 2026, [https://en.wikipedia.org/wiki/Anamorphosis](https://en.wikipedia.org/wiki/Anamorphosis)  
2. Exploring Anamorphic Reflections: Reflecting on a Year of AP Precalc | by Melinda | Beauty in Mathematics | Medium, accessed February 3, 2026, [https://medium.com/students-work-in-mathematics/exploring-anamorphic-reflections-reflecting-on-a-year-of-ap-precalc-c7124346d7e1](https://medium.com/students-work-in-mathematics/exploring-anamorphic-reflections-reflecting-on-a-year-of-ap-precalc-c7124346d7e1)  
3. Anamorphic Art: A Mathematical Approach to Optical Illusions | by Chloe | Medium, accessed February 3, 2026, [https://medium.com/@chloe2025248/anamorphic-art-a-mathematical-approach-to-optical-illusions-755fb7a820d5](https://medium.com/@chloe2025248/anamorphic-art-a-mathematical-approach-to-optical-illusions-755fb7a820d5)  
4. WebGL model view projection \- Web APIs | MDN, accessed February 3, 2026, [https://developer.mozilla.org/en-US/docs/Web/API/WebGL\_API/WebGL\_model\_view\_projection](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_model_view_projection)  
5. WebGL 3D Perspective, accessed February 3, 2026, [https://webglfundamentals.org/webgl/lessons/webgl-3d-perspective.html](https://webglfundamentals.org/webgl/lessons/webgl-3d-perspective.html)  
6. The State of the Art of Depth Estimation from Single Images | by PatricioGonzalezVivo | Medium, accessed February 3, 2026, [https://medium.com/@patriciogv/the-state-of-the-art-of-depth-estimation-from-single-images-9e245d51a315](https://medium.com/@patriciogv/the-state-of-the-art-of-depth-estimation-from-single-images-9e245d51a315)  
7. The Mathematics Behind Anamorphic Illusions \- YouTube, accessed February 3, 2026, [https://www.youtube.com/watch?v=fYfxYogwiVI](https://www.youtube.com/watch?v=fYfxYogwiVI)  
8. The mathematics of sidewalk illusions \- Fumiko Futamura \- YouTube, accessed February 3, 2026, [https://www.youtube.com/watch?v=wujEE3PRVUo](https://www.youtube.com/watch?v=wujEE3PRVUo)  
9. AI pareidolia: Can machines spot faces in inanimate objects? \- MIT News, accessed February 3, 2026, [https://news.mit.edu/2024/ai-pareidolia-can-machines-spot-faces-in-inanimate-objects-0930](https://news.mit.edu/2024/ai-pareidolia-can-machines-spot-faces-in-inanimate-objects-0930)  
10. Machine vision meets human perception: Exploring AI pareidolia in object recognition, accessed February 3, 2026, [https://indiaai.gov.in/article/machine-vision-meets-human-perception-exploring-ai-pareidolia-in-object-recognition](https://indiaai.gov.in/article/machine-vision-meets-human-perception-exploring-ai-pareidolia-in-object-recognition)  
11. Vector3.unproject – three.js docs, accessed February 3, 2026, [https://threejs.org/docs/\#api/en/math/Vector3.unproject](https://threejs.org/docs/#api/en/math/Vector3.unproject)  
12. Vector3.unproject() should be Vector2.unproject()? \- Questions \- three.js forum, accessed February 3, 2026, [https://discourse.threejs.org/t/vector3-unproject-should-be-vector2-unproject/43276](https://discourse.threejs.org/t/vector3-unproject-should-be-vector2-unproject/43276)  
13. How To Calculate a 3D Point from 2D Coordinates? \- Stack Overflow, accessed February 3, 2026, [https://stackoverflow.com/questions/28182915/how-to-calculate-a-3d-point-from-2d-coordinates](https://stackoverflow.com/questions/28182915/how-to-calculate-a-3d-point-from-2d-coordinates)  
14. Converting Screen 2D to World 3D Coordinates \[closed\] \- Stack Overflow, accessed February 3, 2026, [https://stackoverflow.com/questions/31613832/converting-screen-2d-to-world-3d-coordinates](https://stackoverflow.com/questions/31613832/converting-screen-2d-to-world-3d-coordinates)  
15. Reverse Z infinite projection \- Resources \- three.js forum, accessed February 3, 2026, [https://discourse.threejs.org/t/reverse-z-infinite-projection/88394](https://discourse.threejs.org/t/reverse-z-infinite-projection/88394)  
16. pschaldenbrand/PyPainterly: Python implementation of Aaron Hertzmann's Painterly algorithm for stroke based rendering of an image. \- GitHub, accessed February 3, 2026, [https://github.com/pschaldenbrand/PyPainterly](https://github.com/pschaldenbrand/PyPainterly)  
17. image \- Stroke detection algorithm in pictures to detect lines and curves \- Stack Overflow, accessed February 3, 2026, [https://stackoverflow.com/questions/59603026/stroke-detection-algorithm-in-pictures-to-detect-lines-and-curves](https://stackoverflow.com/questions/59603026/stroke-detection-algorithm-in-pictures-to-detect-lines-and-curves)  
18. Stroke controllable style transfer based on dilated convolutions | IET Computer Vision, accessed February 3, 2026, [https://digital-library.theiet.org/doi/full/10.1049/iet-cvi.2019.0912](https://digital-library.theiet.org/doi/full/10.1049/iet-cvi.2019.0912)  
19. Paint Transformer: Feed Forward Neural Painting with Stroke Prediction \- arXiv, accessed February 3, 2026, [https://arxiv.org/pdf/2108.03798](https://arxiv.org/pdf/2108.03798)  
20. wzmsltw/PaintTransformer: Official PaddlePaddle implementation of Paint Transformer \- GitHub, accessed February 3, 2026, [https://github.com/wzmsltw/PaintTransformer](https://github.com/wzmsltw/PaintTransformer)  
21. Text Guided Art Generation, accessed February 3, 2026, [https://ucladeepvision.github.io/CS188-Projects-2022Winter/2022/03/19/team02-text-guided-procedure-art-creation.html](https://ucladeepvision.github.io/CS188-Projects-2022Winter/2022/03/19/team02-text-guided-procedure-art-creation.html)  
22. Huage001/PaintTransformer: Officially unofficial re-implementation of paper: Paint Transformer: Feed Forward Neural Painting with Stroke Prediction, ICCV 2021\. \- GitHub, accessed February 3, 2026, [https://github.com/Huage001/PaintTransformer](https://github.com/Huage001/PaintTransformer)  
23. Hi-SAM: Marrying Segment Anything Model for Hierarchical Text Segmentation \- arXiv, accessed February 3, 2026, [https://arxiv.org/html/2401.17904v2](https://arxiv.org/html/2401.17904v2)  
24. Advancing Image Segmentation with SAM: Segment Anything Model \- Esri, accessed February 3, 2026, [https://www.esri.com/arcgis-blog/products/arcgis-pro/geoai/revolutionizing-image-segmentation-with-sam-segment-anything-model](https://www.esri.com/arcgis-blog/products/arcgis-pro/geoai/revolutionizing-image-segmentation-with-sam-segment-anything-model)  
25. SAM 3: Segment Anything with Concepts \- Ultralytics YOLO Docs, accessed February 3, 2026, [https://docs.ultralytics.com/models/sam-3/](https://docs.ultralytics.com/models/sam-3/)  
26. visioncortex/vtracer: Raster to Vector Graphics Converter \- GitHub, accessed February 3, 2026, [https://github.com/visioncortex/vtracer](https://github.com/visioncortex/vtracer)  
27. How to Vectorize an Image in Inkscape \- Tutorial \- YouTube, accessed February 3, 2026, [https://www.youtube.com/watch?v=SNKGPb8r9Po](https://www.youtube.com/watch?v=SNKGPb8r9Po)  
28. How to choose between InstancedMesh and BatchedMesh? \- three.js forum, accessed February 3, 2026, [https://discourse.threejs.org/t/how-to-choose-between-instancedmesh-and-batchedmesh/81221](https://discourse.threejs.org/t/how-to-choose-between-instancedmesh-and-batchedmesh/81221)  
29. \[Test\] Zoe Depth vs MiDaS Depth. Spoiler alert: Use MiDaS. : r/StableDiffusion \- Reddit, accessed February 3, 2026, [https://www.reddit.com/r/StableDiffusion/comments/18kv89r/test\_zoe\_depth\_vs\_midas\_depth\_spoiler\_alert\_use/](https://www.reddit.com/r/StableDiffusion/comments/18kv89r/test_zoe_depth_vs_midas_depth_spoiler_alert_use/)  
30. How to generate depth maps with greater detail than in this (MiDaS) example? Maybe there is some trick with text2img or img2img to simulate depth maps? Tiling does not give a strong improvement. I am looking for solutions to this problem for creating bas-reliefs and engraving. : r/StableDiffusion \- Reddit, accessed February 3, 2026, [https://www.reddit.com/r/StableDiffusion/comments/12dyah0/how\_to\_generate\_depth\_maps\_with\_greater\_detail/](https://www.reddit.com/r/StableDiffusion/comments/12dyah0/how_to_generate_depth_maps_with_greater_detail/)  
31. Depth Priors in Removal Neural Radiance Fields \- arXiv, accessed February 3, 2026, [https://arxiv.org/html/2405.00630v3](https://arxiv.org/html/2405.00630v3)  
32. Learning to Segment 3D Point Clouds in 2D Image Space \- CVF Open Access, accessed February 3, 2026, [https://openaccess.thecvf.com/content\_CVPR\_2020/papers/Lyu\_Learning\_to\_Segment\_3D\_Point\_Clouds\_in\_2D\_Image\_Space\_CVPR\_2020\_paper.pdf](https://openaccess.thecvf.com/content_CVPR_2020/papers/Lyu_Learning_to_Segment_3D_Point_Clouds_in_2D_Image_Space_CVPR_2020_paper.pdf)  
33. Understanding "Convert 2D Points to 3D Points" \- Q\&A \- Mech-Mind Online Community, accessed February 3, 2026, [https://community.mech-mind.com/t/topic/2897](https://community.mech-mind.com/t/topic/2897)  
34. Rendering hundreds/thousands of objects \- need opinions : r/webgl \- Reddit, accessed February 3, 2026, [https://www.reddit.com/r/webgl/comments/rmeklc/rendering\_hundredsthousands\_of\_objects\_need/](https://www.reddit.com/r/webgl/comments/rmeklc/rendering_hundredsthousands_of_objects_need/)  
35. 100 Three.js Tips That Actually Improve Performance (2026) \- Utsubo, accessed February 3, 2026, [https://www.utsubo.com/blog/threejs-best-practices-100-tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)  
36. 20k skinned instances using InstancedMesh2 library : r/threejs \- Reddit, accessed February 3, 2026, [https://www.reddit.com/r/threejs/comments/1hw39vs/20k\_skinned\_instances\_using\_instancedmesh2\_library/](https://www.reddit.com/r/threejs/comments/1hw39vs/20k_skinned_instances_using_instancedmesh2_library/)  
37. BatchedMesh – three.js docs, accessed February 3, 2026, [https://threejs.org/docs/pages/BatchedMesh.html](https://threejs.org/docs/pages/BatchedMesh.html)  
38. Significant Performance Drop and High CPU Usage with BatchedMesh \#28776 \- GitHub, accessed February 3, 2026, [https://github.com/mrdoob/three.js/issues/28776](https://github.com/mrdoob/three.js/issues/28776)  
39. Significant Performance Drop and High CPU Usage with BatchedMesh \- three.js forum, accessed February 3, 2026, [https://discourse.threejs.org/t/significant-performance-drop-and-high-cpu-usage-with-batchedmesh/67324](https://discourse.threejs.org/t/significant-performance-drop-and-high-cpu-usage-with-batchedmesh/67324)  
40. WebGL Shader Techniques for Dynamic Image Transitions \- Codrops, accessed February 3, 2026, [https://tympanus.net/codrops/2025/01/22/webgl-shader-techniques-for-dynamic-image-transitions/](https://tympanus.net/codrops/2025/01/22/webgl-shader-techniques-for-dynamic-image-transitions/)  
41. Building an On-Scroll 3D Circle Text Animation with Three.js and Shaders | Codrops, accessed February 3, 2026, [https://tympanus.net/codrops/2025/02/03/building-an-on-scroll-3d-circle-text-animation-with-three-js-and-shaders/](https://tympanus.net/codrops/2025/02/03/building-an-on-scroll-3d-circle-text-animation-with-three-js-and-shaders/)  
42. On Crafting Painterly Shaders \- The Blog of Maxime Heckel, accessed February 3, 2026, [https://blog.maximeheckel.com/posts/on-crafting-painterly-shaders/](https://blog.maximeheckel.com/posts/on-crafting-painterly-shaders/)  
43. Interactive Particles with Three.js \- Codrops, accessed February 3, 2026, [https://tympanus.net/codrops/2019/01/17/interactive-particles-with-three-js/](https://tympanus.net/codrops/2019/01/17/interactive-particles-with-three-js/)  
44. glTF Transform, accessed February 3, 2026, [https://gltf-transform.dev/](https://gltf-transform.dev/)  
45. Optimisation tips for mobile devices? \- threejs \- Reddit, accessed February 3, 2026, [https://www.reddit.com/r/threejs/comments/xfi5pq/optimisation\_tips\_for\_mobile\_devices/](https://www.reddit.com/r/threejs/comments/xfi5pq/optimisation_tips_for_mobile_devices/)  
46. React Three Fiber tutorial \- Scroll Animations \- YouTube, accessed February 3, 2026, [https://www.youtube.com/watch?v=pXpckHDDNYo](https://www.youtube.com/watch?v=pXpckHDDNYo)  
47. Animate a Camera Fly-through on Scroll Using Theatre.js and React Three Fiber | Codrops, accessed February 3, 2026, [https://tympanus.net/codrops/2023/02/14/animate-a-camera-fly-through-on-scroll-using-theatre-js-and-react-three-fiber/](https://tympanus.net/codrops/2023/02/14/animate-a-camera-fly-through-on-scroll-using-theatre-js-and-react-three-fiber/)  
48. \[1906.09740\] Gaze-Contingent Ocular Parallax Rendering for Virtual Reality \- arXiv, accessed February 3, 2026, [https://arxiv.org/abs/1906.09740](https://arxiv.org/abs/1906.09740)  
49. Gaze-contingent Stereo Rendering for VR/AR | SIGGRAPH Asia 2020 \- YouTube, accessed February 3, 2026, [https://www.youtube.com/watch?v=SEDYJEe5v90](https://www.youtube.com/watch?v=SEDYJEe5v90)  
50. Gaze-Contingent Ocular Parallax Rendering for VR | TOG 2020, accessed February 3, 2026, [https://www.computationalimaging.org/publications/gaze-contingent-ocular-parallax-rendering-for-virtual-reality/](https://www.computationalimaging.org/publications/gaze-contingent-ocular-parallax-rendering-for-virtual-reality/)  
51. Pareidolia \- Wikipedia, accessed February 3, 2026, [https://en.wikipedia.org/wiki/Pareidolia](https://en.wikipedia.org/wiki/Pareidolia)  
52. Rendering large numbers of meshes (objects) \- Stack Overflow, accessed February 3, 2026, [https://stackoverflow.com/questions/1458835/rendering-large-numbers-of-meshes-objects](https://stackoverflow.com/questions/1458835/rendering-large-numbers-of-meshes-objects)  
53. How can I optimise my THREE.JS rendering? \- Questions, accessed February 3, 2026, [https://discourse.threejs.org/t/how-can-i-optimise-my-three-js-rendering/42251](https://discourse.threejs.org/t/how-can-i-optimise-my-three-js-rendering/42251)  
54. Expectation key to seeing faces in 'noisy images' \- Goldsmiths, University of London, accessed February 3, 2026, [https://www.gold.ac.uk/news/face-pareidolia-/](https://www.gold.ac.uk/news/face-pareidolia-/)  
55. Pareidolia: Primeval Awareness or Generative Biological Intelligence? \- PhMuseum, accessed February 3, 2026, [https://phmuseum.com/projects/pareidolia-primeval-awareness-or-generative-biological-intelligence](https://phmuseum.com/projects/pareidolia-primeval-awareness-or-generative-biological-intelligence)  
56. Introduction \- React Three Fiber, accessed February 3, 2026, [https://docs.pmnd.rs/react-three-fiber?ref=trap.jp](https://docs.pmnd.rs/react-three-fiber?ref=trap.jp)  
57. Morph Image Particle| Creating a Particle-Based Face Transition Effect \- three.js forum, accessed February 3, 2026, [https://discourse.threejs.org/t/morph-image-particle-creating-a-particle-based-face-transition-effect/78794](https://discourse.threejs.org/t/morph-image-particle-creating-a-particle-based-face-transition-effect/78794)  
58. How to construct an inverse view matrix? : r/GraphicsProgramming \- Reddit, accessed February 3, 2026, [https://www.reddit.com/r/GraphicsProgramming/comments/14l9af7/how\_to\_construct\_an\_inverse\_view\_matrix/](https://www.reddit.com/r/GraphicsProgramming/comments/14l9af7/how_to_construct_an_inverse_view_matrix/)  
59. How can I Make my Scene Unscrollable/100% Fitting? \- Questions \- three.js forum, accessed February 3, 2026, [https://discourse.threejs.org/t/how-can-i-make-my-scene-unscrollable-100-fitting/62337](https://discourse.threejs.org/t/how-can-i-make-my-scene-unscrollable-100-fitting/62337)  
60. Neural Best-Buddies: Sparse Cross-Domain Correspondence \- Kfir Aberman, accessed February 3, 2026, [https://kfiraberman.github.io/neural\_best\_buddies/](https://kfiraberman.github.io/neural_best_buddies/)  
61. Neural Best-Buddies: Sparse Cross-Domain Correspondence, accessed February 3, 2026, [https://www.cs.sdu.edu.cn/\_\_local/9/FB/73/D0C0449DC3AE5B5F2922F86E912\_80EEC0B0\_3E8459.pdf](https://www.cs.sdu.edu.cn/__local/9/FB/73/D0C0449DC3AE5B5F2922F86E912_80EEC0B0_3E8459.pdf)  
62. 3D Photography using Context-aware Layered Depth Inpainting · thygate stable-diffusion-webui-depthmap-script · Discussion \#50 · GitHub, accessed February 3, 2026, [https://github.com/thygate/stable-diffusion-webui-depthmap-script/discussions/50](https://github.com/thygate/stable-diffusion-webui-depthmap-script/discussions/50)  
63. Rendering 100k spheres, instantiating and draw calls \- Daniel Velasquez, accessed February 3, 2026, [https://velasquezdaniel.com/blog/rendering-100k-spheres-instantianing-and-draw-calls/](https://velasquezdaniel.com/blog/rendering-100k-spheres-instantianing-and-draw-calls/)  
64. Scroll Driven presentation in Three.js with GSAP | by Bandinopla \- Medium, accessed February 3, 2026, [https://medium.com/@pablobandinopla/scroll-driven-presentation-in-threejs-with-gsap-a2be523e430a](https://medium.com/@pablobandinopla/scroll-driven-presentation-in-threejs-with-gsap-a2be523e430a)  
65. Creative Coding: Spring 2021 \- Medium, accessed February 3, 2026, [https://medium.com/tylerdi/creative-coding-spring-2021-d5a88a325531](https://medium.com/tylerdi/creative-coding-spring-2021-d5a88a325531)  
66. I Built an Awwwards-Level Portfolio to Land My Dream Job (Here's How) \- YouTube, accessed February 3, 2026, [https://www.youtube.com/watch?v=\_BZZkFzuLQs](https://www.youtube.com/watch?v=_BZZkFzuLQs)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAQCAYAAAD52jQlAAABE0lEQVR4Xu3SsUtCURTH8TO0VRAILW4tkjiFREJDW1GDaUOF0dLoYEOQOFQkRDS4SIMamLa4BO0uQVBzizQG/QnOQd/rPfZuolDv4dYPPnDOufKenPtE/jOOLOENbUR1lkEHu/0f+ckF8k6/LfZlgZJF2elPnNp3krjXeh8R58x34njBNM5+HvlPGB9i9zqrM7MS8+9zuENC52uoo4lFnR3gFFfa9zKBTxw5s008I4SY2AfP41bPTd3S+hELONf+O6+YcfopPGmdQhWX2NHZhnj3YC72XX6xuhVca13BOm7EW0MDqyhhWewK3S9oaMx+a2L3VNCZudAiDsV+JSZ7OEYakzobmQfMDQ6DZAtdsW//c74A9RMpm/QqazwAAAAASUVORK5CYII=>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAVCAYAAAD7J7IFAAADVElEQVR4Xu3bbciOZxzH8f8mZTEPC0lsMrIXipISkSJPU8pqphEhRZ7lodZ0xzBknmMmYqImT3ujJi/EaCbFlL1QpOQFebu3/r/+x+E6rzP3fXW7brUu30/9Os7jOK678zyv64V///NkBgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0Jjae37yfO+55OlWvV23dp5dnqFp/oHnrGf060/U53PPucL8M4v76VtYawvPC8d7PbcL83dhoMU5jnv2lfYAAMB7aH0aT3sWFNbvp/GTwtrbWOlZ7OnoWeHpUL3dIhV4tazyDPYM8yws7WXjywuttKRwfNgztjCvZZbnYWntpadLaa0sX/Mzz47iRgv6WOV3AwAADeRCGu96Pi6snykc12O1Z6tF4fZFaa9eH3rWeCZ7mjzfVu1WqJNYj0/TOMFzz/NRYa8WdQF/K639VZqXqTPZ1aIT+bs1f19v0la/GwAA+J9QAfW4MFf360eLjtgpi4LhqGeA56TnB8+h15+urb/nK88Vi6Jpk0WRtduzweIRrLpXKroue/p5Tlh0yqZ6Dli1GaX5PE93z8Y0v5rG79LYy+Jxb/ZzylKLaxvpmebZnvb1KPVOOi772uJR5Z401/ey3HPE4vyb0/o6i+9O3+Uxi2saY/H3OncPz6L02Wx/ad5cp1DfTf5OdLzTogPaZFHY6Z50bgAA0ECue/5Ix/qH/0Fhb1Qa8/6WNLbm/a1HFkWF3o9r8vyX1ielcbZFJynLxciLNC7LG83Qu2UzLd5bUzH0b1pXJyxT9022edZ6Rlil46bOl+57bpqXDfHcsOg89vbMt3gkqkJTRahGdctUXKow/NOiSNS5blkUxNcsnLc4t6hobY7u+alV3idUwStT0tjZouDNnqRRhbbW8+8GAAAakAoSFVaiQmO4RccrP2JTB0wv9d9M83qouNFjv56eLwvr6k6Jig/5NW+0kooevTMnv3jGWaULp+IrP5r92/ONxXW0lgqxiRZFkgpNdev+SXsqavO7ZPpPCvqcrkHnHmTV91yLvgv9/Zw0V1fxYDru5LmYjqdbXJN+NwAA8B5SEaBHgG1BhZrel6tFnSJ1zQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAaBCvAFXOdFYVJ4qBAAAAAElFTkSuQmCC>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAQCAYAAAAFzx/vAAABUElEQVR4Xu3TvyuFURzH8W9KGfzIKAaDwi1FshlkEYrBYLBciyIJSYQUiyIMfk033ZRJFKWkDERsBlmNJv4F76/v93k6XXWHpzvdfOrVPed7z/M85znnPCL/KZaUYhvfWMEmrlEdDip0unEW9A8wHfQLngWsBf1TbOELVUE9SS7EVu1PccDb+oBXVOA5HpE8UxjJLX6KvZHu4TIa0YzjYEzSnKAhLDThIyx4RjHu7TLsY9dFNT1sG5hACeaxjkukfNyL/8ZJI5tbJIdo93YGLd7WGWt7D60+Zg6zmPExj2KnvxbnXvvNIB5wg7bwD/IkNutKsT2NojfrwntQ0+ib6Grpm995bQiL8Yg8KRe7qB/1uPK67q1OUGeu32oUfdCbtzuxgx6x5e71dt7oA28x5v1VTIp9OjVe05kvYRgdYodOj/8R7tEnttS6HXV+TZHnB+MrN0fQ8k5SAAAAAElFTkSuQmCC>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABcAAAAQCAYAAAD9L+QYAAABPklEQVR4Xu3TvyvEcRzH8XeiGCRMJL8iRpJJDOoWcqSkTAaTiRgICxKRDLpMBomr64qJGCklixKr0eZf8Hz7vO/u7XIMd2Xxqkf3eX/en+/3+7nv507kP3+VEuziHSvYxgUq/aJ80o+kq2OYcXVeWcCqq08x5WpNHZ4wZHUVzjPt3DlD1MYVeER5pp1OQsJDUml045x5w46Ed76Mtq/tdO6zJ35LO16zJ0mphIPexDSacWK9XhxiBC04lrCxdRzYms9M4shPWPbRgS7MYwKz1huT8A31cxCj2LKenpduWIZxiyt0WlOjh/Xias0eelyt15TZeAMDNn5AvY2/Ta2E33oqupMbdKNBwkHq4Uasf40a693Z3I9ZxBLGJdw0jjUUoVXCzftQjGfM2ZomvbhQ0Qfr4RY8+l/Qd3+Jat/4AC/7L/PaTRj/AAAAAElFTkSuQmCC>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAOCAYAAABdC15GAAABW0lEQVR4Xu2TzysFURSAj59FSVKilAVZKiykkJSSUpSk/CgpERJLFlYKGxRWyivJisROibKwUIqN/8Df4TudO+bO9R693kq9r75m7jln5szMPSOSJ0+e/08xbuIeruA11iYqjHo8wl233sfGOJ1gBD/xDE+CXEQ/XuAoluOlWI97v0jpwUqcxUXcxupEhaFN+/DUrV+wKE7/oAJvsSVMOMZxCaexW+yFlYPvioAUtoXBgC0cxip8CHI+Zfgs9nV+4wbrcFnsgZXVOG1MYCu+Y4lYYaHYNuvFPlcuPiD2pZV0dbqt61ggtpWK9tC1z5M7HmIHNuFgnDYWxGZFG86INVcm8dGdR+iMHuMdDrlYWNeJb3iOr9ju4h8SP2yEbueG2H13cC2Z/psp77wB57FUbJD1GOHXZUJ/gN4wmAs1OOatm8X+9BR2efGwLhNzknypnNFBD2cmHdnUZc0XXgUvmNpdwJ4AAAAASUVORK5CYII=>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAANCAYAAAD12g16AAABaUlEQVR4Xu2VPUsDQRCGxy80VlaiaLGmEK38aLSwtjSdpIiIIgoKgqWIgiIIFjaCYCEItkLQVlAD1lZW/gAbOxtb32ETnJu7vbt1myB54CGZdzcHs5vbJWrR4t+yCod06KAXzuvQk3a4UP8MYRDOinoPtok6kVF4rEMHM/AGPuoBD/rhBfyEnWrMhyX4AA9FNgHXRZ3IGZzWYQqGwhpu8E5hDTPLFG2YuVZ1jDfYpcMUDDV3w/wPdPbTAV91mIGh5m54l6LvdYQCrIq6B+4nuC3mGPgk6iT4PdLPYPvEHG7YuRNgjOK/Z0tiDjd8JGpmEa6pLMKdDjIwsCbqAbKnpS/ccHf9Oy/0uBjLCzesD9xNsgeak1sdpDAJz+EH2dXma6UCn8WcLHiXD+AXPIFFOAK/yTaeF97pe/gCV0R+CudEHeOK7N0aQuqK5qRMvzsewiVlPGcKbujQA75X+b0JZUsHf2AY7uiwwQ9usjOZOtXtxAAAAABJRU5ErkJggg==>

[image7]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACIAAAANCAYAAADMvbwhAAABLElEQVR4Xu2TP0tCURjGXzTpz6SLEE46RCEIiYNzS5sOLi4RtjS09AUKrKCtUXDwG0RRU9Caq5OTX8GtxdXnvfee2+m5rzdwC/zBj3vOc+55ee/hXJEN/4ALWIrGGdiKnmnswyaHBNdqwNOf5d8cwIdoXIQDOIdb8RtJzuAn7POCx6paT3Dbm8foQp2ymaQ3opxLeiMOrtWR8JQSTGGOMt5ssW4jh2Lsy8IJh5LcbLFuI3pfXrx5wC585VDCzXxKjDZyx6GBVeuD5gFvHEi42V2oHXjkrTm0EXfJFT1y/TDGr+UY0zzg2Rvn4S38ho+wAstwIWFDjjZ8h1+wF2VDeB+/YddStCnzREZwj0OiK8mvstDf+i9q8JpD5RheckhccWBwAqscGtzAgh8sAUjTKt4yn+14AAAAAElFTkSuQmCC>

[image8]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAAPCAYAAADHw76AAAAAUElEQVR4XmNgGKyABYjrgbgfiPOBeAMQS+CVsANifiBOBuJsIO4AYmGQBAwsAGIjZIFoIDYE4ktAzArEEUDMBJLIBOLFDBAjEoHYA6qBWgAAmHkLFQW0zzcAAAAASUVORK5CYII=>

[image9]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAANCAYAAACKCx+LAAAAS0lEQVR4XmNgGKzAC4gXAXEwlL8FSY7hABCLAHEQEDciSxyH0m0MEBPgYBkQVwLxHSAWhAm6A7EjEKsB8WKYIAiALG2GCkogS2AFABisCiCBhAqTAAAAAElFTkSuQmCC>

[image10]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAANCAYAAACKCx+LAAAAOUlEQVR4XmNgGMygFYjvA/EiIM5DllAB4ltArIYsyAnEZ4HYCYiFgdgYJlEGxJuA+CgQb4BKUhMAALaAB6f3hnrRAAAAAElFTkSuQmCC>

[image11]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAOCAYAAAASVl2WAAAAW0lEQVR4XmNgGC7AFYiXA3EIEHMB8VoglgHivTAFEUCcA8RxQGwLxBOg4hNhCkBgExBLAnEuA0QDCBQipBkYDkPpKUBsDsQqQOyFkIYYVw3E+UDcCcRFyJI0BgCFDAvEUSz9YwAAAABJRU5ErkJggg==>

[image12]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAU0lEQVR4XmNgGAUDA1iAeDcQHwXi7UBsjipNGAQC8XxkAQ4grsWC85DUBADxCSDmRBIjCDSB+AoQSwGxMRALoUrjBmuAeA4QPwDibiBmRJEd/AAAfOELe4S79qkAAAAASUVORK5CYII=>

[image13]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACoAAAAOCAYAAABZ/o57AAABGElEQVR4XmNgGAWjgGEuEB8C4logngnEX4FYDkUFbYAkEFsg8bWBuA+IG4DYHkkcDuYAMQsQMwHxDiBOQ5WmCYgF4t1A3IgktguIWRkgblmHJA4GvAwI13cB8XIkOVqDeAaEQ0EOvIUkdxGJjQICgfgqEPOgS9AQIDtUjAHVoXcYsLhFFYifMUDSCCcQC6BKgwHII6A0jI4LkBWRCJAdKsyA6VBQbMMBOxCfB+JEKD8UiKUQ0mQDDQZMT4GwP5IakEOboGxQuryNJHcTiQ0GHUA8C4k/FYmNDHCFaBmyIhIByKEtSPzNQMzPAIlRlMzkBsS/GSCK64H4BBBPRFZAQwAK2U1AfIQBEZsGQNwNxBMYIMlxFIxsAADPDC72SCyAIQAAAABJRU5ErkJggg==>

[image14]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC8AAAAOCAYAAAC/10U/AAABKElEQVR4XmNgGAWjgCIwF4gPAXEtEM8E4q9ALIeigjZAEogtkPjaQNwHxA1AbI9HDAXMAWIWIGYC4h1AnIYqTRMQC8S7gbgRSWwXELMyQNyyDo8YHPAyIHzUBcTLkeRoDeIZEI4HOfAWktxFHGJYQSAQXwViHnQJGgJkx4sxoDr0DhArYhHDcJ8qED9jgKQvTiAWQJUGA5DnQHkCHRcgKyIRIDtemAHTofJYxEApBQ7Ygfg8ECdC+aFALIWQJhtoMGB6FIT9kdSAHN8EZYPS9G0kuZs4xFBABxDPQuJPRWIjA1whX4asiEQAcnwLEn8zEPMzQGIeljmxiYGBGxD/ZoAYUA/EJ4B4IrICGgJQDGwC4iMMiFg3AOJuIJ7AAEnKuMRGwSggBwAAk+Q745yIoWQAAAAASUVORK5CYII=>

[image15]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABkAAAAOCAYAAADaOrdAAAABGUlEQVR4Xu2TO0sDURBGr2gQrVV81bailWCqtCIWgoLEFCFEsLPzAUJAUgixVlAQRRuFkMYmjV06q/wgz+ze4OQzSbG2HjjsznfZZe7s3RD+yUgZlzTMwAWOaWis4JWGGVnFqobGDa5r+AceNTC6mIv32/iEu7F+jldlFhtYxwVsuzV7pve+hHH8cvUBnmIJl/HDrXl2sIAPsb51a2e44eowhU0fwCfO4D7W+pf6sO+4F+/9d7Cs4uqEltSdeLVxWMdbOB/SsXjecDGkXa+5/BgPXZ3wLvU9XuIr3oX0aBdDukOPdf+Cm5JfY16yZK7TGg7gV3dDsMYmNbStHmkozIWf+Y/CDsuJhj1s6zb3YdgBGfgnC+c44YNvsD4h68Ym79UAAAAASUVORK5CYII=>

[image16]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAANCAYAAACKCx+LAAAAVElEQVR4XmNgoBmwBOJ7QKyELgECZ9EFQEAEiDcjCzQA8SQgXgTE1TDBXiBOg7J3AjEfTGI+EJsBMT8QHwdiNyBmBkn4A/EKIF4JxLuBOB2qgVoAAGrLC22sZDcOAAAAAElFTkSuQmCC>

[image17]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABcAAAAQCAYAAAD9L+QYAAABJklEQVR4Xu3SsSvEYRzH8a8TmzizSVekblDqFqUMYrmzXCYluQ3ZGIgMR0gyXDFIZ7Ag0nUyymJRyh+gLLf5F7yf3/erezz1k7pB6j716p7n8/y6e57ndyLN/FXasI8PrGEXVST9hxrJKC69eQlL3ryhrGDTm59jzpvH5QgnYRnmGlkbd+IFHfXl2MxiISzD1LAneuer6Pu+HJsDZMLSTz/ewpKs4xDTOJP6yXpF38+W6AnbrZ8XfVfbNo8yg7JfiH6B29EzEpjEsq3dYUj0+h6sm8IiWkU3EiWHR9xj8Ku0jGPHxu6vOowuvFs34q27TfTY+Fdxd+9+3OUJaYzhxroN5DGBV7RYP2CfP+YC3Ta+Fb1Ld+wKjnGFU6REr62IguiJ/3E+AWiOLSbyCNHFAAAAAElFTkSuQmCC>

[image18]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAOCAYAAABth09nAAABXElEQVR4Xu2WTysFURiHX/Ln+hPKTZbDzg4lGyl3IUosELGSUrKwY4XYsKOUtfIFfALyFSx9ABs7G1vP6czhzOvMNcxwS556mjnnPTPNb86Z04j88/cZwyNs0oWCaMBDrOhC0cxhWXemUI+z8bEarTjptbtwyWv/CFmD9OAFPol9y2mM4hXeeH25g4zgLu7hgqo5sgZxPEj1IIZIMgQxNznAU9zGa+xNjLAs4gzW6YKiZkHGsRPXcQtPsDsxQqQDV1RfGjUL4rjEYd0ZY9bpmdgl5ZxPjHjHD7IhyWuc5kEcJkij1w4R4a3XDgZZxSG8F3vDZfm4i7RJ4MIUvjMjzfF5CQe8miPCO68dDLIpdlcwS2oNp5LlNyZii/pGzMPs4zMeYz/24YvYQI5BPMdHsbNpXnIwyFdox2nckeJ2LY1ZEW6G0sgdJAt5g5gN5zN+JUjeX5QW3aEI/qK8AnhSMMeO80NcAAAAAElFTkSuQmCC>

[image19]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADEAAAAOCAYAAACGsPRkAAABTUlEQVR4Xu2WvUpDQRCFp7BQ0EKIothZiBDE1tZ/sBG0SmGCFpbWWqj4W/gGgpWiDyB2NhaBlGLvw3gOu2vW2Yk3JBsC4gcfyczkJjnZezdX5J+/ywlc1c2MLMML3czNnm78wiRc0E2DeTgd1fvR857Qbogd+ArP9EBxBd/FrUCg4xAj4r7gsXfs5/ibdkOQmhSHIHdSEGID3sNtX79Es8AwPIXjemDQlxAVeCjuw6fEDsHZgG62oC8hyBsswS2x3/RGmqdRkK+3CCFmJT2Gbvo5YYjzqG4FQ6xEtRmi4R+vxZ1emqr0biUuo5rBh6I6wBBrUW2GeIJH8BOOqhkZFHdgzmuCK/IM63DX924l/Q84gB/wES75XhJiHS7CGfigZpo5ae5QOXYnC269RSQhuCsxPQNMqFkndBOCv3RZNw2SELnp5rbDuh40yW3HFy3GNAsbEKiCAAAAAElFTkSuQmCC>

[image20]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAQCAYAAAD52jQlAAAA9ElEQVR4Xu3QMUtCURjG8TeEUHSJRgWHQrQ1aCyIwIgIQdBFRzdpCApqa9AKzKAgaAoSGppEWsQpoobAJqcQ/Cr9L+cZ5KANboEP/Ljvec49F841m2eeWVLC0C/HU8MITzj09qZlBS9+6SeDHmL+xpTkceyX41nFD1Jal/GMAi5wrj6MR1zhDZvqq7jHpdYWQR/bWMY6dtTFsYRXvXuGI82f5s4Wzf2yEFrasxN08IG2uQ9HzR0KksOp5i+ksYh3dd9IaP4zW7jW/IANHGCgLrjVLbLqFtSv6TkxwRX3Nd+giSQauDN3zS72zN2kjgp2deaf5BfRMSXtineShwAAAABJRU5ErkJggg==>

[image21]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAcAAAAPCAYAAAAoAdW+AAAAbElEQVR4XmNgoDmwBeJFQDwBiKuAOAQmwQHEG4GYCcqfCsTqMEkTIN4E4zAg6QIBESD+AMS3gbgciJmJlgQBBQaIxCEgTocJghwRCOMAQSwQF8A4ukDch5ADe0MWxolngEi2AXEFEBvDJGgEAKbCD/G9TUnlAAAAAElFTkSuQmCC>

[image22]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADkAAAAQCAYAAACsu9d7AAACbklEQVR4Xu2V64uNURTGH/fLJKE0ci2FfMFopqZcIiK5RigmIWbGaJRmyKUkdzHkVj7IlKKQS8n9Mi75YOKDlC/+GM9jrdfZZ40zThNlcn716+yz3vc9Z++119ovUKJEiX+VTXRkDHYzBtEdMZgxgR6OwW7KNjoxBkULrYjBLrCefovBP8wI+pJujBecofR0DIovtI+Pe9MD9Axs6+/Rcr/2O8bTmzFYgFH0Ij3p38/Cni+Gq3RKDCbciIFe9FPyfRYdTDfTBnqcDkuud8ZK2hyDBVhB58ImLNphcymGd+j83ju0ZxoYQO+mAacV+SVcQ6/T1fQYPejx/rCJnqCvYUkS2+klWJIKcYQup0PoK9jBd5nuohvoYzrG710C26Gj9JHH9N9qNf2HejHjPOycyeN+Ml5Hp9HPsBJeC8vKPPoRNhFN6oHfv5fu9PF7WNLW0EZYtq/5NZW8+ilFGVd8IWyi8+kq2CSFFlANOzW/0n50KT3k1y/QqXQ6bfKYUDKy5PzkdjKuh01Mf6rm1gREGWwRQtnf4+MPdBLtS996TOWvnkvRodQWYup57fZT2E4J7dRiH7+BLWwZcsna79d1wGjhv0LP5ZWruEIHxmBgNnKnlkqqCpZVHVpC/XWOLvBYD49P9k+hks8YS+tgyXnhn+IZbAGjYTut3tX5oJ3Sbz6HVdoc5MpWKNEZWk8H9FBtDAZUklmGdfKqlDTRU7DyUqaf0EWwndaObEGuEobD+jlDPaPfaaUzkrgWLFQJWoR6bRx9SG/BkqB3ut4CqqZ9sPao/PGU7fpMH3dgK4p/VXQF9Wq2u38LVePuGPwv+A4y/1/zekLnAwAAAABJRU5ErkJggg==>

[image23]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAWCAYAAAB9s8CrAAACXElEQVR4Xu3b0cvOZxgH8HvNjDWG1aS0bKWcqR0oJsyGnLBaTWuZaG1TpKRFoXcHW2FpW+0AB8IJZSbKAcnJypHmP+K6/O43t7vXw0u80udT3+7rd93P+zzPe3Z1/35PKQAAAAAAAAAAAAAAAAAAAAAAAAAAvGp29Y3Gvr7RGGvq5ZGPm+t0t6m/b+pR3oj8HTneb4ywoG8AALxu5veNxuq+0ZhoUJre1OeaekZTj/JlXf99pPt4WyM3+iYAwMv0a+SXyMZ+o3Gnb0zCt3V9M/JPrb+p67gPIsdq/Vbkv8ihyMXaG4ucjayN3Iysqf2/Ir/VOn3e1GlNd53m1PXWI93RtvUNAICXZW5kceR8GX3SdbVvVJ+UYbBq0ztc1yWR/2v9aV0X1XVz5FRkWr3OIXJF5HZkZeRy5Pe6l9913MLIe831z02dn5dD4ESne59FjvTNEQxsAMCUWRo5GVlVhgHnz8jXZTjhyme9clBK68pwy/HdyI7aS08zsP3U1PneOSRuqtc/NHsfRraUYWjbWYYBLt//dGRZGYa3jyKXyjBcrh/+7MH+V7XO/2XcgcgfZRjqWu/UtLdWn8TABgBMmRyEjpbhFCwHtBzUZkWu1f3xgWp2eTgUTdYXTX0mcrAMz4Wl9jZsDlvfleG75FB3ogyfn6dveaqWz5HNi1yvr99b1/wBQb4+5ZDWmugHDbsj92qeRn7+lcj2fgMAYCrk8JbyYf4NZRiULkR+jLwd2V+GU7LJmtk3XoB8Rg4AgGe0p2+E9/vGc2pv1QIAAAAAAAAAAAAAAAAAAMBzug/u5ESieMyGaQAAAABJRU5ErkJggg==>

[image24]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAWCAYAAAB9s8CrAAACiElEQVR4Xu3cy6uNYRTH8eUSck2dQonEiEKcZCq3SC4JKbmGE0pRLolySYSJUkaEchsJAzEwUUbKxNx/wvr1rKfevdp7287Zp6Tvp349+13vc9p7z1brefcxAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwL9qTC6ERbEebam2+pALVvZ/T7VpntOp1s0uzwvPQL7RwRzP6lwEAAD4HxzIhYaTsa5qqbaanwtW9j9rXJ+K9USj1s0sz1nPGc/NdK+TT56ruQgAANBPTz07Pe/zjYZvuTBCcz2f4/UhzzzP7bie7dkXr/XZ1DipIdI07rrnrpXpV22o1nquWJmiaf/92D/O89MzNvZlS3PBynss8VzzXEr3OlHjScMGAABG1QXPYevesL3LhbDCczmlF2usNFZqkPZ4Fng2x72DVo4x5YdnhpXPpqmbGrOLnm1W/n6h57XnnGdD7FczWL/L41il2bht9wxZee923lhp+HpBwwYAAEbd11jVMK3z7I5rNVNqXGS9Z5JnqpXmrhpuw7bYcyteL4/1WKx7Y1UDds9K06VnxDSRG29lAiZa73g2eT5GTftF+zU1XBnXoilepSNP7VWzl9XJ3fGWamdq2G7kIgAAQD89tzK1mhnXmm7VB+5rEzXdSgPULxOtPNgvEzz7rTy8L3W6pqZqi+eBlQmW3v+hZ2Pc3+EZtHIM+ihq2i/ar+/zJK4lH422+z7LPL8iOhbtxVvPl1wEAADoJz0XVh/UVwMkaobUGL30vLIybVKTpePTOoEbqfqDgKYpufAH+mxHcrENHaECAABgGPK/9diarvthsud8LgIAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8Hd+A7tzTf7YJvSLAAAAAElFTkSuQmCC>

[image25]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACEAAAAQCAYAAACYwhZnAAABjElEQVR4Xu3USyhtURzH8b9XyDNJkZBSypjyKCOSknRTmHgMSDK4oxvyKBKiUBS53ZJcjwkZIDPvSCYYGhrdqdGd+P77r9PZZ0cGJ0bnV5/O2v+11j57r732Fokkko/zG6cYxgpekRcy4huyhlhE4wjdod1fnxRUu/YM/nr6wk0uHtDgq5fjGYW+ujThEcn+jjCzK3Yx/tz5C0V4QQkSkR7aHVZu/AWSiQNvIR736HTHzchBP/bFlqwCI2gUe2SaAqxjSWwP/cAGBsXm6Q3p3E03XjOGRbF5Q566TGHVc6wnjUIrdpAvdmL9kySx8bpaJ0hwc57EHucy6sTeMr2RNvx0Y6qw59qzqHFtqcV/TGAU11hwfXG4dG29mGxkoAP1YherScU/176Q4IVp5lHp2nMSfOuOxeZ9mmIJrtCt+21BFtrxy9W6xFZHN/S5qwVyhlKx1fyDMqThSmwBYoJD348OOEQvJsUeie4JjW4srfVhQOwbo/tm2vUHsoVxse+PztXjbbFH2eMZF4m8AVdrP4hwv7v0AAAAAElFTkSuQmCC>

[image26]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAWCAYAAAB9s8CrAAACLklEQVR4Xu3ay8tNURjA4UUYMSAUZUJKwsBtgKHcIrcwIUkptwkjcilF7jGQKLdcEgNRJqSQ29QfYOrv8L7WOtmOCZG+j+epX2fvtc853/lmb2vvUgAAAAAAAAAAAAAAAAAAAAAAAAAA+B3Dok/R4ehWNPz7y3/NruhidDw62XcNAOC/d7m9vojWdC/8RWeiIdHkUn8HAAAd50vd1VrSf+EnTehf+EUPO8c5tOX3jSn1dz2J9kS3S919OxDdiNa295yKdra1C9HWUuX7rrVjAIBBL4ekbGj/hT8kb7f2ykGr3+f+hfAoGh09K3XX71U7/xitjA5G96OR0d5oc3QiWhbNL1UOfAAAg15vR2piNCIaH81sa71BaHW0ITrU1je118fRguh9tDja2NZz+OvqDmy9z3bd6xxvaa/53blLti5aFJ0rdYdtfal/b1b5dut0evQmGtXOb5b6bF6+b1Wpu3BpWnS9Hd+JtkdHooVtDQBgwMlh5m00o9QB51i0onN9dnS2c567Xd3X59HyUne7Ug5MY9vxr8hdshyq8jm2nqfR3ehBtK/UXbW8dTqu1N23/F2n2/qc6HX92Fc5YF6KPrTz3v+Ug13u0KV30ZToZanfCQAwqOQzYzm8pd4gNLV8e9Zsd6nD2rboSrQjmtuu5S3Ppe14IMhBdH+pt0/T0VL/t3xOLnfscgcRAOCfkrdMc8fqajSp79pANK9/AQAAAAAAAAAAAAAAAAAAAH70BcHmSmAUyTWuAAAAAElFTkSuQmCC>

[image27]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAWCAYAAAB9s8CrAAAFUElEQVR4Xu3bV4gsVRDG8TJdcw6Y0DWLgjkjimJWzDkgqJhzzl5zTpgwImZMYAZFvIIYQBAfVBB9VHzwyVcftP5WHfrMYXaZnVndHfl+UHRP90zPmemB/rZOr5mIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIjIzNrQ62Ov67wubPbNtHleD3ht5XWi1x+9u4d2t9dKXm+1OxqneK3l9Y3Xm17Leb3jtXX9pCFs0m6YxLLthll2n9fu7Ua3scVYL2h3TNNCXg963el1h9divbv/E9e0G0RERMbV8bn802vlese/4FCvu3L9vHrHCE7I5US9sY9bcvmVRWjE2bkcBcFkMtt53Zzrj9Q75gACFMG19pfX87k+6ndzu3XfDX8UzIYt2w0iIiLjaBGL7tpjXhs0+0qgWq1n62g4Jh2uA6zrTE1YhJnTvV7wutprc69zvY7yusqiI3dYPn++RXeo9oxFGOQz/Oj1idfSuZ0uD0qH5/1c4tpcnuR1tEXIwBsWHaadLcZxmddHFmN9zmKsjPHWfD4ez1rCYnwEnp+9brIIlSyxp0XHqX5tP1OFjde91repQ+Cr7YZKOac/eS1Tbee7bkPcMF7zOrV6vEYu53u9nesEw37n92Gvsyw6fXRky2fkD4unLb776ZiNzp6IiMiM2iKX/ab1dmw3NJiGJOzVNZWFLS7El3hdnNuWtAhC+N7rUa/9vNa2CGBMYX7rtahFkMO2XivmOvtB8OLiD7o6p1kcm44hwYdgWpSOF9N+5+f6XhbHKsf93OK1BEjGsYpFcGCsBDLGurfFuMC0anlfAgcdvEstwimut258B1lvl28y9ZhrvA+hk3B6ebOvRsicTOmkEtjaqVrCa8E5G8av1v83xbn70OK4n1r/87uHRbA/2Os2r0O8drAI0QTh3fJ5g9qp3SAiIjJunsrlcRadCAIL03jLWwQDuk50R+h+EKTWzOdjuoGNjksJBzfm8mSvKyzuL6Pr9Flux665PCKXhMv9c52uDOu8Zl+Ljg4BiuO957WPRQjrhyCAMgaUe7nokLG/dHXoBB6Y62Cs4H1Ruj2le8bn+yDXN/W6yOJznGlxLLpZN1jcW7W4xZiPzOfTzeP1bC9jJPwRcgh/9b12bAfPb8NmHYY3ynWCzurWdbrAOS7dNLqR6+R63cEq26brJeumqksw5X5JHG5x7u7Nx/X53SbXN8tl+b08axHavrA4txwDL1tviEYdjlEHUBERkbFEJ4QQwYWZi/p6ub0EGC7qBRfFUfxiXbChywQ6V3RRCGB0WbhBvSjBY9Vc3mMRKrnQv2gRAAgydOMIbHRevrMIXYQFnktgokNWY0qTY5eAg/Je93ut6/WkdffaXZlLMNZzrOusEUxAMCLoEGz5LASy7b3etQjDhCq6i3yfjJ33OfafV8YxQVCjmwQ6hgTiH/Ix6nU6bGU6l7CF8jkJivNynSnFgmnHBdVj/lmjBDrGCALpQ7mOYTts/Kb4PfEedFTBsTh3TNVy7spvoD6/ZYqekFrje+G7/tLrDOu+s6+tC9e/53KB12+5jhL8RURE/je4qD5h0XnhokrwYWprl/pJY4oL/SDo+JQOzlQIEHT3BlW6Yi1uyCd0cs/bhEX4pGtEKCT8HWMR/urOF/falXvz2rBJ4OL+MDp63OfGfrp43LdGx3RQJTzORXTTXrH4A6MO0StYBNMybcr3KiIiImOEwMO04GwhTIyCKc5R8Pqp/qO1tpR1079zEf9MMohyX5yIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIj0+Bt+T7+wTB7QDQAAAABJRU5ErkJggg==>

[image28]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAQCAYAAAAS7Y8mAAABJUlEQVR4Xu3STyuEURTH8UOMlexoLCyM2FgqS6VmMoWZDRui7L0ENSyGZiaZhaax8GftT0miUNJ4AbbKytZ7GN8z52juqEGzUMqvPnXOc+/z3Oe5zxX5z2+lA0W8YA15HKEznNRqZlAK+jukg77lrGPF6268YaA+XEsZ+17HkakPNc8FtrGFeyQaRi268KrXXegNxprmGW3uBu2Nw7XsYPzzxa8yjNug123o83oQp9jEEyJYwonYVum9B2KL7mLZbrNooydB04+q2AP0U68xhh48iH3RPK4QxSwWkUUKU+LR0/CIS4yKHb1jbGAarz5vAjmvdRGd/5ECJoP+28Rw7nUGc0iKbYX+RD0ZmorYSfpx9Afqm+3hDIcYwoLY24/4PN2iP553uQEsgujirCgAAAAASUVORK5CYII=>

[image29]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHYAAAAQCAYAAADDCotWAAAEmUlEQVR4Xu2YaYiWVRTHT5pmpZZRaSk21WBFm5pYitRguLUZtEoLU5RhllRom1nTpKNl7kSbVlYklZWGrUr7Zhu5RBDqh4o+Rt8EJfT/m3PvzJ3bvO9MzTvOIO8P/sxzz33e57nLOeeeZ8zKlClTpkyZMu3NjVL/pL1Q2iM9LnWVNkpfSOcl9+xLjpSelnabjxX6Sb9Jz0uHBltHsE16SZolvS/91LS7XZkpHZAbI4Ok2blRfChdJR0tPZz1dQTdpL+lytA+U6pq6O0YBkq14bqv9Ks0uLG73WENJufGCNE5NDeK26U3pKekQ7K+tnKHeRZIOUb6SLohs6e8Jt1v7mx3Z31tobnxAFniudyYUCUdLnU3z2gFF/l/MFr6Szoss19rniUiLyTXTdhqHg05pLpd0pC8owTg1ThMDmkVLywEm/65tNhKm34LjYe0j4O3xBLpldxYAppzthPNHTzCMfCv/eP8/DE3Bi6QNkuT8o4ScIs1npUpeD1jKsQR0j9W+nRXaDw40Nm5MeNq6WdzRzs262sLp1jz0XiZNCNp3yedk7TrOVh6KzeKPuaTvUZ6NbGTAldI80N7jbm3sCFHST2kJ8wXBLFJpPqXpUekpf6z+vR2ari+WFol1UnvBVshTpB+yGw8kyMDppunsAXShcF2T7iHiKIIa2k8vIPnzZU2mafZQlCf/CmdFtrTwl+ifK35s0ZKD0oTpcdC/3jz7PSiNFy6zTwK2bD15gUR2WlKuJ915f5HpU+lc4MdrpRuStoNMIAUHsqkDpR6mef5mPYYHB78bOj/JtjnmN/LAp0ebCzeRdL50pfmk4znYkwx/OYX6SDpEvPFBiaCx+ZcIT2TtFnYs6xxHB+Yb95Y83dXS1NDH45KEVhsPEBlO8z8bPsssXMkpRUo8//EPGKBYKAI5R6yHBt1nHlNQJSxhvOsaSRyTeBcKn1vPnYCA540nxvwjLvC9VfmARm5VbouaTewOrlmkLQ5MwDv/8N8w04KNqKC+zgL4yDulHqbe3iEAVCUsWE1iZ3Bx8jEUTgj4AHzzYDjpZ3mGxzhORRXbN4ZiR2Pj+MgcwDP5SxiA6kVAG+nSCo2Hgqh38M1n3YxwgAHHJO0cebt5p85BMIO6fLQRxZj/sAGUxhyjFSbb250BrIK2YH3MreUr6Uu4fpb6WTz7EGNkcIYR2W2ekit/6XqZSMo8/kUInXguaSMCmlduAcnYJHxXhaU8zrCNZHJpDjXcBTu22AeFTElMnkiuSWoRPFYNvDtYIspcUv4y3OICO4pNh6cIWawGvMMMSG0B1jrP6/YhJhZvgt/mQ9H2XJpRLCtlMaZv5sNj/SUPg52oMAFAo3jg99EqNybXScWkzTVWii3GfT10iLz84M0BA+Znxe15l4KLHbsBybF2Uy6rJDelV43P1tIZTgKxBTaEjgRm3Gzuffy0R4/36gRKC7SAqPYeIiQd8zn96Z5yqwM9+FAxc7bFGoLsgAOX2eeSskiQJrHkcgerCHca42bCGwsjs47gX8ULTMPKjJWdEycjWxZEB4QU1ZnIT1HOgOdbTyAw8RAKLO/sxds5s7BAmbL0gAAAABJRU5ErkJggg==>

[image30]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAMCAYAAABfnvydAAAAbUlEQVR4XmNgoCuYC8SHgLgWiGcC8VcglkNWMAeIWYCYCYh3AHEasiQvENtD2V1AvBxJDg5UgfgZEGsDMScQCyBLsgPxeSBOhPJDgVgKIc3A0AHEs5D4U5HYDG5A/BuIW4C4HohPAPFEZAWUAQCRPA8Pagr6GAAAAABJRU5ErkJggg==>

[image31]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAQCAYAAAAI0W+oAAABPElEQVR4Xu2SvyvFURiHX2Wg5EeMyk3JwGASmwWF4eIPUIoFiZIfm4GkLMqAopBBKQOTsiilDBb+Cpt/wPNx3uueTl1uuXdQnnq653ze7znf733PMfvnrzCFz2lYDrrxNA3LwRwupGEJOML2ODjBXdzE9bjwS1qwIg5esBnr8DoulJImfPTxMK76eAYvcd7C+fXiLF7gEt5a+NqMhY7s4bQWQgdu4KHPPxnAHR8fYw+OYxYfsBE78cyzJwsfp42rLbywSovh1X/7sdLCs18s4oiPtVhn1IA1eO/5KB5gPd55JoYsrBG1+BbVunA/mhekz/KbaIE2VWu3cg/ABC77eDKpqY2q/8iKhR5v41qU6WU51ELdVJ2nzlbtynGObdG8IFfYmoZFoA/JWP6CfYsuwzuOpYUiuLHwbwbj8ANmZjAMPX4+qgAAAABJRU5ErkJggg==>

[image32]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAOCAYAAAAWo42rAAAAh0lEQVR4XmNgGHDABsQTgfg1EFcAsQgQzwfiF0Ccj6QODNyBeBMSPxGIZyDx4aAGiDuQ+D1AnIDEh4OtQByFxN8OxKpIfDBgAuL3DBB31gJxHRDfRVEBBTpA/BKJb8SA6l44SAbipUj8AiBuQuKDQQAQHwPinUCsB8TxQHwZiFcBsQJC2YABAJHpFRiFESuDAAAAAElFTkSuQmCC>

[image33]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAkAAAAOCAYAAAD9lDaoAAAAeUlEQVR4XmNgGBDAAsR9QPweiGuBuA2IzwOxMbIiEHAC4vVIfFsgPoDEB4NKIC5HE/uOxmfYwADRDQMiDBBFjEhiDM+AmAOJ7w/EW5H4DGpAfBxZAAjmA7EfskACEE9B4vsC8TIkPtjYo0C8hQHi/ZlA3MoACZaBAACf0hJvDPusrgAAAABJRU5ErkJggg==>

[image34]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAbCAYAAADBLdN1AAACrklEQVR4Xu3dX6iPdxwH8K9diDaxkBbltJu52I0ixUpNLrAr3C8aLsYFsaKkWUKNUOTPUiTSLClJbblwobYmUrtc7l3RLtZc+Xx6vk/nOQ/pOIf82nm96t33Od8P59x++nyfP6UAAAAAAAAAAAAAAAAA8JIHkZ8j6yJ/Rz4fWQYA4H17HvkwMj3yuFcDAGAA/FXXLyIXugUAAAbDt3X9JbKkWwAA4P36OHI4sjUyFHkS+br7DwAA/i82RR72NwEAGBzbItv7m6Mwv78BAMC7cTFyIvJ9v/CGZkSW1usN3QIAAOPze1131/Vead5ldinyZ2RWZGpkSq2nlZFTnZ8/jSyKfBD5o7MPAMBb8FVdc8KWN/KfjJyJrI4cqrX2Zv6NdU1DneuUTVzWJ5fXN20rSvNE597IuV5tLPLvpm8i/5Tm916vewcjByIflWaK+F/dnxY5X5pmNOVEcGZkV+Rq3fukrgAAAyebqD31ek1ds7HJ12e0U7jxymlcul2GG66+0dxXlxO91uzI03p9tIw84v2hNFPCf+vPkzq19F1dc4qYDWce7x4ZLgMADI78vNPa/mbPo9Icl47V4s71sfLqJjAbp7uRHaVpGq9EvizNEe2tMjwFO13XlJO145Etkd/KyPvo7tc1J3/ZkO3r1NK8uuYkLqdv+dWEzaWZBgIATDj53rRWNlDtgwp97YQrjzrnRm6W5msGedy5s9Z+rWu6EblWmnezPYt81qnl8WfK/5tN4OuecG2buWVlePIGADChtN/7zElWd9rWlw3b+sidyJy6ZnP3U2marnS5rqn7HdF88nV5vc772FrZjLX3rbVWda7313VBaR68ONupAQAwBm/jywZ59Pkq+X66hf1NAADeTE7pxmuov1H92N8AAAAAAAAAAAAAAAAAAABgInkBnotSCb+id88AAAAASUVORK5CYII=>

[image35]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAVCAYAAAD7J7IFAAADVklEQVR4Xu3bT4iVVRzG8aOFSqhUgqYmDmSm+Acj3SQmSBAmWBaCWahI5MZSLCpEaSSV0gSNDJLIRQvzT0WiqYm6sSAJw43oLkyttrpzY8/D+b343sOdmasjI16+H3g4557zvve+M7P58Tt3UgIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGhPA5QdyofKbuXfxu176rIyvFzspXHKAWW98qsytHH7jq2M8U3lesrv/2OsbVfWKROVpco15aHYO67MiLmf7WVltbIz1l6IsSf+3G3KSOWKMrhxGwAA3O9cTNhnyrLa+u14tFxo4ivlm3KxGz+UCy16qlwo/Bzjc8rh+kYTrTzDsNr8ReWEMkp5X/mrtncpxu9ifKzaCL7etsT4nvKqMj9ed2e20k+ZUm4AAID2UBUtR5Qn6xt32XLl7XKxG36ed8rFFrhw6Up/5Z+Yuxiqireu/J1yt2yeskeZo/yR8n1745rXYzRf647lCmVDaixQb8ToTph9VG2EN2J8PEYXlBNSfp+efKDsKhcBAEB7mKz8F/ODMfpo1Md4Pr77WNka6+6iufvjDtGXsfaJMivlwmR8yvf5OM9Fk+91186+V86lfATbKh9XPhzzBSkXe44LrbXKT8qglD/PnztJ2RTXV74oXvvosOpg+Xl8hFgpr7UzyoPK2JQLsZPKs8rXypq4ZnOM5iNlH22+lHKB90ptz59ti5XPa+ulEcq3tddHa/Ozypja64qLUP/O/TcAAABt5jflWMrF2T6lI+Uiy50kcyG0Snkk5SM9H725QHFh5MLiVFz3S4zVfX5f3zs63Sq6qkKpFdNjXKQ8HXN/L+tizF2omYsu8+fZtBi7cjXlAq86luyJiyUXTxuVmSl/58ydNT+Hf2/+jt3zce0zyoV0q4v4gNKpLEm5u1hpdmT7Wm1+M+L3HZgaC7Zm/LOcT7l76J+vXiQCAIA2dVoZEnN3l8xdI3e0OlPucPkL9e4iuQjrUPbHddV9LuR8r7teT8TaQmVuzG+XCxf7NDV+of5QjH5me6va6EMd5cIdqLpvpakp/xMCAABAy/4sF/rIu+VCEx3K7+ViH3EXsjeqLmSplX84AAAAAAAAAAAAAAAAAAAAAAAAAAAAAADcN/4HFo5331IefSEAAAAASUVORK5CYII=>

[image36]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAOCAYAAAAWo42rAAAAh0lEQVR4XmNgGHDABsQTgfg1EFdCxbyB+D4QV8EUwYAbEK+HstmBuA6IBRDSCFDDANHND8R9DDgUgcAWII4D4sNA7IQmBwdMQPwOiGsZIG7sRJVGAC0gvs4A0aAExPeAmBFFBRQkAfFsJP5uIHZF4oNBEBAfB+LtQKwPxApQ/lEgNkYoGzAAADjHEzI35BOdAAAAAElFTkSuQmCC>

[image37]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAbCAYAAADBLdN1AAAB0UlEQVR4Xu3dzasNcRzH8VGKBSuUbIhQHhYsLJSNjYXHIgtLCyULKZLHojylRClKsbNQYoVSxE6SP8FOdv4EPr/md7rTdO+599a9zimvV72b38y30znL6cycOU0DAAAAAAAAAAAAAAAAwIx8TS/T6/SkNwMAYAz8Sgvr+lJ3AADAeHjXWd/vrAEAGBP76nZd+tIdAAAwerfTlXQ97ejNAAD+C6vS03Qtne/NhjmRHqVb/QEAAHPrR1qUtqaNvdkw5+r2SHrWzO61AADMwuf0O63oD6bxp2lfW3zrDgAAmB/lOWcztaWz3p7u1vW29D0dqvvr0850smlP6palvXVWPOysAQCYxNp0L13sD6ZxM11tJi6Lbkib0vF0Nr1Nm9OndCwdbdp75IpyfJjyeco3fuU9yskfAABz4EK6kdakN+l90z7o9nIz8Y3ai3Qmraz7U9mdXtX1ru4AAIDxUP5+anCitjwt6Mwmcyed7h8EAGD+/EyL6/pgdzCFchkWAIB/aPBDhP3peTrQtPezlZO3U01771y5BDuwpLMGAGBEltbtx6a9N27ww4XVdQsAwJg4nB6nPXV/8B+jAACMoQ/pQf8gAAAAAAAAAAAAAAAAwMj8BTMzMxON7wGuAAAAAElFTkSuQmCC>

[image38]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAYAAAAMJL+VAAABGklEQVR4Xu3Tr0tDYRTG8SMoLGhbM9gsRpMwwywT8QdiFZS14WBRDC5sKIgyFBW0aLNq0Kqi0zUt/g1Wo9Xv4dyLh4PhyhYMPvCBe867yz3vve9E/vNX0o8WPrCJbbxi3P+o20zh0tWTuHd119nAeuh9hjpLBnAmPwx3JTZ1mrzYA/pcL0sK2EEtLrwj5+oF3Lg6a6oox+YoOqF3jvlkTa/3cYwVsV01sYu99AYygxccYsL1ZRVHrp7DRXKtD1kWO1m6q2msoZ6s67fzecSgb+hNT7gWO6Kn2BI7uml0Sj1laZ7FdqTvedj1NW+hzpQ2hlx9J98DjLn+iNigv85DqJdwgkWUXH8WDVf3NBWx71KMC73KLQ4k/G++AEgyKzPzBaD3AAAAAElFTkSuQmCC>

[image39]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABEAAAAOCAYAAADJ7fe0AAAAvElEQVR4Xu3RPQtBURjA8eO1TJISpQzKziyDyaJYpLiDLGTwEUxKFhZWt+wyK7HbfCL/23kux8nLavCvX+55njNcKPXvtwtjggXG2CP9dEOXxQpzOS+R95cVxNHHCDMk/aVRE1Vs5HxB6LHWuSjZQ6spGkjgZC46KOKKCNoIKv2VMsY9r53Ma0q/8b0htjLsyQWvLs7y7Of9ZmscULd2b3OM5xwGiOIon19LoWWcC0r/gy7KxvxjMQTs4atu37gXAgMZJL4AAAAASUVORK5CYII=>

[image40]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAAPCAYAAADHw76AAAAAXUlEQVR4XmNgoDpIBeIL6IIgYAbEi9EFQSAXiAvRBUFgERBPAuI2IG4kSuIqEMsAMT8Qb4EJigDxSSjbG4grYRJuQNwLZc8HYgsgDgZxioDYByoxlQFihyCUTw0AAPo7DprMq4LsAAAAAElFTkSuQmCC>

[image41]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAPCAYAAAAs9AWDAAAAaklEQVR4XmNgoApgB+ImIJ4BxDowwSIg1gdiEyBuBglwAPFGqKQfEE8BMVyAeBcQ1wLxfiAuxynYCsQBIAYQ7ANiVxBjIRDrATEnEL8AYjaQYD8QqwBxEhBXQjQwMNgD8XQGiLMYYYIUAADLRxAYGQNPIQAAAABJRU5ErkJggg==>

[image42]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABkAAAAOCAYAAADaOrdAAAABCklEQVR4Xu2SoUtDURSHj6YpDrSIG9gHYlFEMFqUNRlo0TCZZQtrioJFk0GjoogWg02sWgwqZv8iv8s9Z5wdtoEwsPjBxzvvdy6Xe897Iv/8MU94GcNhs4t7MRw2t7gYwxo+4BE+41x3u4s2HuAdLoee8Y2n+IhTFm5InuE6HmPZGoEt3Nc6HWbc9YxJ/MRRbEoY2wcWfNCDF1zQ+tU3HGt4rnV6blpjAt/tRZnBUsi+JJ9+Hq80q+BYZ0WeRkPygdPBi9ZYwTN7UbbxLWQtvJB8i7pm15Lnb6RND/EEl1zelx1XT2NV6xucdT2/7lekTTvzlHzbe83S3I1VGfw3DiTNeSSGPfDfoy8/uZwg4B9iit4AAAAASUVORK5CYII=>

[image43]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFsAAAAOCAYAAABAdWDdAAADJUlEQVR4Xu2XWaiNURTHl3nIcJGpzGSWTEmJkJJZyjWXIRGZQiRDpEwZM083w6sQkQw3mYl49OLFszd59f9be9+zz/KNHXWl86tf59tr7fud7+xv77X3FSlT5n+nFzwJ+9lEmViawh1woE2k8Qw2tsFaZAz8BtvZRARd4WF4Xkr7DePhd9jSJhKoAx/A1jaRxFsbqGXqwi82GMMZ2ARuhBNNLi9vbCADN0QrQ2b+tcEeDG/aYAQj4F53zdldGeTywhJaZYMZuAb72GAS74Pr+nAXPArXwVuwQ5D3dIKn4EHXPgZ7FtI1sBRcgodcm/drAJ/Dtr6TYTm8D9dK8qDvgRdEa+dXOKo4XQNLDZ/hgGi5YLnhs/OZKVkCV7lrm68Hj8Droi/3hOtHONj9g3YifKMXgzbrJevWMrga7odtgrxnluiDX3Htd6IPZZkBR4oOCl/kaxffB5v7ToZzcJ675n7C2hgFcxWim9UP2Kw4/RsO3G3R3FLRUnMZDnJ5DiCvWY6GuZjNT4UT4AvYA25xObIdTgnasQyAL2FnmxBdUkNt0MABmwlbwacmF7IJzhUtD5wxZEMh/QcfYQvRgbxrciEf3Oc4ie83G54N2rzvp6DN38/f+Up0r4jLT4e7g7inkWgZ5qRKpb3okvUsgEPgZ9HlzkHiQ7CUdAz6ES5xxieJrgAS1Y9LrYtoTd0sOsP9krX9OUv9RsWZuF50lnOG2qPpPffJmTjWXdv7zYfbgjZntn8xrLUsZ1xhnCycod0i8lxZLEGTXTxkp+jMzwxLgIeDwMHh4LGOcSDJQljtrj2s6afhQzjNxaL6Mcaj2WLRvYAPyNXgc9XumgyXwj7AF31V9OV3hz+l+HjHQeSq4YB67P048/idW+Ec0RfBPWmNaM1nmyXmEVzh/sbmyR0pPHMIx6qvDSaR9TSyKLjmprMSNoSP3acn7JeFrP05+By8NLLe72/Ao19vG0yChT/qrYXwVMGZ4eEXcMZUwdFB3PZLI09/bthp5LlfqbC8PJH4U1UkPC3wBJB0hOE/DnGngpCs/Tx5+rNvGnnuVwrcW46LltJUfgFuOX49tzEFWQAAAABJRU5ErkJggg==>

[image44]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABkAAAAOCAYAAADaOrdAAAABMklEQVR4Xu2TvStHYRTHj/dYJCWiDMoqJoMMJotikcLgJa+DjBgslAxYKIP8yiovqxK7Msgf5HOeF87vdEtdq099+p3zvff3dO+5zyPyT0kWsduHJdjDGh8q/Xjgw5IM4IoPlRMc8uEfqPhA+cSGVNfjPp7iFj5gZ7pm6cFzPE79Gfal+kZ+1gvU4bvpR7EVl3ATj7DdXM9M4Rhep/5N4lrKDg6nOtCM9zZIVOT3ER7iJLbhi8mncdn0gUdTz+Igfkh85RmslTiyLnOfcpfycYlvnNnAedMHbk29LnGm+qcFiQsoc/ia6ox+swt8wgmT63caMX3gClt8WIB9ul5cw0Z8Tr+ZS2wyfUDHs+pDR4fEWWf0bOkOrEj1U+uu2zZ9FXqAirZqRjdI4Ul27Eo8Bt98AXRkJWHb5uSjAAAAAElFTkSuQmCC>

[image45]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAOCAYAAAA8E3wEAAABPklEQVR4Xu2UvyuGURTHj0S8i5RC2GSyMKCklBiweQeTQX4sJAYlk5JSCLEoKQYLiawmk0UG8u/4nPcej+u8z1PPO9h86tN7zvfW07333F6Rf/6QWWzzYU7m8c1lc9jqsoQu3PZhBfThlcvqcN9lCQfY68MKWMZVH8IRNvhQeccaq0fxGotYwFtsxydbT+MSj3EHt6J8AUeivkQ1vkb9NC7hDA7hoeW62yw+JGxKT/MY5YO4HvUl6vHOZQ8SBq5XpRtQ0q5MacIXqydwI1prlnD6Mu5d/2y/J9iPnThuWQ9WWa2Myc/juMABnLK+G8+s/sWN6/X6NnEFd3EtWvuUMOdvdG3S6lMJM2y0XvP4xAnnEh5IHnRWwz7MQEeiN1KGhos+zEBfXq0PU9DHuOfDGP1Qiw9T0EeWB/3n6vDhFxmXKKCiANpWAAAAAElFTkSuQmCC>

[image46]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAG4AAAAQCAYAAAD3c0pKAAAD9UlEQVR4Xu2YW6iVRRTHl1peyCwzIzUtKiUU7EEqUiEVLM3SSkPtgpeiUPPBoJuX1FLpbiVFiRVEaSpeKqLUvNDFwsog1BfBBx/spRcf9MUX/z/WDN847m+ffay9Oxz2D/6c+Wbmm29mrTVrZh+zJk2aNGnSzhkpvSR1zhvaGbOlx/PKyEfSD9IS6UPplDTgnB5tj0nSlcnzTOmo9LK0VDotPZi0N4J62fGJvCKyTrpI6ih9Z1U6tiFyx62S+obyYunzpK1R1MuOFce5VLojlF+TNiRt/5ZrpEPSvVn97dIx6fqsPnKL9Jx55E7J2iK543gGvnVY6p60NYJa7Lhc2mfl6y6jouMi91t9FrzZ3IE5f+QVAdLbPVKHvCEjdxzcIP0tDc3qG0mZHTmLv5dmSZdnbS1R6riB0glpiNTNWj9wNQ7kFeYG/zqvFD2kh/LKEnLHMe8/pcfCc5+krVFUsyPB9Eny3BoqOq6L+YKJBCDiOSvmS1+ab+vh0ovmxiINwHXSp9J75gNPlj6TFpq/x+R5d33oD8ukd83fW5TUR26T3jZPkVGMW4ncce9bYZje0sNSP/NLwrPSDPNzJ14WbpY+lt6RRpmfS/TjckNQDZYGmY/JnFgnY5RRZkfAFtukr6Rpoe4Kc3u8FerhKWmT9Iy0y4qsU9Fxr0hrk2cmyAvTzQe51twZGPAS8/5EEwN3De8cMU8RGG+cucGZNLtnQejD9X17KL8hjQ3lFMafmleWkDpuvPSb+byAoOD7fIMzck2ox0icr/QjVfcyd+AE6Wkr5rpfuliaKD1ifvHhe6wNbrLiW5FKdkxZacU5DDhymNRT2mkeOPdJv5uvK33/PMfdKZ2RVphfoX81j0Bg4iwAcCCphyiZKd1txcCkt39C+WcrnAlE6ohQftOKCewwf68So4NqPeOY00nznUHAcKYS+RGMzpkJXNXZGTjqoLmDCTggpeMQ5r831AFBNiZ5BnYxOzNSzY6RLdKNoYyzjocya8XpQGrdE8op5zmuGiwiRhDRDGzzq8xTBrc+mG3+YQ7jn0Jd5EfzGyK7FsPeKl0m/WK+2E5F13NgLHYRqavWW2UZZAac21/aau4odiI3vAipjAsFkBlWS3eFZ9bEjTHn0byiBf4y31WAAzlO4AXpAfP1ElDRiSmtchxG/VaaYx61pMu41TEYdfPMP8xvF87BV0N75AvzyGTCvMvzRnNjPpn0uxBqddzu8JebLeuZa55NyCKkRtLT1eY763XpA/OAI6sAuzSHHYiza4VA3Jc8Y49vzLMQvzeZC8583tx5Oa1yXFvn//yXV36+VYMdzn2By92FQEYr/ZdXk/rBruLc/c9+npwFEauxCJwy3UUAAAAASUVORK5CYII=>

[image47]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAWCAYAAAB9s8CrAAADk0lEQVR4Xu3cWahVZRjG8beQBpugAWy4kAYIqwuHJCnFCpohmyQtBKcuKjFDQpspiuaoiCaw0dCypEKyhKKBoKsK6qK6iYi6jqDrnqfvXfj10d6uztFzjvH/wcNa6117Hz/3vjgv77c0AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4P/hR+Ve5U/lqubeWJusnNcWB7hD2Uf5rr0xAte2hQHmKb+0xd3kOOXbtrgLzykb2mJP/uwAAMBe4pg8bvxHdXy8qnzUFge4OI9+z2id0BYaNyoXKfsqPzT3Ooe3hRF4sy3swjJlVVvs6bq2AAAAJi43K7+1xZ6uaQujNDX6NWyeRnVeUuZEaaY8KXwv62cpLyiHZv2RrNcOUB5UPsnrhVGmVjcob0VpBs9UflJuV1Yo7ytv5+trK9tCZYrysDI7r19RHo3S5N2tvKscr7weZfI1aL0dv9br+0bZr7nX1+5odAEAwBj5SlmuHN3e6OHE6vzI6ty8ZVmnj6nRr2E7uzo/IkrzcXNef5HHl5X1ymHKnXneujWPfs905YMoTdmCrJ0a5We/mK9zM7dI+TSva8MmVv58vQY3fydl7TFlqzJT+VBZrKyJ0iwOWm9nuzIr/n0dfQ37+QAAYAK5UDkwz701erWyRJmbtSeiPCN1mvJalGe97lcuUI7N13iSZe1EaKQNWzftGmZaHg/K4xlRnmXzWh5XLo/SkLghsknKKXle8zNj5yhPKvco5yqHKPOVp6M0aN4KdVN1ifLl3++KuCmPtWEN25Y8ejL4TJ4frLyT517vZ8rpyscxeL2d7n1+5tDr82fm78MTN6/TjWjdDJq/H28jf53X1+cRAABMcL9HaabqZ6c8aeuei/LEx02AeeLkX/pucOyKPHprzzydGq2nlF+jbG8Os391fksevbZnozQ+M6JsK56c91w/P89rfo8naF67J1+blMuUdVG2U7sJnKd1nmg9lNfe0mwNa9jui53/sMHbmZ4GXqlsi/L5vRHlz/aa/bkOWm/H73s+ynawp5yfZ91TO69xvvJz1h7Io1/jJvH7vO7+LgAAYC90m7I6dm4x3hXloXs3cvUW3NooE6NLlc3KjureWPB25Z7yR5Sp13/hydx48VTNjooyWXMjWjeDbur83fk783N75mYcAABgj/JzXvzXFP0tba697QoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGHd/ASICiHee8PvUAAAAAElFTkSuQmCC>

[image48]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAOCAYAAABU4P48AAABJUlEQVR4Xu2UvytHYRSHT1IiymzQm5gsFtnYGFgof4DFbPqWIgODZEEGwoAyWi2IySIW/4L/wGTxnO89rvNe3bqva7xPPXXez3vqvvfHuSINDaWc4iOu4xF+4GDU8Td6cNqte3EX13A5MYs4wU7swBspaUpkAi/wzmWbOGn1tWTXq5rl9OGU1Tt45fbqEiQ+8C0OWX2OYwnZL+bxTbLX8V8EiQ/8aplyhrMJWcQIvuModmN/vN1Gb0i/8aIrvqlAkPjAz5YpepC5hCynC19wydaLOPCzXYuA926t8zFs9SWOJ2Q523js1oeu9pQ94ZZvKhDwwa1XccZqPZQOetWsjf5yPnELN/AJ9743a6KDciDZp6Y3ppOu87Ev2V9gwfqqZg0NRb4AngJF6Ee7k/sAAAAASUVORK5CYII=>

[image49]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAOCAYAAAA8E3wEAAAA60lEQVR4XmNgGAU0BHOB+BAQ1wLxTCD+CsRyKCpIBzxA3APENUCchibHMAeIWYCYCYh3MGBRQAZoBmI7KHs9A8RsMOAFYnsouwuIl8MkKAR7gVgJyl4ExAZIcmAQCMRXGSBBQQ1wAYgVoOx5QOyNkGJgUAXiZ0CsDcScQCyALAkFIAeB4hgdFyArQgJnGVAt9IFJsAPxeSBOhPJDgVgKJkkBAKUFFSh7CRCbwiQ6gHgWjAMEU5HYyACXD8uQFSGBSiB2h7JBloMSJYMbEP8G4hYgrgfiE0A8EaqIUgBKC5MYIKk1CE1uFFAHAACXfiOc99XCYwAAAABJRU5ErkJggg==>

[image50]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC8AAAAOCAYAAAC/10U/AAABQElEQVR4Xu3TrUsEQRjH8QdRxHdFMBh8QUTB4h8g2CwGMdjPIkYxiMWXYBAFX4KIb1XbFYuoyXBcOcRg8CUb7CaDfp+b8W7mdvfkTrftDz7szvNMmNmdEUmS5E85wx1WcIQP9Hgz/j99qEMjUrY2gh2sY7xMzcspalGDK8z57Viyiy9kMGBr12I2pGtJl6kV0iLFHW3hwunFmUUMOWNd4LMzfoiohWYaj2gubcSUVSzjHGPoEn+hr+gPqQXWN4g3MeerAe1+Ox/dnN6JUgvupArSYZ96t27RKcGF9obU9KQUUo97zNrxDLqL7aozLMGNqinbz6EJrXgXc6ZfbE/zFFHzsoljZ3zgvLuJ+vJL7qQKcmifuskb+36JNjF//udyhtXymcAnNrCGLPbdCTFmEvM4EXNsNaPYxt4vtSRJqsk35po+jjDOdFQAAAAASUVORK5CYII=>

[image51]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAD0AAAAQCAYAAAClUHcBAAACPklEQVR4Xu2V3WuOYRzHv16WKTLWpCU9DmhxYKWdiMjBvB14azngZIoDSbYkL3mLvMy8tbYhW4laSWoIcaAwSZkUB8yx/8CRE9/v873ux/Xce2y1HDzT/a1Pz3Vdv/u6n+v3dt1ApkyZ/lf1kFfkGLlBfpJ5RU+MTy0ml8lJsrLYBNwik8lE8ozsLjaPWz0nFbBvD2LDdPyJQhvpi2zlpgY4ITPThhKSs9+i+adoXNBm8oVMSxvKTErSEXIII591Noqd/o7U8wvID7gHppKq2Fim0plvkn1kSsomVWO40wpYXtrwkTSHeROpDeO9pIucD/Ol5AS5RjrIJHIpzHeQ22Qn2U4ek1x+F7CE9IbnVpGt5C6csX442LpPDpLT5BFZpI2jaD65jxKXFNzHQ9H8azTOO6SIJeoMv9vgKMqxO3BpKDgK0iZylCyE+2wQPrTWu7UZvh9WwJXzAY68nN8At5KCuRb+YijIraQlvxN4C/fk36TSPUeOk5qULZaCNwOu3MJF1kh+kTNwBt/B2ZDkyNwwljbCzkv6s/VhvBp2ULoIOy7pEyiH5aTepSDJ2UQDpDKavyd1Ye1ltB5LDuyBgzNSPyeqh890FW6HUfWZTAhjlZrK9kCYP4WzprI8DAdEeg1HXpl7SLbAgT0V7JL26MBvojVJl6i0nFwhayJbonVkVnrxX0oZO0t2wWWYI0/gsnwBf/TVN+qp5CBJhlR++t7vh8v0HpwdvXMOWUYuhGcTtcNZuQ4HL6mkTJnGoN+tdFoOClflIgAAAABJRU5ErkJggg==>

[image52]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFEAAAANCAYAAADRw4K6AAAC1ElEQVR4Xu2W2avNURTHl3l2TYko4zUkGVKI68GUSKibyJShzPODoigzGTM/4ISSMqeUkpspUkSePPsDvHn1/Z619/mtu86vc84v6pTOtz791l5rn31+Z++11j4iNdVU03+oNaCfd1ZJ08BP0NsHUjQTHAOHfCCjdoCP3llCXcB26xgGDltHldUS/PDOFHUCF4P9CHQwsawaC656ZxltAsPj4AwYn8SqrjHgoXemaLdoJlLMoj4mllXrRasxi3qA03HwHbQJdmtwAJwVTdfHkv5y/cElcDKMz4EhSbigWeAuaAQdwQPRz760k5zWgedgm5TezBfgIDgCfolmcJqmg1uiP7gvaC/67nxnQt0Ao4Lt46zUm8Gmf1WYR/G3SSvw2TjZj+rAWrAZHAc9TTxqkejLcXHqk+haXkvAFrASNEjy0ucLM4p1DSwN9mvQwsSiOoMPwZ4BmpJQM9WDXLBZcUwIbtjo4LsTbNsPfXwrWA6OggVgTohR+UNmH2E/8cpJ+RJnBiwE3cErF7N6KpoBfBluKrUzCRfpC+gKuoFnLhbFzbkX7P1gj4lZ8dCWmTHX/WrG70WTgZlPpcW5D6dE53ldiMYT4+QXjgPfREucP5plwhPkRljxFOjnyTBjqRFS3ODfhCcvgYlgKJgbfH4+Sz5mBXsUb01mJUtsZJwkWh050fbzDvQKfr/eFTAl2MzeSZIcDC+Ft2Ce6O3O58CUOCuBT97IXvlypu4b50ZwW3RTVkuSukznpmBHsWdeFu1N84OPpej/brB094nOPwF2mZifP0GSPssDZC/joQ4Cv0U3M4plt1eaV4xfb7BoGfM72Zdjz2eLYT9lYkwW7f2zw2d8nGJbSVPBf100A8pphbEHgA2greglwWeUnVeJKp3PTW3nnSmqdL1/Ie5dXjxpXvGlxD++i82YNxZv8ByYavzsG/GWq0RZ5vOiK6cs6/2teMk0/AGPPHb4G/VEVgAAAABJRU5ErkJggg==>

[image53]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB8AAAAQCAYAAADu+KTsAAABYklEQVR4Xu3UzStEURjH8YeERKEUkddsvSxIKQt2ysIChUREscGCpCiykJIkZWOjJJSyUHZKNt42bO39Gb5Pz3NzHWmGmtX41ac55znnzj333DMj8p90Tj12sYltTGH8y4wUpRLPYguIcojOWD9luURPUFtGXlD7KRV4le/fkTCNeENGUC8P+olyJraIX2UaR2HxD7kPC8lkXuygxVOFYW+XYgt7aPXaotg1xyhCrbc1YzgVO0d6eKNX0Y8DV+I1acAjcr2v278mn+9bT/wK+tCOUcz4mP4itD2IObFrB3CFGnSL3bwZ1z4+IbGba/RU6+leFVtZdWysDjd4F7voTmw3NPpks9gRW5gmH0/e7kWxz7vAAtp8LGF06869rduuB+rF+zliO6YLuUWL2Otqwr7PmfRP3ckubxdIkgezEBti77/Da0NYctFTnGAdmcjGA0ZQ5uP6/6FzdDG6G1leT9N8AAcJM4hKsTgMAAAAAElFTkSuQmCC>

[image54]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAsAAAAPCAYAAAAyPTUwAAAAjklEQVR4XmNgGNrAFogXAfEEIK4C4hBUaQTgAOKNQMwE5U8FYnWENCowAeJNSHxkU3cAMR8Sn0EEiD8A8W0gLgdiZiQ5eSQ22OpAJH4sEBcwQAzoAeI2JDkGXSDuQ+KDPCcLxP5A7ArEk5DkGOIZIIpBJlQAsTGSXDsDJJSIAqeAWJsBYhNBsJMB1T80AgBDTRHpaCoj4gAAAABJRU5ErkJggg==>

[image55]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEUAAAAOCAYAAAB5EtGGAAACOUlEQVR4Xu2WTUgVURTHT1mkQaItxHClIFmGUkokYoIoYosyij7wC91Fm4IWEiiZlGAqgiGlQguxXFgbN0EtgoigRSCCSNvAjbs2rQT/f+6dN3eO82YezFM37wc/nHvO5TnvzD3njUiOHDkScAVuwi/wvI11wQ1439uUkMuwTQcPmKPwuv1L6mG7n97LSzjorO+KKVY24E180MEDpgTOwm14zIlPwRPOOsBDOOOsh53rpHTCRzp4SPyRYFFuiTk9odyAH+11Lzzr5JLyBrY66wH4Ao7YXIeT8+DpmhD/nm7Dfj8d4CbcgotwQeU0uihVYu4jFPbXT3gKPgumApyGQ2m85Oxz4azi8SXFsAlWwmXYA5ttzoUPpQGu2zWLF9XOvO9VWKMTCl0UFv+Tsw5QBv+KmSveF8gWX3VAzGmJaykOQfY8+QULnJwL43ygPE1xsCjHVeyzWqdg9XbgE51QRJ2UdE/yPTxpr2vFtOccvAovijnC+fCc3ePxWMzAL4TfbawUnkntMLBlnsIj4v/C8TPDisii6MH6Q60DrMEiHcwCz2G1veZPM4s0LmaY3xHzZcrhfzHF8WiEK3AevrKxbvjN2yCmxXjfS/A3rLPxt3DU2yTme/H//YNjsMLGWaC0J2U/6YPXdDCEe+I/RfY6hzF5By/Ya8I5lAmZ7OMMimvjfYFDcFIHQ+BrgUcenIav4QMnznnH0xVHi/inMwq2PYf/ocBjHvn2KOEzQMM9bLc4MvkstlroO8ouBexOlP6pkycAAAAASUVORK5CYII=>

[image56]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGgAAAAQCAYAAAD6bToNAAADbUlEQVR4Xu2XR6sUQRSFrwETKibEiCCKEXNE1IeYBTPmgIKKOeDCgGLAnHMOKKgLFXWjooIgxoUgiroU/AmuBc/h1n1TU6+7540zMvDsDw7Tdatqurr6hmqRlJSUlJSU0jEI+g49g7o621zoKzTbBpWIAdCo0FgF6QeNCY0+e6FNXnum6IsrJdWh26GxCnMUqh0ajZXQKa+93bv2WQe999pPoIZeu5hMFr3f/8I0aGJoNCZB99z1AqiT1+fTCzrvtdt518WG9xnptRdDe6Cdrm+c15cEI/GwZJ5vOrQo051ITdHU/xp6DA3M7o6FaZnRz3vVE713G+iFPyigs+izRcIc+BZqAO3I7spimehG5UsTaFuM+njjfLgxzd11Y2go1BG6A82Hhru+XNDZBkOfXZsvN9/0PQW6FhoTmAWtEnV2rvu4s58oH1EROtL90Gi0hn6K1iHbFMKbnIX2u/ZVqBvUTNQrWbsIUyS9ZC10U3RDCuV5aBB1jjDtjYBuQEeglkGfwQLMHE8+QHVFo/8KdED0P+Jgqn0nOofUEf0v7skKGxTBI9H1rBZ9YWS9+41bM0tGJAzl39BGz8aDwhqohuimE6s/TIkM45OuzYd4AzWFuktmvJEUQXHefEs0PZCeot54ERoG9RZNCYyo624MN62FU/iiuDF8HtbLV6Kb/BCqL/rS7aTI/63mrkkX6AvUCuor+hynRVM927Zf4TzC+xCOZ2rsAI2X6DUbTKWxfIIaee2PonnTYNQwDxv7RMOX8EFtQUwH3MhC2SUarYTHbb6wg6IHmBmiG8LUwU8Cn3nQy8A2BLoLXYIOiRZkv5Ya3yT7WM85l6EfovPogBwTEs4jTGdbRbMKo3SDs0etmfAEFxtBUdBzzCv4fcS3vxua4GxMFdzAtlAZdMbZL4iOLZSFkvt/zoluPqGTmEOxRhnM7TxcENYRRvgcaHP5iMz3H+eXefYQRpLvpIxikmueT9yae0jF9J0I0xZrzBJorGhdeQCNdv1PRaOFsHbRO+nhW5ytUHhgYY5Oor1omqB38sTEVM0ayggzmKLptUw1y52N3npMdN0caylxKVTLXcfBF8vIYMrs72yVmWdErZkw3fMw9E/gi+ONiw2dIvELOwIW87AeVBY7COTL384zWM9iv4EKhfn8FzQ17EgpnD/5a4tj+MJdRAAAAABJRU5ErkJggg==>

[image57]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAPCAYAAADZCo4zAAAAbUlEQVR4XmNgoBtgBeI+IH4PxLVA3A3E24FYEFmRExCvReJPA+ICJD5DBRA3IfGXA3EKEp9hAxD7Qdn8QHwRiHkR0kQoeAHEPQwQR9YAsTqypAYQP0AWQAcJQLwIXRAG/IH4CBDvAmJDNDl6AABHVxG/MVK47AAAAABJRU5ErkJggg==>

[image58]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAkAAAAOCAYAAAD9lDaoAAAAaklEQVR4XmNgoDuwAOIbQLwbiLWgYtFAfA2II2GKQKANiCuQ+OEMEM0oIBuIJyPx65DYcOAPxGuh7DggVkeSgwMTID4OxLxA3IAqhQDSQPyYAeIuMTQ5OGAB4r9AXIIugQ4uArEAuuAAAAAkYw10SzCfsgAAAABJRU5ErkJggg==>

[image59]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAVCAYAAAD7J7IFAAAB4UlEQVR4Xu3bv6vNYRzA8Yf8mPxY/FowsSgRu8QgxISJKGTwY2Ag8iMpMUiJAXe4RoOBFDIp+bEYLP4CE7OJz9P3ufWcp3M7V+7wdXu96t3z65zbHZ++55yUAAAAAAAAAAAAAAAAAAAAAAAAAAD4V3ejX2W+IHpcnU2HbdGn6FL0vDmrHYoelvmDaHN1VlsWfYt2ROuja4PHAAAz0/cy7h3YTelHtCjaHl0ZPJqyOdHPMl9XHwyxL1oeHW8PGl/KeG5gd7Rn1XxF9LZaAwD02sdoXnS52f9QxvnR0vrgL+QnZRN/50J9MMSZ1P0Pc9uDxsQF8ODA7minmvVYswYA6K370dUyXxXdjLZGJ8re02hl9CS6nrqPLKdqPDrcbob97UbqXjtM+9qv0bEyfxTdSt3Ts3zRWxLdi+5Ea1J3Kcvr/JFrvphmu6Mb0cuyBgDovaPVvL6MzS7jizLmS072uYyjLI5+R6fbg0m8ajcmkS92W8r8bHQgdZeybGEZs43R7Wp9PtqTuvdfjHZVZwAA/418qck2RTvL/GTqvsf2OnVP4N6X/T7Il6/89C9/ny1/X2512V8bzYrelXWWf6hwJHWXvDfRhuoMAGBGmO5fkAIAAAAAAAAAAAAAAAAAAEAP/AGhkDlF1v1vkAAAAABJRU5ErkJggg==>

[image60]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAxCAYAAABnGvUlAAAHKElEQVR4Xu3d+YtWVRzH8W+WrbYXWBRIG4Xt+75vZLRRlCVEGQmGgiVlRTIK7baZLdImRSWlVrYIZTS0E5QZ9ENm1J/Qf1DfD+dc5j7Hcebe57nPzD3yfsGXO507zXNm+qEP597vOWYAAAAAAAAAAAAAAAAAAABA+y3yGkwHAQAA0B7rvW5LBwEAANA/j3odnQ5uxVSvtV43pTfQavrve1c6CAAA8lEnsMnV6QBaj8AGAEDm6ga2CelAFz73mui1Jr3RB5fE6+kdo+2kuT7o9ZA1O18CGwAAmasT2CalA13aFK8bO0b7YyBe55YHW2rAwvuBd1iz8yWwAQCQuXJg+6+hGk0R2DZ77V6+0QfPxOsTHaPtpLneaiG0NTlfAhsAAJlLV9hu9nrN606vyV5Pep3qtdJrTixZ7rW/185ej3nN9vrLa3G8P5KPvfa0sXkkena8ntwx2k6a68Nej1uz8yWwAQCQuXJgUzBb7fW017leM70Wep3ltcRrmtevXid4bWchsC3zOslrvtcGq+Z4C0Hw8PRGn9yXDrSYAtuCdLBHBDYAADJXDmwrLIS2H7wu9VoVxw+yENREqz/FKpqC2rr49ZFe82xoRQvtQWADACBz5cCmLTve8frRa5aF1Z4Z8d7XFlbR9AhUK2N6ZLqD1/1eN3qd4vWJ1/T4/WgPAhsAAJlL32EbzjFeT6WDyAaBDQCAzFUJbMgbgQ0AgMxVDWzq6vzI63yveztvdU1NDGpA6Cc2ziWwAQCQvaqB7QavV70O8fo+uVfXbl7P2th0by6NVzVLtJ3mWuzD1uR8CWwAAGSuamC7zoYCm7pIe3VZOtAnbJxLYAMAIHtVA5u6Q3UG6BVe9yT3uvFKOtAnbJxLYAMAoBW00a3ee9JmtHsn90ZTNbDJ7RY+a5f0Rhe+Swf6aCwevTaFjXMBANhGlf8Hr4PD66gT2JryhYWNebc1Ov3hBQuhtk0IbAAAtMCH8apOzrqHqY9HYBsP21v4+4xk0MI7et26Jl4/6BjtH53JuiQdHAaBDQCAFvgnHaghh8C2yes9C92l3VJY04kMBT16fNNrbvznY0v3urVXvH7VMWr2t4XP6sWhFv4O+tnF30FjVRDYAAAYZzpOSs0A3aoT2LS1h16I19mivZhq4bHheemNrdBjxpe8LvZ6Lo7p8WNxCL0eA98dx7XlyLVeL1p4r+/AeFVAezd+faLXYV5HxH9HdF8mee1kYT803de7dnVW3d7y2tHr4NKYgpZ+1mlev9jQStxKC583x2tDHNfnXmThc4v97pbFq/4OBX1GQWe6Fu8u6ne/3MLvXSCwAQCQuaqBrcmNcxUwJ3qtSW9sxacWzi2Vb732i18rPGou2mT2JwudrMXqVtrUoNWv8grbz177Wgg7sjpeFYBF3bAyEK9V7BqrHKbUoHGhhc9SkNJ2HQqre3j96zXTwrwV9BZa+NyrbMvP1XYf+jsU7/4pdEoR1C6IV9HPKyOwAQCQuaqBrcmNc7XiJJstrDBVpa0uFHi0iqR93IpD6PXPepfrZa9vvM60LTeeTQNbmeYwGL+eYmF1TqFKIbFu1+1IVnntY+HdM60M6ne50kJo/MxCM4Y+d62N/rnFPm0TLJzz+raFVUP97ikCGwAAmasa2JrcOLcc2Oo2SfRCq1rDmW5hdSsXCnNa7ayKwAYAQOaqBrYmN87VCpMesVZ9JDoW9BhTJwwUjQNtt96qz5XABgBA5qoGNmlq41wd+K5NfvVIs4omukRT/egSlXI3Z5PSTtM3Sl+PhsAGAEDm6gS28dJrl6jec9PXRWllql9dolJ0c17v9byFkHuGDTU6TPOaF79HzRdqMnjEQlOClOeqkqLTtKDmCM11pO7SAoENAIDMtT2wqetyuYUVJgUpBbIZFkLZ4vg9eg/udwtnceoAdQUZdZOORC/2a8NhBSj5LV61iijHWdh+pOgWrUrz0HxvsdBEoCYDPfrVfBfF79HPFc1XzRMy0rt8CmAKYsUGyaJmA811vtc6C/NVo8Vw8yWwAQCQubYHtrJeukRHooA3GL+eYs11iX4ZrwpUsy081tXK2mQLj4Q13+EC1mg0X5li1bpLCWwAAGQup8DWL+97HZAOtpS28NB86yCwAQCQuTqBbbxOOmiKHiOq2myBhUe9Ovu0KQQ2AAAyVzWwabf+1y28+F53hSdV7MO2sWN0bBQnJrTRgIWtRdREUXSvNoHABgBA5qoGtjacdNCENge2pRaOoFJoq/MO3mgIbAAAZK5qYDvHa4XXUdbZrdiNP+P1j47R5miT3/K2GOXVKm2j0VYPWOj8nGW9b05cRmADACBzVQObjNfGuU3Q3ms6fkq/b9191caS9oPTe2xNIrABAJC5OoENeSKwAQCQOQLbto/ABgBA5rTxqnbib/rsS7QHgQ0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAxsX/eVI6sgjsxk0AAAAASUVORK5CYII=>

[image61]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE8AAAAOCAYAAABuMEFPAAAC2ElEQVR4Xu2WWahNYRTHlyHzlJnIKQqhDEVSZM5QhDwSmR4oZEjIRUSZS0QpFJHxgZSpxAMpeVMSeZBH5UGU+P9ba92zznf2vleX43br/OrX/oZ999nft9da3xWpUqVKE2chfAgXpRP/kbFweuivgF/hIbgTXoc3bW4cPAZ3wBtwqI2fgN/hWut3hM/hOdjdxpxlsJuNb4ZX4FKb42/3sXa93INz4Mh0okIMhPNCvzm8HPqkB/xic6QFPALnwv1+EyjAR9ZuC7/BZtbn9ai1U7bYtQa2ga3gR9jF+odtvl5epgMVZoOUbt58uD70yWzRbCB97coFfxCNqAgX7ZH1GfayNp+bFRCd4Bpr3xL9IOS1aAaQ47CztTNpLxr+/KOtyVxD4Nfjj+6GF0SjZjHcC1fCiXCIaKRcFC0X5DScZm2HqcpnkdV25XOZghFGyQ/RFCQv4GjRd9nlNyXwnfpZuwA7iH4QfgTfsFVwqrVzmSn5IcqX4CKy7Bruc7jITaLpwijhi7wK809EU2uflEbefdgz9MlteA0egAdtjFHCjxBhnXwX+qyLjKSNcEAYj3hNjHCjZ4X+BCmmdi5Ml+XpYAM5L8VoIiPg49B/CodJcfO8KD+ovaMI02+QaIr5RrMuLqi9Q2GhZ4F3ToluHKM0C9bOdL2TRGtfhKnP7KmTs3B8OmjUFXm9w30OX9q/FmsNi75vXkv4CbYTfVFuiC/6ko07g+H70Hd4P09Yh4fcmdAnjKC3Un66Ooyu/qHPMrLH2txE9slwKX92Gc+k9MX/htbwpOgG+rE/RXTBd0RrDZksGoVMccKXZ0SSMaIR9gauszGHUVMj+vwlohHkp7HDtN6ejEVYyyJX4S/zp+gaCFN/m9+UMkp0YXfTiUaAG83TtdJw89PNy4MfjnuUCdOGhXpGOtEI8KTLO7T+JQyWQjqYATeZ/5w3GVh3efJXEqb6n8ByEOtiCb8Bg4lz+wsxo3oAAAAASUVORK5CYII=>

[image62]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAVCAYAAAD7J7IFAAABL0lEQVR4Xu3ZvytGURjA8SODUcgkLAab/AmsGGSRLLLZ/EhZmBQRk5KSQTKRjckgf5jnds/LdUq9b71leD+f+nbPfc7pzrd7UwIAAAAAAAAAAAAAAAAAAAAAAAAAoNfslQMAADr3Hm2Uwy7YjfrLIQAAvx1FJ9FhudFwF82UwzbMp/rZx+VGtpOvt9FZ9BJ9RqPfJwAASFPRU16PRfvRWzQRLUWP0Wvev4i28rpdrWdXJqPTxn3r61r1W3Q1uoq286x6iWueBQDoSYPReXSZfr5qLUYf0UB035gN53UnHlL97OplbCW6buyNN9br0U2qzw6l+iwAAH+oXsyeo+VUf/nqi2ajubw/na+dWosOGvebjXWpOgsAwD8aiRbKIQAAAAAAAAAAAAAAAAAAAHTHF9VGHdq4dbWdAAAAAElFTkSuQmCC>

[image63]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAVCAYAAAD7J7IFAAABOUlEQVR4Xu3bsStFURwH8COJWTEoFotByWwySRiUwaRkM8toU4r8AQwGgwUrk8HoH/Dv+P16R+67evWeXik+n/p2zvvdc393PZ17XykAAAAAAAAAAAAAAAAAAAAAAAAAAPwnR+0CAAA/8xLZbxeHYLRdAADgu4vIQ2Sn9N6U3USW2sU+ZO+UvXuZjpzX+VhkqnENAICwFrmMvEXmI8eR58hcZCtyF3mqa3PdYZ33I3un7D1Ruu8/qGPaLd0bwlx7VgZ7FgDAn7USuS9fp1ybkdfIeOS2UZus80Fk7+vS6f3eqM9G1hu/ryJ7kZPSeU5zLQDAv3dax8U65obpMbJdOn8KGIksR1br9YU69iN75+vU7P15Spf35+lar+/XZkr3WgAAfsFGuwAAAAAAAAAAAAAAAAAAAADD8wHZ/B7DtBDxsAAAAABJRU5ErkJggg==>

[image64]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA0AAAAQCAYAAADNo/U5AAAAkklEQVR4XmNgGAUDAFyBeDkQhwAxFxCvBWIZIN6LrAgdRABxDhDHAbEtEE+Aik+Eq8ABNgGxJBDnMkAMAYFCKC0PxHOBuBOInaBiYHAYSk8BYnMgVgFiLyDmAOKNQMwDxEkMEK/AAcgp1UCczwAxsQgqHgzEM2CKiAVRQFyJxNdCYuME7EDcD8QVQBzGAPE3HQEARUoSHKRMseoAAAAASUVORK5CYII=>

[image65]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACMAAAAQCAYAAACcN8ZaAAABKUlEQVR4Xu3TyytFURTH8eVVhIkipJRSzLyKTK9u3dG9UqIMDKQMGBoQyUAeQyOPMpVIRpIMPcrEwB/gT/H9tZZyT8qNqwzOrz6dc9a5u332vmubpUmT5n9mA2PJYjlTjVvc4xrDxa+L0oaaZPEvMo6TZLHcqcXaF5Y+/aaAJ9TF8you4v4OreZjzqOmTOIgNGMRV+jCKNaRx+7HgFLSi1e0YxBDGMFLvN/GgPkEj1Hrxw0qMIcWTOMMnVjBBOrNx5ccrfYYb9gznyCL/XivyZSc+STKDi6xbP7hinrpIe71UeqvJsxG7cfRX6iVamUzUTsy36EMNuOqNKIDPTiM2nNcp8x37VfpMz9d6qXKqKk35tGAbpzGsxpfJ7LK/DQuYMt8F9Uzab7NO8jKLBZbjhqxAAAAAElFTkSuQmCC>

[image66]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEkAAAARCAYAAACRroFGAAADC0lEQVR4Xu2X6atNYRTGl5lMGTPfMmX4YCpEKDPJnCGUKZGQsZB5nkXmREQyZCwkSWZSkk9S/hSeX2sdZ5/tnivTyXXvU7/O3uvd+5z9vnutZ73HrFxlWvdEnXSwXLkqSgfKggaKDWKn2CbW5w6XC42Kz1eiq1gsGol9YrtoKh6IhmJvxFAFsUXsiXhjcTrO0Q1RRTw1/75Sr7biWuJ8jHmGMWl0PGJDxKGILbRs1q2O8V7ilKgsXsYY2Vk7jv+opotP6eBfUC3zUpsh1opqYnyMbRWT4nhefO4Q/eL4uTgolojmEVshpogu4kjElsZnsWI1eYAD5l9E+jXJuSK/2ojL6WAe9TefRN04520uzw6XKO65YF4uPCcTzJTGFdFM9BbdIvZadBYtxSPzOSJi6LxoJSaLlTG+IMaKFQ/PQ8wxT02MsUHOFfk1wfxHfiQm0EF0MvcN7lskqiYvSunLP0KOzoruiXNS+6J5KpO+myJeXZwRu8Rj80VGeMM5cyPFRJPijWU0TrxJnBdCG8XgdPBnNM08Td+buzypXNH8S9+a13E9cSeuXyOWxTH1XkO0M19ktN++L9fZieMR4q5lPaUQ4qUxt18WtUiNUmazxPCI1zRfBDTWvDMg6p3SoVSeRAxjZLHziUXD5Oeblx7ZeFscTV70C6IjfTbPYLYEBdcA89JBJ0RPMVp8iBjlRZsdJo6JvhGnE7WI40Koo7nP8bt0vswW4aH5y1knrkYMYR/MBzB/vPGmaC36mG8X2CbsztxQkiipzAaOjkIZFZl3mMPm2XdfjDT/Aca5Z6Jlu8nviGxjgmmSGcO+6aNob17yZOm7GKMy8Fgm/iJi2ArPzAZzrvnGcqp5h2ZuWAlNhSri/lIvvBDPJKPpxj3EUPMXiFgEhAcyeUSzuS5WmS8owqsytsJi4V/1xcyIlWox0VvimfnejoUiy8gMMgEPROysyahBYnN8InbX2AL+ejJima5L8yLL/kvxn45Fo9HQoRHewyYWz6IkL8U5WxFsoZJ5t6WB8X+PrMOTvukrS9mgEjFv6KkAAAAASUVORK5CYII=>

[image67]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAQCAYAAAAS7Y8mAAABCUlEQVR4Xu3Sv0uCURTG8UOkFAkiLkVBUASuOrgEBREUEiIoEWiDNIVDEDjYIk0V9IsaxMlIcGhycHGMwEFwiUb/GL+He4Tel4SGlsAHPnDe894L91yuyDTT/HUKGPqb48yiigecoY1Fz4rJWcebvznOFsI4QQnXiHpWTE4WZX/Tnxckvn0fo4VDXOHS+nNo4Abv4g6m2cEr7rCkjTzi+EQAR5jBLgZYRgQdXUwucG51D/PYEHcwzb3YVZ6iKe4Kiti3BQviNmoyqFjdRwxBfFjvUdwBf5VtcWNp6kgijS/r6ehP2EMNm9YPYcXqH6PjHlitL0ZHXMUtnsVN2UUKa/Zf9+TEvbR/lhF+4SYVWlSy5AAAAABJRU5ErkJggg==>

[image68]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACMAAAAOCAYAAACl66WxAAABSUlEQVR4Xu3TvyuFURzH8a+fRZjIIEJZJMqAQSmLLGKwSFwpC8WI/IgBw01RyiZKSVmUpMwmG8VishDlD5DyPs8597nf+3Q8iunW/dSrzuee09PpnHNFcsmSdOEeJ2jANL6w5uYX8YBu1/+aYuzgDfOoxAFeMKvWySGG3bgcn8hzvR9Vbvzf9OFc9Qnsqx5kF1NuPI53VLie2mQ01WhUvQDNqvuyhC3Vk0ioHmRV7NGVYQCPqEOPxJ/KjNiTNJlDiZrz5QIjql+iSfUg5kObYhcW4hZtGNWLPCnCgtjjNu8tLvn4EPtulrGCp4wVLuZjR5Le9TW2UROu+DkJbER/9KQFr6q3S+b7CTOEZ5S6fib2Pn9Lp9gHXiueu49kEseqm9tYVz1Mr9jJVPbEPtC4mPkx1TvEbs6XQdzgCq1i/yR3OEV9elkuWZBvSYEwYSYYxOkAAAAASUVORK5CYII=>

[image69]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAaCAYAAAAKcQDQAAACjUlEQVR4Xu3cz4uVVRgH8CNGmlgqCAaGkYuQpE0LWygOUUSJWS5c2A8G2wQGIkWgqEwK/SBSKlAUIilJV9FCt2KLNrYogsCV/Sv2HM653nNfZZhLXt8Z7ucDX86PZwbmndXDPfc9KQEAAAAAAAAAAAAAAAAsEvsiVyLru4UpsyxytrsJALAYfBz5KPJ5tzBl3qrjayO7AACLwNbIqcixyLnIV5EvI0+1PzQF1tZxZ2QmlQZu97AMANCf5ZGn6/yzVBqVG8PyVLnUzJ+MbGjWAAC9GRyFfhD5NZUmJX/K9sbdn5gOq2reb/ZmmzkAwJL2XuRkd7Nnf0Ve7m4CAPTlh+5GDybRsP0b2dzdXKDvk4YNAHgI8pfef4xs6xY6XuxuVIcjJ5rsHS0/UOM2bEdSOX681i00rnY3qhfS6HPldGnYAICH5u9U7gjL5lI5ftxT179Evog8Wtf5Lc/8huc47syTgZVptDk61NQG8pum4/gtlbvfcqO3PZXnyg3mwHepvLma/RQ53dQWIjdsrzTrLWn0Gd5saln32e/3fwAAuMe3qbwU8E5dD+4I25GG11DM1PHPOvYhNz+/1/mFtjCPy5GjkXV1/XgaXt47aM6eiHxT5+PKje7P3U0AgEk7XsfnI6/W+aeR1yP/1PVzdVyo/HvPRD5Mw2PNW6k0hZP0UuTZOl9Rx3dTOba9GFmTyjOer7XVdZyk/Pf8EdkfuZ76bYIBAO7KR4/ZbCqfaP1fj3U3lphddbyZSiMLANC7uVQ+vcrfi9uUhkes0+iRyMY6v90WAAD6dCDydp2fScOGZRodbOafNHMAgF7l74zlG/6zr9vCFMpXqAy0b5gCAAAAAAAAAAAAAAAAAACwpP0HVS9UaKxLvqwAAAAASUVORK5CYII=>

[image70]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACsAAAANCAYAAAAwqJfrAAABj0lEQVR4Xu2VSytFURTHVx55RJQimRwDIgZIUZQiRj6AiURiICbKM3W9Bt6vEWXCVCQzA/IFlDLxGPsKpv7r7n22tde5XQ7T+6tfrfXfp3vXOa1zL1GGDB4jsMrWc3AZrsBsd4VPA9yFCdjlH8WiEPaJfhRWij5CLVyzdS9ctPUSbLe15hbmwhx4qc5+Sxs8h3ciy4c7oo/AT6jF1gk4bGu+yylbS3jIV9E/iTouAfnDMgewRGWOZzIDMIdwyNY89IatJeXkD/sOi0Qfh4Ciw47BHpUl4Z18FP0e+cNuirOQMooOWyz6OAQUHbYDzqgsSQG8Ev0CmZeNGYfT4iyE9/RN9C+ilvD+8d5r5WoF8F70TAU8U5njWtSdcN3WvAKtZL603l1huCGzV6X0/YLVkbn5OATwQWWN8ERljgvV87CzZH7CmGr4SWbokCa4Bfdhjc2O4aq74mf4M47gB5knnmXzfjgfXqQ5JfN7l44BmKfDFAzq4A9MwmYdhvAB72c6JnSQgm4yfxb/gV/4bR0yX0FsNtcdCdFoAAAAAElFTkSuQmCC>

[image71]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAOCAYAAAArMezNAAAAq0lEQVR4XmNgoByYA/FiIN6HLkENoMBAb4NZgbgPiN8DcS0QdwPxdiAWRFaEBygw4DAYBJyAeC0SfxoQFwAxBwPEMnSch1AKNng/Eh8FVABxExJ/ORCnIPHxAQUgPoguCAMbgNgPyuYH4otAzIuQxgkMgHgyED9jgPiECVWageEFEPcwQCRrgFgdVZo8oAHED9AFqQESgHgRuiClwB+IjwDxLiA2RJMbBZQDAJUGGtUk1PIoAAAAAElFTkSuQmCC>

[image72]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAtCAYAAAATDjfFAAADzUlEQVR4Xu3d26tmYxwH8MfZBUKORUlkEkmIZHIhFw45XDhEppiQuCDncs7ZOI7EFCUllHKoySGUFDeUGxduXPgH/APK7+d5Xp69zLv3+75jmXfy+dS3tea31mrv5urbWns9qxQAAAAAAAAAAAAAAAAAAACYxVfDwYJOiNw8HAIAsP0UNgCAJdcXtusij0VejZzXzYe+Hw6KwgYAMJq+sK2PHBu5JnJ2N+8dFPl4OCwKGwDAaPrCtiGyJXJyZF3kxcjlkW8iZ0U+iGyKnBv5MLJP208KGwDASPrC9nbk6VJL2i6lFrV9I1sjz0ZuiHwa2a/Ux6Y9hQ0AYCSrvXSQ5S29Fbk48k7k88iNkecj90QOb+cobAAAI1mtsM1DYQMAGInCBgCw5BQ2AIAd5KLIrsPhNsxb2F6LvDEcFoUNAGBuP0d2Hw63oS9sV5X6RujVkbu6ee+FyOnDYVHYAADmtkhhy3XVviv1DdBzIi+Vuohu3q07OvJ+5MfInpFbIq/Uy/6ksAEANBsjz0UejJzWZvcPkrKw7dH2V9MXtv1LvcOWpS1NlvXIRXN/HcyOaNuJRQrbGaUuE3J8qXf1flp5GABg57RXqYvaprzjNU0Wtjx3LX1huy1ySKnrrKVcey2dWOqXDdJlpX5ndPI7TCxS2FKu5ZauKLXAje2T4QAA4N92e7d/Zre/qHlfOphm0cI2KZ3Hte2hkwNzyrK3eTgEANgR3i31see9wwNryDtYLw+HZfzCdmtZ+bj20pWHy7elfv5qt1If895X6tutD0U+aue8F7mz/H1X7+5S31Q9MPJU5KbIF5E32/He65FLSn2UuynyeKnX5f9FXpd3FJ9p5+Yj5IPbPgDAwn4ZDrbTvIVt2mPLWQtbFsfe75E72v61bXtA2z7Ztl+2bfqsbfNv334r9W/69o788NcZK30dOazUFyeeiKwv9br8XfK6dGXkpLYPALB05i1sDw8HzbTCNo9cSuTUUu+w5cfm887aMZELunPyZ2RZy3KXd80ujJxSapGbvHDRy++gTv5OLj9cn3f48ro8N69LWyIbIg+0fwMALJVlKmxryceX55dasI4cHJu4vktf9AAAdlrTCtu68s+lQtIj3X7vvyhsAAD/S9MK2zSPDgeNwgYAMJJ5C9s0ChsAwEgUNgCAJaewAQAsOYUNAGDJzVLYci2ztShsAAAjmaWwHTUcbIPCBgAwEoUNAGDJKWwAAEtulsK2udSvHeQ3PqdR2AAARjJLYZuFwgYAMJIsbFvbdnsobAAAAAAAAAAAAAAAAAAAACypPwDVOpHj26nnVgAAAABJRU5ErkJggg==>

[image73]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAtCAYAAAATDjfFAAADiElEQVR4Xu3d28stcxgH8J+NLYeSXYqSRMqVUymUGjshOaZwJznk1CYh5/NGEolEkeSC5JzYEltOF4TIv+DGjX/B8zMzveNpbXvWWu/bO6/9+dS3+c0za92sq2+z5lAKAAAAAAAAAAAAAAAAAAAAzOumyBN5uKAmDwAAWJ7CBgAwcbmwPRh5NvLBYJYdE3k7D4vCBgCwJnJhOzhydeTJwSy7NHJHHhaFDQBgTeTCdlLkt8gVkbMiP0UOiXwcuSdyW+T7yP6RbZE32q/9oxmsAQBYJbmw1QJWz66dGzmwtOXs4sjdkR8ix0W+6T57RLftNWkfAIBVkAvbUD2bdn5pr2l7JvJ05PnIZ5HzIo+Xttj1msEaAIBV8l+FbV5NHgAAsDyFDQBg4hQ2AIB1dGoezLBIYfsyclUeFoUNAGBuD+fBDLmwbY28FvlxMMu+jeydh0VhAwCY2yKFbXtpH+OxM/Jy5M7IjsiRkQsib0Y+7T5b7xy9sVtXzWANALDHOjbyTuT+yOvdrD4bre736T0yWO9KLmy3RF4sbTmrj+2oj/X4OrJfWXlIbp1t6dZDTR6McGXklcgBkZcip/z7MADAxlTf99k7ebDOHsuDGXJhuz6yucvnpS1m70Uuidwe2au0b0M4s/t8LYu9ZrCex+ndti+Y+0a+6taLeKi0b2kAAFgX9dqxv7r1GcMDC8qFbRlNHox0a7etRa26uT8AALARHR/5M3Jf5K50bHdeiFyeZmtd2OoZuuHftcO/bHtPlZU7WusbFH6OnNbt17OJz5W2qNZr5h7t5kP3Rt6NfBE5rLR/GVeXlfY6vEMjH0aOjjwQuag7DgCwJl6NXJOHSxhb2E7IgxmaPCjjCtsfkXMG+793275Y1ZJVXdhts7NL+8qs/nepL6mv3i8rRbC+E7U6vMy+/g4AYLLGFrZ6Y8DuNHmwgHpDQ38t21GlvQGiXku3T+Sjbp6dGPkusqnbvy5yUOSt0l57V79b72y9obRlzhk2AGBDmVphq2fT+hsadqWWumsHAQD4X5taYQMAIFHYAAAmbmxhG6PJAwAAlqewAQBMnMIGADBxChsAwMSNKWzbI7/k4QxNHgAAsLwxha1ylygAwDpR2AAAJk5hAwCYuDGFbVvk18jWfCBp8gAAgOWNKWxjNXkAAMDyamH7JLIjsjMdm1eTBwAAAAAAAAAAAAAAAAAAALA+/gbmm4OVlqN5tAAAAABJRU5ErkJggg==>

[image74]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKYAAAAQCAYAAACcGwQfAAAFc0lEQVR4Xu2YVYwlVRCGfxyCBnc2ECzYokGCBHd3XTa4u8vii7vbAoHg7gQJsmiQhAcSXnjBXoA3whv1parmnnu27zLMcCeXTX/Jn+k+rfecqr+qR2ppaWlpaWlpaWnpD7OabjD9brrQdKXpK9O65UkDxkqm50w/m2aLsdtMP5p2z5P6yNKmb027xP42pklDR4fHvKYTYvsW01/FPsc+NT1gWjjGZhSOMC1RD/ZiS/lCJ5ua3iv2B5FzTFNNO8f+Uqa9Oof7zlPyAIU5TIsWx4bD7abFYnsu05+mmWKfvzfG9ozGnKbr68FenGs6uxpjoqbHJNPW9eAYcprcYR6OfZxymc7hvvNZPfAvWMj0ZDX2izqBym8ZXxwbNEZSIUpuNs1fDzbxvNwlE8pHmcFNYMdZRscannu03KX+MM1jOrPrDGl704PywN1AHsQEA+e9JW9hyFwm6WDTQ6aJpoNML5vGyaGluTjOuzXGljc9FtuHmp42LRv7e5h+Mj1iui/G9jXdHVpE/oxL41hCoK9jml3+PGCbtekXzMmO9eAwGEmFKDnKtFU92AQTicUmu5leKfb7ySny3rYWC9yL9UPAwh1oOr1zWKuaphTbT8hd6At50lFG6VO5x5emmeP4nXHNNfJEJeDpt1kIjp8fx3neqfLEJeheU3ffRI/4kmlN09qmN+Tn0l8RmBeZ9hk626GVoi2hEiwXYxuqkwz9gHdMlx5LNjGdVQ/WsEAfV2M4za7yScRV+CBi4nEaIHBwCWDCLzNda7ouxmjmn4ntM+Q9LPfZKcZGC26Zbp2BQaAkk037xzbP5F0WML0zdIbDexGEwPvnh9P78r6PBMX5gGBKd7lJPrlASSqTmOuYz71j/2p50LEQBBown/XHJUlBUF4S+7zb23In3yLGSAjarvvlrsPasVa8D8l2WJxH78takEisBZSuvbjclX8wXSBPzCa4PteRd+G6ukLU1eBE0wvyqrKxfN6Yx5xnIBmyBevJBPkXbcKXZpYpbsgEMRFwl2lF+QMzmI+XPxyYNCaLSf8kxnALXGpbdT5USno55n7lSRVlEOL0v6m7NFBCN4ptFnY7eYASsCW8L78RPpBP7JKmF017yh2OxAKCfy3TanEubouzsVAsBn0X8Ozz5AnLGCU73w0nJWiO0bQllED5Xt1f4Y+bVoht2pEMEv6LspncPGhDCHR+B+0LCfuufF5IhMvV7NpryIO6F6wz138d+8wdyV1WiPq+lPcD5C0Tc8M88EE6d1yfrG66p9ifBn7MR/KeimAg6q+Q918JP4yXAbIUdpA/FKbKM/Zk+ZcxMIlkMHwYf3lWTvJoYBF+VXep573LZno9uYsT9AQO8BVfOzaZv2Bss5jA5L4uv3ac6VXTHfJqQUAwNwQM98dp6Bdxg5XlyfCN6VF5i0CCssCcz9zxzlzPR+Ox6uZIdVqFhHskVJycf96FIAecEfNINlcngI+TV4Em1z48jk8PzCRbCQIPygrRdF8Sg5gAApQAZo4nxBhgUJjCqODfIrgIDyZD4F55o44TsKAZyLgJMIGHyK0f94GT4m+LB3zt3jWUymflLkWwTZEnPHNNtSJoZpEnfgYpUPGuim0CA7Nocm0ci8RpqmIJa4YD4ng4M5QVoum+q6jjhp/HX9oqEj7h+oylEUOQ4QDZUwEOxTgfB1g1JR43oGQC7kGfgQvgJjgBgdzSgfaJfrQXuMyb8koGVBxaLCoRbRJ9NtAPl7AmfOzhZt/FWJNr43K0OVSXXoyXV1RcN/vQskI03ZdkodRTEahuVNZsl4Dj+S3SMoDghLQ//zX0xvPJ26b88PkncE1MpBTVrh9M1Nj+v7llQODjCzfE2coS/7/hbx36/1nh9wSHAAAAAElFTkSuQmCC>

[image75]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAOCAYAAAArMezNAAAAoklEQVR4XmNgoByIAfE0IH4NxCxoclQBtxjoZbAFEN8A4t1ArAUViwbia0AcCVNEBMAwGATagLgCiR/OALEQBtKAuBYLFkBSAzKYFYkPBtlAPBmJX4fEJhaADGZHF/QH4rVQdhwQqyPJEQIgV4Mc8gmI24FYCVnSBIiPAzEvEDcgS1AKpIH4MQMknEHpkmoAFJt/gbgEXYIa4CIDaiyPAuoAABw+GHmFLjrAAAAAAElFTkSuQmCC>

[image76]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAWCAYAAAB9s8CrAAAD50lEQVR4Xu3cW6hVVRTG8ZGal8ogENIudB7yAgWZCkYpVHRDSotICRUkrAwVNQtF6WI3oqKLFJUgmmCEihppJSUeDLth9WD1UFQPQQ891kP0VONjjsmee3rUc/Y+xt7x/8HHWmvOddZeez8NxpxqBgAAAAAAAAAAAAAAAAAAAAAAAAA4La6qBwAAANBZNtQDAAAA6CwUbAAAoC2veH7yPO95q5obTC97Jsf5H57HirlW6Z3lQ8+55UQfLozjbs/vxfifnheL69r1nhc818T1sjj+HeejPV94xngmeR4pkj0Rx2mem4vxkxlm6b30nG88U5unB2R9PQAAALrLbZ7X4/xgOTHIbvc8F+fLy4k2zI/jJU2jx5tQnD/k+aq4/tlScVRTcSUfW/qNPojr8+P4l+eMyEsxdiJPFecnKw5rKhZlpqe3GB+oK+oBAADQXd6zVET0em4qxu+xVFiNKMbaoWepU3SdZ2KM9Xi2ee7z3OlZ53nXUufqLs/TngWeLXH/EM+Tlt45U2frmTj/wbPDc7alIkXdQ/k2jvKw57U4f9wa3a/y2fru6jr2xNxRzwXWKBDlS88UG3inUF24/tobR31HFYi1cZ4z68ET6O99AACgA6nIUZfoI0tFS6YlzOnFdV9WWvMS4B3N000e8Ky2RjdP9JkjPd9b+ttbLD1H3TgtYZ5nqft1a9z/YBw/jXmZ49kY5/oe6uKNstRFU9E21PN1zIs+Y62lz7vMMyvGy2eLisvsRs8hz6PF2B5L73Wq7l6t/I1P5bc46jvuLydawL9UBQCgi+V9YP94hlvaD6blwMOWCiAtBc621OlS4aCCJ6sLtnnFXE17veT9YmxNHJ/1nFOMz4ijOmzymaXi6ruY0xKk/ibvB9PcxZaKGhV4N1jzRn917Upaauyx5q5T+eyFnlWeiyx1tq71HPMsyTdb6qz9WFwPtkWeV+P87TjqvTd73vCMt/S7yAHPYktF2ecxpq5c2THVdwIAAF1Ie7NU5Fzu2WlpefDXmMv7zXJnRxvvW3W3NZYey2VFLWUutVRkXV2M526X3knUzVKnTO+gYuUTS3vRVFCJumVned70/GKpENPSqDp1siuOKrL0LlqWVMGj+/M95bO1Z2xfjN/v2WSpGFIhmN1rrW3m7+8S8xFL76B3zHvstBdurqUlZNESsuj3yR20vNwrKrCzXAQDAID/ARVoKlC2ei61RuGmjlu3urIeaIOWW9uhTmSrVKhtr67VmXzHUtGqwk7dxFxMao+d5MIWAACgo42tB1q0oh4YAP3XHFpe/q/lThwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAoGP8C3IbkUxwnOF5AAAAAElFTkSuQmCC>

[image77]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAWCAYAAAB9s8CrAAACrUlEQVR4Xu3byavNcRjH8SdDUihjhuImQxEKCyllY55ZIJQUZR6SjBEyz2MkFmxlZiEl0w4rbOyEjYU/wefpeY77883iqutS5/2qd7/zG7rnd+7q6fs7xwwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC/M0DdVrvU1eJcS+qkDqrjam9xDgAAoO4dzW1b1bV6ooX4+z6p7O+pvAYAAKh7rdUXdVE9KM6V2qke5UHpVx74Q1/VwMp+ezVK7VZnLe7xtFqslqlFqiGv9VXB8Wqe2q7uqFZqi7qnhuR1TbWu2L9W7AMAALS44eqmGqwuFOeaQxeLx63VSp/KA/LWYkDcoQapNxaDmA+WbpzFYOcrgtPUHDXZ4u9vUhvVK4vVuz9xo9h/UewDAAC0uCtqhlqonqpe6nGee28xxPkQ1Ec9yvPn1Ji8bpY6k9e/Vp3V/dx3TRnYPqr++XppbjfndoQaavE+rrvqreaqiXnMz3fI1+5dbk+qSWqNxYB3ymKlzg3L7VqLlTv/+/4Zb6mO6oOaqfbldTV+nz7ErVIr1Oo87ltfJRyrVuYxAACAZuGPQ30o66vuqvnqvMWPAL6pl42X/nxk+tlitetE7vsw5HxFa7balvtN5UPQZYvBzwcs99Divvw92lgMfjX+WHaDxeqZr6T1tBiUao5ZfC/vuZpq8bl8MFtgcb1/tpqRFtc7f6zq9+7D23W1U03Pc1WHLO5ricV7O78fXxH8ribkMQAAgL+imzpgMbj4oHS4cu6IxaPTS2q/Na6K+eNI58ONr2rVBrn/ha+qrbdfP4uvutV+jfost76q59+Ja7AYGH0F0T9naauakq/9/1QbUH3A88ezAAAA/5x/762eLK80ujgHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKgrPwDcnV64uzEGvgAAAABJRU5ErkJggg==>

[image78]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHcAAAAQCAYAAAAsyOBoAAAEDklEQVR4Xu2YWaiVVRiG39QcyspKbLDiQIPgiOlFCU1kUpnNWumFJZKgQgpOldVpTrTAIiXLMhJF00jFEvVohNOFCGKUBFJXXXXlbRf2Pedbq/2d/2z3+c9pa2L7gZe9hn9Ywzesf0sNGjRo0KBBg7NJD9Ny0wnTK6alpi9NF4ZraL8g1OES0wuFtnowzXTS9LrpNdO3poFtrjj/uEk+zxb5Wn9umtPmin/BBNPKUOclj6byVNP40Pe16eJUnmkaFPrqwWWmn0O92fRBqP+XdJePryNmmx4sNnYATjU5lXGsv0xXVrq7Dl6CxwAe+afphlTfl34BLz8Q6leY3g/1enCvaU2o/2B6OtTL0GwaW2wMMO4txcYSsDZPFRursM10VbGxA/bIPRgY+1FTt0q3rpFf81yqN6v2HP+BweAd78kXc1xqv860N5VvNH2R6nhzZn0o14MFps3y8EQEmd+2uxQsREwr1WgqNpQAr621uXg2qeR302K13ZxacN8f8jkTQbfL17sI6z8ilcvMsZVf5TkV7VJlUPeYPswXGbNU8fDMN2o/iVvlA60mvKYWG+T3wyeqWPO5QD/V3lwYJt+EzjBcbtBAmlsR+iJEUQyhNLeYdoc6ITmHlPtNc0MfiX5oqMNH8mfUi99MvVJ5k2lS6FsoN7Z1psvluW2j3LsxSowTA+K+DNFnmell+b13yOfBmYKDGgZEtCAa7VAlHWUwxmyYb8sjVa5nI4wQNjmLFLnedKTYmJgu93gYKQ/JGc5DvPMd0/epLc7xCdNa00vyVDMktbfCpEjmcK3plKmnaYBpsDxUZw7LvZQXZnhxcUFqee7V4boiTaZDof6T6T75WJ6VRw6YId9YNogx9Td9bLrZNMZ0MF1H2CKN9DbdZnrLNFEeMvnl2U/KDRRITbencjXKeO4q0yjTQ8WOGnymypo+I0+NjB2D+EVu7A+b3lT7OT4m93QckfVlD1vhgfvlMR6P5MDEafgN093yh8acipewAJeGth/VPix3BUITHsmG5tP5InkOIhUwzmwYS+SfCiw2h4zIA3IrhrtUCXd4U/4C2Gnqk8p4RN4I5pKjRjXKbC5RgE/J0cWO04CRkm/ZoL5yR9kqX+cppq/SdRhkHmecI7A2GHCn6ejAtLrYcIY4ln5ZfLyVjcYIYmSBT+WRg1M3xvtuascwCcNNcgPGa4FwTujFSzg/4AmnM9Yym1tPMOp58nRD6iRkE3bjHDGI+EXTKbAsvLoaj8hz2NkAK34xiRALeHb8Bgdy6PPySSMOaHj68dRPWGNz70z1lvRLbianVcuXkRi1zjRNpu/k48UISStE1zhHQjTz6zKvqv0/VBfJDzjnMo/LN4PPinjqb3AewEGFHIjX8wfE/4a/AXmhrIOyGNnQAAAAAElFTkSuQmCC>

[image79]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAOCAYAAAAIar0YAAAAP0lEQVR4XmNgoB4wAeJmZIEyIA6DcZKA+C4QNwGxAkzwPIwBAkpAvBxZIBaIC4HYBohFQAK2QLwFiCORFJECABr6B2V1siHPAAAAAElFTkSuQmCC>

[image80]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACYAAAAQCAYAAAB6Hg0eAAABUElEQVR4Xu3UzSsFURjH8YeNklAiSjYoKYlE8rKzESVRFBZeFsr7RlI2ugkbykZWpGy8lJSVEisr1tYW/gzfxxwzx5NhFm5K91ef5szzzO2ec+bcK5JJJv8rnXhBiW38dbLxbIvpSqu5rzP3fupxbotx6cIJBpCLM5Tjxn/om1RL8FlNLXq8ns0krjEnCSY4hBmMoQM7rr4bPvFzdHG9mLYNk30Mu/Edsrzel7lEGWYlmKhm0V1LsY09NLuaTR6O0WAbJo/IRyGuvHo7NnDg+mHu3VW/vAVV6Ha1CaxhEG2u5kdXvYwcTKHoczuMHpMHNx7HgkS7dyjBEVhBgau9R1/bKuaxiSWvV4lbvKLYq39kVKK6TjLudTZhy431rRxJtMN9eJLk51oqcOrGupv6o/jt9EuwU7qoC9OLjZ6FFEYk+HNMRxqxLsEEa0wvk8R5A7iGK/wjaV0zAAAAAElFTkSuQmCC>

[image81]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAbCAYAAADBLdN1AAAEpUlEQVR4Xu3dR4hkVRSH8WNWTJgzghkjBlRM4JjHHFAwZzEHjANKo5izOCZEMWIWFROmMSLqwoXgwr0rF+5c6vnm3kvdLpxNT2tXFd8P/rz3bnVV16vV4b73zo2QJEmSJEmSJEmSJEmSJEmSJEmSpKW0f+b5zIJ6fEj32qRYNvNwZmE3tka3L0mSNNLerduTpo1OlreHB2bRvMya3fEz3b4kSdKs+DPzW2a5zJmZN+r48ZkXMk9n1s7cnbm4vjZubs+8mtk9s27mvjr+SebbzF6ZZTL3dq/N1OXDA5IkSUuDS4XNVVFmit6vx6vEYNaNou68zMqZ/TJ3RrmkeFnmscyJmRcz72R2yDwag+KOGScuR+6bOSPK/5krP9Ut3x/HZb6v+99lrsxsknmkjl2buT9zZOaGzMuZtTKvZa6LUuSdU//2zSifu2I9liRJmhU7dfubRZlhazNEzKxRkHBP22d1bPvMc5mjohR3V0SZmWM2jsLt5szGmQOjfA5F3zqZXTIHZ06Ogs/9PzGrtkHm1nr8Q5Tz/SXK92UG8Yv6GgUnM3H4OHNolPO9NHNRlCKVwo/PxON1u0dMvzQqSZI0Z26KQcHVtqtlvqn7FGmguKNIa1aq29OjFHij7MLMhlHu76MobSjUGL+rHnPeFHpb1uOpzBF1X5Ikac7cljmh7t+RuSCzT5R73Bpm2pilWiFzdZRLj8xAgWLtsLo/qraNcl73ZHarYxSqe9d9LpGCgu3TKJeWn8q8ldmqviZJkiRJkqRJ8PcYp8eMXR/uOWuG3zcOkSRJmjjDBRv3kUmSJE2cqW6f+9CweTfWvD48MEZag1xWb1hU99vDDj2e9JQkSRo5H3T7rdfasOWj9CMbV/RKa/7q9oe9NzzwH9g0c3R3zNOxkiRJS7Rz5vPu+MYo/dVag9hFUXqU0Wvs3MyeURrBPpA5IMpKADwJydOeoDEuT4Hy97dEeYJyFNDYF8dGKUrp+/ZhHaOXGt+T3nPP1jHOgUa4oAUJTXPbcesxt2uUfmzn1/GZormwJEnSElFs0KICFCEbRenKz6VDUHRNRVmVYMco3f3pRcbSTatnDq9/RwHHDf+/1mNm4x6KUuiAoq81p2VBeT6H97AKAsUhBdSTmfVi+nJXjJ2V+WjxO2dmm26fguyYmL5yw89RGgCzMsElMSjMaPKLVeu2FaXMkIHvyKVWWnrQDJjVHGhjwm/WflPOld+LomxB/Zst6msUkXzGl/VYkiTpX/2eWZh5JQaX5pg1oicax1xKpGBhySUKLGaoWIaJZZvo7t/WF+VSIs1ymak6JUqB8kQM+qq9FGUZK4q4hsJpqu5T+FwfZVmrfrkr+rnhq7qdCdYE5YEEij8u7eK0GPRSo3fcdlH+P6s1MGNIQcl3pnfaNfU9D0a5t6/1mNs6yu/Gb0VfOYpUfieK3rMz8xe/K+KPum2zfO03YFUFlqv6uh5LkiTNKYqVU2OwXBONZZldakXNQXVLgdQvd8VMHktF0Xi2X9901FDw0SD3x3q8fpSZQbD6AefbUKBR+LH81bwYXH6WJEmSJEmSJEmSJEmSJEmSJEmSJEmSJI2tfwCOUAIf9Az9+AAAAABJRU5ErkJggg==>

[image82]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEoAAAAQCAYAAACxxengAAACpUlEQVR4Xu2W2avPURTFlymEzCGKFIkkQ0hEyDyrq0SZHxCReR4yz2OGkJQkhUxJuC9ImR78AffJq0ev1mrt43d8kzd17/Vd9amz9/kO5+yzzz4HKFWqVKnar8bkJPlOdpKD5DMZnD2zh4zP7P9WY8n9zB5FqjO7C2mS2UWtJlOKzvqorWRzwfejYP9Nj0inorM+6gGcRUkd4EA1gLfjvaxvJDlErpK2ZDepITtIQ3jLyneGnPMrWEhukyr43b3hl5SNF8nhsPXM5aBjeqi26BtpltkzyRPSi4wg77K+m2QanIWtSX9yI/pawvWtKZlFtodf9e0j6QoH93H455E1pBG5RQaS5/ACLUMtC1Rv/B4ISROfEe3JZFvWpwB8IS/DXkxWRlsB1oSlXajUrRbkbbT1voIsfSLdoi0dgWvlJjI88y+Fs/Ro2N3JNfh51Vdl5V2ykbyAAz2AXIcze0z49pNj5DgsffMsnPEad5rzH7WInM/s6fA2SdIWG0TGkTnwJPXTVPyvwNtNWbaEbAj/M3iw/chociL82lJD4UF9hb8l9SX74P9IrVAJYjU8BvUr8x/C2av/TYCD/wEuGRdIcziD28NjmEpWwYsnaQ49yTB4sVQy9I1inf4lZcAbeCuoFmkSB+ArQ5J8K+CBabBaFQWsT/Rr9bUdh5Ae5Clcc7SyunboW+vhQEqnwq+s0OB0HVlOJsFb/Q78v9mojEMTrIGvKXPJpfAntSGvMluBUQC09fUdSRl9mqyFS4Ckf6Ys1ZhUf+us0gQ0OR0O81HZupIyUYFJh4GkmpgfGMrq16gEXrakA0jJIr2H621KgDqnBfCWUBar1umgUFZugU9I3fHUVrCSdOdTzVoHZ21nVDJRGTYxntNp3i7auuIo2KkUlCr1j/QTCyp1VI8lgtUAAAAASUVORK5CYII=>

[image83]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAcAAAANCAYAAABlyXS1AAAAV0lEQVR4XmNgoAsIBuK9QByCLgECO4DYG4gN0CVA4Ay6AAhwA/EEIL4IxOVocmBQAMRJ6IIwMBuILdEFYeAoEHOhCxoCsRMQb0OXAAF/IN4NxG7oEngBAIn6CjXQqR1KAAAAAElFTkSuQmCC>

[image84]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAL4AAAARCAYAAABjPhamAAAFPElEQVR4Xu2a54sdVRjGH3tX7F3X3ogdu8bEXrBjwR4bir3XJCqoUWMvWLC3iGJHVETsqCixfFNE/OAHBfE/0Oe37zk7J8d7FfQue3fv/OAhM2fOzNyZec/bNlLLoLGI9as1f9pfxvrRWro4vlLa7sTZ1v71YEtLv7Oz9Xo19pa1UzXWjdeslevBPmKq9btiQZccZ/1QjbUMEBdZV1ZjXykWxAnWC9ZaaXwX60brIWtZa4b1k3W1ImIsZ820brNeHT5DOt56xjpSce61aRyIFvdZN6V95jyQtGKe1AM+qwfMetbz9WDL4DDH2qPYx6B/sxZTGOKb1qrp2OPWgdYVCg86yXo0HYOXrG0U13g7je1pfWmtnsZzdDnKOtdawHrS2koRaeazTlXvDH8T67F60BxuXVIPwq7WE9YdCo9wRBrfS7GqJyqD9tw/W0sV+9OsW9M2xv1GcewQa671bto/2TorbWPUXAumqPHiS1ifpG3OZ9EAUWWNtA2zFAvnUmuHNHaO9Yq1riL1mm4dbN2cju+rWHh8r+0UxvyU4rtx3maK33hmmr9oms+93rd2S+MjMIETc8Fzr7VR2v63Ymc8M2jPvY71TbG/vvWOmoVAqoPxsegPUxgtHhkDhQcVHp4owLm8O2Ae8/ezJluz0zgpDAZ6kPWd4lqwqXWdmsjD/de0jlGkI2srjBnDZiGxqEpPzvZz1qGK1IkFcY21mnW/4jcC17gwbbMYiWrzsK2aHA2y1xtLXrZuqcZ2VHQg8Ai9oB+fe7TYUpF7f6swEozzEc2bYhyr8K4s/q2t6xUGvXE6jncm/eG94SyIDlznaYXBshgwNBYG3K7I/zFkvP8N1mkKQ91AYbynKwx4QWshNdGC65FyUUecpDD+o9OxA6wX0/bHCgeW+VSNI/tc8dsXtj4cmVGwgvWH9b11mSIPg7rY4Qf+osjRHk5jWyhe4J3W7mmsF5AP8iFqyB97RT8+9yCDkRJV4Iv0L8ZO5OW94/iAxbePtaT1URoD9t9TLAwgysBU6y7FOX9jSPHxP7DOUISlutgBwhItrc0VoQNDXF5hCPmGvYDcDQ9SgqFy7xoMEy9W6/xyUheG1F/PPVr82WpYIxAWMJwM7ahsMHWxwwcnlOSUgA9O0XKVmmuQHz6b5iyuCEkUNblAIiyRS1NMog0VBQjbjJ+Y5hGmMjMVK5aihnv1gl4/N5Ttv/wHobKF16kYI5TfoyjAclFWR5N/ahFm6JpwnX6G98NznlcfGAsmKfKwDB+FQgPKYgcINxzHKzJG66r8CHxIQhMfm3PpmGDQwEcEPij3BIyA6/PHBfI/KnjyP1phuaDiZZHvA92H/FtKunl8ctJu9Pq5gRBctv/qFl6nYow8d4oiTHPPTtGE+zFWtwjHG9jFtHpwrMDDYgAY3uVqKmIoix3yq68VhQzejnkUIxQhFyiKl1XitOGCkTSBD5kLEubgBblGhkKGIgqDJg/L4BlzG2y2ogAC+r7Zk/5fRuO52Z6rJroxv2zhQVmM8SzUGCyCU9J4p2jSrUU4nuC/OfBcd6vJ1SccuYIm9G6vyNV58CE13gqjojDBi/IvOXSGtIDWGMUIaRAtMTwo6cbeaorQfqJT+4/iin2ghVcXY3j3vEiAOZ2iyWR1bhGON7AL3sGEhbQGj0UuR06Xe6kwQxHy6OPm4pHCsuRiRUqEtyT9IR2Yo+g5U4D2I53af3jnsoXHH2V4HyVEFjw+KVK3aNKtRTjeyF2WlpaBgYU6XmuTlpb/DBGLKN/SMjDQpp2u6F71BX8BWuNfgBeFpisAAAAASUVORK5CYII=>

[image85]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAcCAYAAADcKOPNAAAEHElEQVR4Xu3d2a9eUxjH8Qc1NIgxVNQUIrhB0KI0JYKYpxBTGiKNkiYqqDYqjaExDxGJeShJDZFGeqNVN1QqSqXxJ/Si1y5c4ILnl/Us73OWnnN6ah/O+77fT/LLXnvt3Z73zbl58qy19zEDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGCQXNWc/5TGJ3o+jvH3noM8Kz0Px9zZcQQAAMAkuj6N9/P87jnQM93zrefCuPaBlXvv9bwScxN1sOfzdrLxbBrfmcYAAABDaU1z/oBns2dtnKtIq371HO8507PJsyJdG89EOnEnpPFeni/TOQAAwFCZ53mymfvISldrfpy/mK6tiuORnm2ewzx3eD7xPO250nOj53XPDM+HnsetdOi+svLz3vFc4znG83Zc2z3uO8V2bGk7AQAAMCzUJcsO8fzpWZ7mbvUs89yT5mRrHLWE+qPnWivLnerYPRTXVsRRtsRxvZWl1tfSNe2N2yfGeXk202cDAAADIHeLVGhU6u7ckM67dnkaqzu1yPN8mtsZ58Tx0hGz//Su59R2MlncToyhi/1hWrLUEuoRca4O3QLPNCsPKIgKORVq8qlnrpXOnR5c0L97zkoBd5mVJdmZcW+m7w0AAAZALQrkuDRWQXVaOh+Plud21Uue2Z6XPQc018byTBxVsIxlo2ePdjKcZSM37I9HhVO/+LqdAAAA/ecMzy9WlvPqE4z7WimglsS59lppA7u6P5/F3M1xVKEzy0rX6TErm+t1zxVxz1tWlvr0hKMKwLop/4I4ijbj18JijvWWBkVLhvpsNfela1X+v1r7e/a2sYvJS6zX2bvLyl4zOS+ObTF4dHOu5dCplOy35hwAAPQh7bHScpzkYkhFjGhj+w+eVz0nWe9dYyqs5NE0lnqPluo0ryJNheALnls838R9dQlTr8GQ2ik73Hqb9HeG7s9PZMpNaXx1HFVAVkelsdSCbU8rm/rV5ZNz43h/HCstVfaLP6z8DgEAQB/b7nnD84iV10/sFvNv/n2H2VNprKcZtcdKL42tnSbtnbrdSkfq0Ljnu7jnCysFjvZrSe1WqeslKib089+z8loKFVYTebqxdpUuai+EY63s/3rCSodwR/R9fo6x7lOhqe+jF99e51ln5cnO6uQ07ooKX33Orun3CwAABpRe/FrlhwPet1LcqaBRd+y2mD/fesukukedNN2jBxdEHTZZHcfR6MGD09vJKUZ77SaDloa7VjuaAABgwGi/2sXt5CRQV6l29Kp2uXIqyh3HLo3WJfw3FrYTAAAAw2CDlb16XXrQRnYyu1CXnQEAAIaO9ujVhyS6oqdhuza/nQAAABgmo/05qKnibuu9VBgAAGBo/Rf7/HbVeH/5AQAAAAAAAAAAAAAAAAAAAAAAAAAAAADwv/oLrMepdmvFSXAAAAAASUVORK5CYII=>

[image86]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACMAAAAQCAYAAACcN8ZaAAABg0lEQVR4Xu3TyyutURjH8Yck5dYRA5eBS84ZYMBAkplLCgnFRCkOEwwYEOVeiiIRJbdCEQORiQyoc6hTZ8CAsT/F92k9td9WbVtSe7J/9Wmv91n7fdflXa9ILLF8Lf148ovRSiWO/GK0MowRv/hNKRK3611+R7gcYh2LmPP6/Jwj2S9GyAl++sVweUEe0nHt9QWTgEe/+Im8+oVwycQ/azdhItDXhxksi9vuA9yhBx04xiQuUYIkbGLNaApwhQrsodfqndg2WVaTBqxYWwerEjeQ5l7cQ+btelBCD2vDFhoxhRzso8z6daLa1kF1Eq3izk09ynGDOPyWwGRG0WxtXZWemR92PY03zNq1DlZqbc2DuN3QpOE50KevUxeyhF3sINH6tHaBMXGLj5hV1CAXG1b7j3i0IAV/ra7Jl9B5+yWuT1d+iwxxr7IQdeJ2utb+myruvH6YboyjXUJfz5m4SeouVItbYTB6vobEDZZttT/2q/ctiLu3GKcYEPe69cOIJWzeAWQSPb69y+u5AAAAAElFTkSuQmCC>

[image87]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAPCAYAAAAs9AWDAAAAU0lEQVR4XmNgGGgQCMQrgDgXiPuhNHZBfyDuAWJvEAcILkBphiNAzAPEQkB8EyTAjiQbA8SdIIYVEB8C4hIgng/EHCDBYiBOhKqEg9tA3IsuiAEAfHMOhTL2g+QAAAAASUVORK5CYII=>

[image88]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAVCAYAAAD7J7IFAAACdElEQVR4Xu3bS6hNURzH8T/Ko5RHDETyykAMSISBgQEhz8QAA0wM5FmijAy8X2VC3hMmhCjJ4yZFBmJmYqRkqGTu92/9d3fddTj37DrHGdzvp36ts/5773PO/4xWa+9jBgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgL+ZrGwqi20yKHt9RdmVzdvpofJBma98VFb1PdxReY83rHM9AgCAAW5wWWjR4bKQeVvML8Y4qk+1PZ4rK+P11Kw+XTmbzdut7HFhjJ3oEQAADGAzlZ3Ks/KApR2rZmaXhczrGKcpJ5TPMV8WYyvWK3uUC+WBwi9lojKkqB9R1ha1ZvrrNzfJGnscGvM6PQIAAPSr2vl6EeMZ5bKyQ/lqaZfqvHI8jq9Q7igLlOuWFlTvlLGWrtsd5+1XRivflKXK6aj7tXWMtPTeFf+Mzdnc3YtxX1bz7/FdmaBsVI4qcyz14lbHWPY7RTlgaRHmx3wReEnZGuc8iXP8dyh7rNTtEQAAoKlXlhYnT2Peo/yI2t2orYnxpLLF0jNi95UvlhYu7qdyTBkec7/Wb7X6+z5QbkXdd71atVg5pNwsD2T2KleVMcpv632mbJ71fqarvtfyGD/F2GON/foi0VU7ZdVic53yRhmhDLPGHmfEeXV6BAAAqMX/gOB8x2mbpR2kccqpqF9TFim3LS18zln6M4E/P/YyzpkVY7X4Kc0tC00cLAs1bLfeZ+yqBZjz3TNf3L23f/db3RpdYmkhV91WHa88VjbEvB09AgAAdFX+D0rntxT/B1+QPbK0E9Zp3eoRAAAAAAAAAAAAAAAAAAAAAAAAAAAAANAVfwBUX1R7W1sLCQAAAABJRU5ErkJggg==>

[image89]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAcCAYAAADcKOPNAAADaklEQVR4Xu3d2+uNWRzH8eWUkHPhRsRkkJIoh1wgMUkMchpKSRRuSDlEzDjllCE3TsNwgdQgcoGbMUNKceGC5MLf4Wbm+2mtxfp97We3s58L8n7Vp7We77P7Pft3t1prPWuHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADA92iBu35Z9EdZbqR+F0t/yz+Waan2W2plXNEHAABAjZa46w+WfpYelieWWcU9ffa6ZZlliGVDca+bpWdxDQAAgBrc8gXz3HI39a8W9b6WkZatlqOWFcW9bJNlpS8CAADgyx30BbPWsib1Txb1zan9JXQcyJU0w/bUFwEAAPBltIRZGmg5YtlT1FZZdlk2Wgak2o+WBx8/8bnJvgAAACCdLW99sUXaTH/GFxP93dIly3jLeldv19TU/tSh2pieX2WLLzRx3BdqpKVTAACADjSI+csXEy3lzfNFZ50vJD+7639DHOBddvV2aU+YbOtQbUzPr3LMF5potH+tLnN9AQAA4GyIm90fWzpZplsOh3gMxXvL7hBnx34PcX/WdsvpdF+0HHgo9f+wnEr9h6l9belu2Z+ud1qmpL6WCrWMWMbTvi49o2rvl8z0hULvEJ/vj+DwTqRW3197zfR/6rvKndRm79z1f23Ey88EAAD4SGeH9bHcS9d/WuaH+GbjpVRbHeKgTMuOeptR1A4KcYlzTIhHWWhglZcdH6U2D7T0N0XHWlTNyjWis8vkXGqH5hvJ4PD5YK5cpl2YWg08s+VFP9OATXvTZoR4ftqvlh3pnp9Re++u67TXFwAAAPKS4hXLhBBneDTTJhNDHGhpOVMzVZlmrHSW2L4QlyI1oJtd3Jd8MOx9y03LAUvXEJ+nWbxWnQ+fvmMjeabKPz8bHuLzNeOn51d5FeL/peVhnZn2t+WZZZHlTfE5eeGum9Fs5TVfbEIvKQAAADSlpcvFqa/ZtkkhLpdmGtDlZbvbIQ5oLoc4O6WN+3nv2prUelqC1cCoVSN84StQtefP0+yf6Py1VrXy8gQAAEBtGm2gbzbL9a1Y6gsV8kxl+TNUzfg3awEAANCG0b5Q4YJlmC9W0IsOAAAAqEmzfXWlH3yhgmbj9PujAAAAqMlYX2jTxcCSKAAAQO3m+EIbevkCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOBb9D8gyHREZzS0wwAAAABJRU5ErkJggg==>

[image90]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAUCAYAAAAwe2GgAAABhElEQVR4Xu3aPWtUQRQG4BGJX4Ug2AUrG1GxsBAECwkhBlOmtbJQSAhYaSGCohBSJEWw0EBS5E+oWImIKGglaOVf0TPMLF4O5qsS3OeBl5k55y675WHulgIAAAAAAAAAAAAAAAAAAAAHdSfyIrKcG8mnXAi3I5N9fzXyM3LjT3vfHuTCDm7lAgDAOFiNHIq8zY2kDnXZs3T+ElmLHE31vVzMhR2czQUAgHHwKzLf98dKG7gWIvcjTyPne+9CX7ci1/t+oq+PI9uRh5FzkSe9vl+bkaXIx9zo6u9aibzLDQCA/93oZmsjcjnyfdCrg1cdlKrTfZ0rbSirjve1qq9V30RO9vPrQW8v9TM/IrOD2pnI18H5c+RI5P2gBgAwFhb7+jxyOPKqn+uwVl0r7T9pN0sb1qZ7fXTbNnKltNuxmX7+MOjVQfBRytBUaa9lX5b2PX/zrbTn1nMDAIDdnciFcClyLxcBAPg37uZCaTdop3IRAAAAAAAAAAAAAAAAAAAAAABg4DeKZif/AifskAAAAABJRU5ErkJggg==>

[image91]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAAOCAYAAAAMn20lAAAAXUlEQVR4XmNgoDooB+LL6IIgoAPEi9AFQSADiHPRBUFgLhCbM0AkjyNLnAfiFCAWBeIpMEE+IL4BxLOB2AMmCAJOQNwLxGZAPBOIvWASJUAcAMSyQLwNiH1gElQCAOUsDGacwBroAAAAAElFTkSuQmCC>

[image92]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADEAAAAQCAYAAAC/bJePAAAB5ElEQVR4Xu2Uy6uNURiHfyiXMkAoFCImZCBKdCKXKAO3MkCuAxnRGbiecwZGrgMRZijKLbnfSnJNBibGpiID/gTPb7/r5N1fe5dzjsFW+6mnb73ft1br8r7rk9q0adOIoXgGf+BBHIuX8BvuTf1anpV4P8U78GKK/wu68FiKT+H2FJvp+EDxrSV5hJtS/ARnpNgcwj24pvK+P7iE71ZfDoTB+FNxL7qxB7/U9QhuKLLxL1iAZ6svB8Js/J7iuaq/H8YZ+KrY5ATcgFfxMN7DWdiJt3Fa6XOyNlIahEeLu3EpvsAruESNxw3B04qD3VL67sTN+BCnqsIuvJbifYoJM07/xxSvw/O4SrGxSYpyfIxTFJO5/IzL0otcqDgMc12RVW+w0biZOB8/KSplLV6ojZROYEdp1/DH9/gM5+A2/Iw3Vb9bZ+dyis07HJ7ikfihtM/hstIepjikX7iivPPiemk2zhnzgo2z47Wa1ziitPvEVjyQYk/8NsVmnv7UubO2SFEirxSb9YlvxMl4B0fhYjUf54z0/kTe4DicqCj19YqS6xM+keUpdmkcT7Hxom7hEcWk/m0bP11Gq0s8Bp8rytA0G+cSdF/zsjzH41NFyf81oxVZ8OXtVwpbAV9Yl8P+6odW4Texsle5mwnH8AAAAABJRU5ErkJggg==>

[image93]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC4AAAANCAYAAADWgVyvAAABYklEQVR4Xu2UTStGQRiGH1/ZkK9SVqLYIBYWirKyIlaWEimysJGI6CUSCln4DVYW7Nj6A5Y+/oGdX+B+zjzTec6cZ470ltW56uqdueftdDdn5hCVlPyJWjgrv54deAiPYF1BVg1dcEzNB+AlrMDJgiyhE97CL1gv2RTck/E+uYdbWTUswGdyG+F5gg3ketwXZBneKS1egUsyXoEbkSxkPJgPBfOQRUqLcznu4HmNZDl08RtyD2W47FkkC5mGwzLmo9ev1ix0cX7zuuQn7DGyJjVP0MWvKFvyPJJZrMEZckfrN3TxDsqX7DayZjVP4D/wq2F24bKMV+FmJLMYhHdk7IwBF+eLzvCmfai1t0iWg4s3yngCnsiYj8RoJAtpg+vkNmAL1mSXc3DxYzV/hC2wldKLaGUJHBzAb3gKeyXnktvkPoEeK9NwWf9JbYfzai1kDj7AF0ov/Qi8gNewryAr+Xd+AKVdScgBloU+AAAAAElFTkSuQmCC>

[image94]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB0AAAAQCAYAAADqDXTRAAABQElEQVR4Xu3UzStEYRTH8eM9NTYKZYGVpigLL2WhZGEhIqspSsnGzsJG8rqQvDVSrGVJKWaYZojIlmyV/8D/wPc453JnR7kb/OrTc5/n3Jm5c59zr8h/fmuKsY1nzGEd+ygJnxRFBrAXml9iKDSPJEsY9+MKvKDusxxNTrGFVVyjN68aUZ5Q4HIozC//fBpxEZrrra1BETbFmmxUrLl0C0aQQoOf34oFP2/H1+qxgg1M4tjXPzIm1rGaWryiFJ1ox73YP9fGCpptDV2I4QFlXp/1er+PeqEdSPr8Pdq1d0ijWezxOcQyutEj9gMavbCgo29QjkEc+No8+vw4yKPYln0rM2JfrLlFldjdOMEwJjDt9XO0oAmLiCPrtYSPX8oRKv34ysdqZDAltq9n2BVrQH0CgpeNboXuq/ZAm37wb+UNBVAz8OikW6oAAAAASUVORK5CYII=>

[image95]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAQCAYAAADnEwSWAAABP0lEQVR4Xu3TSyuEcRTH8eNaEkUuRS4rG7aUhUjGyn1hg5RXIDsLCxbIbWIjSxubmdWgCBGxULwA5R14D3xP5wzPM8VDPZspv/o053+Zmf/znzMi/8nXFGMXr1jCJg5REtwUZ4axHxhfYSwwjjXLmPO6Am9o/lqOzBkqcye/yzF2sI4bDIZWo9OSO/FTXlDgLlAYXo4vbbgMjPUK61GEbbHmmRZrGr3qKZygFTXYwqq+kczgCJNYE/t5QpkV60BNA95Rim504lnsSbVhsk20gR6MIoE9nx/AExpRJXaoz2gX3uMUHWJ/gxRW0Id+sQ/W6IGyHXqLMq/1CfSLNeV48Fr3Lnr9q+hmPb3mDrViT5/BhNhVP6IdTegVu3rNAbow4uPIpFHt9bW/1om1+ryPzzHu9QKGvE6KdfifOjX/8gE/ETEv8COYUAAAAABJRU5ErkJggg==>

[image96]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAkAAAANCAYAAAB7AEQGAAAAbUlEQVR4XmNgGDCgCsSTgLgTiPuAOB2Ik5EVyAHxOQaIQhiYB8ROSHyGTUDsiywABNVAzAXj6APxXSBmhEtDgDQyp4gB4hZkIA/EMcgCekB8Bog5oHyQiU0MSFbBAMiBIIfWA/FMIFZAkaUvAAALOwxc0Dj01AAAAABJRU5ErkJggg==>

[image97]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANQAAAAQCAYAAABup1G6AAAG6klEQVR4Xu2ZV4wcRRBAi5wzMhmWZLIwSWCCMTnnnJOxDZiMEBmLnMFkA4YjCZFB5Ay2yRYCBOIP/pAQXwghvpCop+ry9NbN7o5394zOzJNK19MzOz3dFbtPpKZm3mYPlW9Unk/XS6vMVJmlsok/VFNTU50bVP5QWTZdH6eyYnG7pqamKkuoTFB5VmVc6ju3uD10rKdyj8pG8UZNzTDgDJV9Y6cyRmVzlUNU3kt95xe3h47pKouGvlNVVgt9w4E1VWaoHBFvVGAtldtUHpLB69EL56l8GTtruuZylflC3y0qu4a+iSrzqyys8pvKSJVJTU8MEV+Fawa+LvQNJ15V2TB2VuABlcVULhDb0PaLUSoPxs4+wGabsub/BllnfOjDeUgCOWdnbSqwF1W2z/qGjOhQd6hsGfrKwOgmx84OLC9m8N1SZcxfxCJT5G2xk54ytlG5NrXJUkel9mSV3VO7W6jjo7I70WmeC6p8FjvnYSZLsx4GsjbgYKeHvguz9g4q/4gFzCGHY8ScH1QWSm0Ud7XKnWIbuldUVk73FlEZkdqR1VXuE0vFcJfKuqndSH/LIKrgcOuIRZOrVA6S4j3txgSy688qp4k5ECWgQ0nXimtUHla5UswhR6f+VaRYizIoM55QuV3sWUpF5s18EXhUimPaeJ/vfSy16T8pPddunqwjv/lI7PnDVJ5SuUxs7RiLgHKxWJB4TWVjMaN6UuUEsTL0JSnYUeVGsTUg6JwlFtHROb9hPcreWfb9lGM8c6tYcGLrMDX9lvu5XtDJNJWbxdaS8V4Q0z/P8E6IeuCb8msciiwFK4hl79+lOZA9k7Uji6vsGTu7gYOIR7LrBcTO7h02dsuIGSiLfJPYB3eCjSALxGLD12LvbgeKOEblObGFxkAwFsoaxq3C8Sr3pzbKdMfoxHSxo1UW9i+VJZtvl7K+FJGSrE6gwXk2S30YOe18/xTvE0D4Zo53CRx7p3udQBduLKw1c+a3BIRVxcpW34CTyTA+IvwUlSNT/0wp9iKPq+yvcqmYvg8W+x263lTMgMveeaAM/n6+jUAIvI9se7hY2QWsFXohuBAAWGvmgkEfq/KmWNDgiBsnLIP3bpdd7yzmlDnRCVuxrdj8Pow35hQiGQuzRtZHSnw5u3YGpLkMPFEskuQZIHK9mGKWE4umO4kZFH2tYAG8lMGxWBTKxJOl2phEygNS+32xSM//HXAulN4KDyK7qLye2hgn47WCsVC6Q2T/LrtmHgSVt9J12X3WlG/jOafKPFlHDN35VJoPUijj2UfSx9o7ONFSYmuC4Tro5FuVD9I1Rj4jtXFYDmpavTN+P/Nibcg2frDF2uOwQPBCLwTLuLdk3C9Sm6poNynXA0FhXOh7WuzZbmhIHxwKVpJC4U6+x8FgtlD5XszYjxbLNEyI32HwwELH+pSSgqhN1CLDcPJ2RfoLKCYe1fMelAdkNWBMvjOOybu97aAsHJAIx/hkPIyFKHl39hxzyk+K3kh/MVSiHdmHkvPz2U8MniOHGJRRgCEQMd0ZNxAz3v3Eyh/+Nkru8w1u5MB1lXnOEivBCB6MzTtyfkx/KeUwzL3EjNiDFVmFsg9nOVQs4jO2B9OxUpRbU8WOpcveCfn3A87GVgG81OXYGr0QvNEL42JbjOtQQm6lcm+6xqFHyWA9wJlipatDIPRtAZQ5YTsa0ieHAjdcJ/8QzvhJhzjEKVKUJJQFboTAomM4OUQoSpF3pcgatN0o11b5W5ojK86KMTEuUY2yj1IC4pgYxcfZNfiiUIPzLFEQ2B+QIZ2fpPkkD8VeJFZyOPuIje/EOTIG5QulECWN7zcnie3JcILRYvtOyhmI94EgkFNlnmRvxibrYXCx3CFrsIchA2CYOMTWUhgdBo1ecQqyJPPCsQgacInYfornfQ3K3gnx+z3zMIY7nWc+9tboF4fAwXFMxiKIsB6U3WROAq9nqqgH4LtwbGd8EojBkPnhYGWCk0ND+uhQpPKcaWJ7iXZQllD/50aZRwz2QBPF/gfAYvK3IbZZzH9D9mFhq9BpzHYwR6IlERJQ7NjZd8vBoFAGZYdTdbxe6GWe/YIgQMCY27BHGyG2p5qQ+sr0QHDL7QZby0vAMidsR0Oay9ieoP5mn+NQDvlkWkG6JkpQugA1tKd3GCkWfQakiCREDhxqTLoGNrBViWOy8L7B7sQ7YhHTIZrh5O1AaTxHSQVxjkNFL/PsB2SYP8Uy1tyGbEU1MUWKf31EPRAMcbwc9uu5fnMnbJehKKehofJJavcMpxx8NDWswwR8sCrE/VNVuv0d8Nt8HzQndDNuN7/pB73Mc16EzON7NDhHrMTMM1Z0wnawT+ME8lcxJ3NHrqmp+a/4FyVYSAexhkIXAAAAAElFTkSuQmCC>

[image98]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACoAAAAOCAYAAABZ/o57AAABMElEQVR4Xu3Tq0tEQRTH8YO4iG9FMBhEEFGw+AcINotBDHYtYpQNYvERDKLgI4j4qtosFnFNBtkiYjD4yAa7yaDfs3PYPbOrYcWbvD/4cGfmTDhz71yRNGnkGNdYxD7e0R3t+Pv0IIMGTNnaIDaxghFbi3KEWtTgAjNxOZFs4RM36LW1SwnNay9ntlZMs5S6X8epqyWZLPrdXBt8cvN7N44ygQc0lRcSyhIWcIJhdErc6It800sfXiXckXq0xeVC9CB6h8vN+U1VpN2e+i9coUMqG9WvXUwd7jBt80l0lcq/zoBUHkqNW/0WjWjBm4R7+Ww1zaMbF7KGAzffdWOfn97ovN9URfbsqQfK2fgcrRK+aPQzjeIDq1hGHjt+Q4IZwywOJVw9zRA2sO3W0vzffAFczzGhx7//9QAAAABJRU5ErkJggg==>

[image99]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAYAAAB3AH1ZAAABdklEQVR4Xu2UzStFQRiHXyEbHwkLRW7KWjY+SkmifGdj7yNSSiEb0g0phcLKhkIhC0IkkkJWrJSdv8Xzmrn3zB3crtys7lNPvfObqTPnnTlHJEWKWOrwHcu9fNIbF+Mt9nl5Unj2xjXY4GXKNlb64V8pxDMvm8B0L1Me5Ps8Hpm4hXdeLmFcxx2cjp2ScafuxH1cxEsnT5R6XMIxPzyx9TI2O3MhbLV1Dr5hFnbhvM1/wyj2++EKDtn6CnOduQEJ2tyNu7aewQ47t4p7YjakXVR6cdNaZLM2fMENMZc9il6maszDJ2yR4KGRjSm6c/0a0vAGq7Adm/BRzJczZXN9EV03KMEGlHvMdsaf6Jsd4CFe47DNSyVovxLCCzwSs24BM8QcRzi6ypzxsZjN1Dq58uqN4+K2Px76QG1vhDkxXVH03pTYugzPbZ0QXy7LD5xivjOuENNRPb4eMV1S9M7o5hKiQMz5JosRnMVGf+K/0N/2mpiLGcMHN6w3tEpiYYAAAAAASUVORK5CYII=>

[image100]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACcAAAAOCAYAAACsAAXLAAABPUlEQVR4Xu2TTyuEURSHT2LkXyk7C2liRbGxpSxQJqJ8AAsWVlZKmWbBAokoC/9mIWVpa2NjZSNSPoHyDawseM7cM+973zFXjbGa5qmnOe/v3um9c+ZckTo1zgXeYxZP8AN7Ejsqpws7rV6xz3bcww1c/iVLcI6N2IC3EthUIfP4hW84adkmjlp9I+595bKIDhyzehevvbVqmMVxTHnZHaatvsThQPaDOXwV1+b/YAZ38ABXLXvGXqvzOB3IEvTjOw5gi8Sz4qOH15kstfjiUvQf0VFRnrANHyV5kEwgi2gW9+VFe17A7nj5z5xJPEsPOCRunvssu8KRQBaxjafe87FX+4Q6t+Zv8tjHVmzCF3GdXJf4cuihtLPlsgIT+IlbmBP3Cw+Li1UyiEviOjhlmc7zkbgbqrc5lNWpTb4BgpA7rZ+q/9IAAAAASUVORK5CYII=>

[image101]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACcAAAAOCAYAAACsAAXLAAABI0lEQVR4Xu2TMSuFYRTHT1Iit8wGPYnJchfZ2BhYKB/AYjbdUmRgkCzIQBhQRqsFMVnE4iv4BiaL37nv8TrP630Ur+l2f/Wrc/7PU/fct/OItGlxjvEeV/EA33AguvE3enDS9b24jSu4+EMWcYSd2IFXkrj0S8bwDG9cto7jVl9K9ntlWU4NJ6zewgt3VpUg8XDXOGj1KdYT2Tdm8UWyz/xfBImHe7ZMOcHpRBYxjK84gt3YFx830eF1J4su+UsFgsTDPVqm6CAziSynC59wwfp57P86rkTAW9frPg9ZfY6jiSxnEw9dv+9qT+rLNfylAgHvXL+MU1brUPoIy7Im+szfcQPX8AF3Pg8roou9J9m66J/QV6j7vCvZC52ze2VZm9bkA4PHOPd/PiJsAAAAAElFTkSuQmCC>

[image102]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAANCAYAAAA9tuesAAABoElEQVR4Xu2VzytFURDHJz/yI0LKxooiUkIWFkop2dnY2EikLJSUBRE9vxIKWSgL/4FINrK3VcrGj//AzsbWdzpzrrlz570Uy/epT2/OnNM095xz7yMqUuRXzMBmiVfgJtyCpcmKNF3wCObgUHoqRQkck9+IV9/m+uGozLm0wx2JR+CaxOtwQGLLPSyHZfDKzEWa4Bn8oLCO8ep7OYY3pULiDDzZJ3EOTks8Cxck1nCzr2r8pGIPXhubzlG2vpdjximcksszhUaYUzglMRfal1jDO6ibfoc1amzRTXv1vRzTQeHKZOD786jGx5QucKDmIo2UbbpWjS26aa++l2P4PXCvXhW8VuNVCi8lMweX1FyEG3hT4xcVe3DT8SS9+l4ucqfiFDcqHoS7EvMx8VtcCTuTFYFbWAfr6Wc3+Dh5EyzcdHyhvPpeLvKg4hSXZswFlil8hpgW+EWh+UgPPIQnsE1y53A7WREeaAN+wj3YKnlbP1+OHzTvTl/Aaps0TFCBz49i0ib+QDdctMlIL4W7VIh5m3AYpvCn81/wN7vBJr8B+gpN74d22mAAAAAASUVORK5CYII=>
