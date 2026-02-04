# **Algorithmic Narrative and Fluid Transitions in Modern Digital Portfolio Architecture**

## **1\. Introduction: The Convergence of Computational Vision and Spatial Fluidity**

The digital portfolio has long existed as a static repository—a grid of thumbnails or a rigid hierarchy of "work" and "about." In the current era of generative design and advanced computer vision, this paradigm is an active constraint on the expression of artistic identity. The concept of an "infinite canvas," where paintings flow into one another through a hidden algorithmic logic, represents a fundamental shift. It proposes a system where content and navigation are indistinguishable, driven by the user’s scroll and guided by a machine’s interpretation of visual similarity, texture, and volumetric space.

This report outlines a technical framework for constructing a site that offers a completely new experience upon every visit. It utilizes deep learning to identify "transition fulcrums"—points of structural convergence between artworks—and employs **Volumetric Anamorphosis** to explode paintings into 3D space. By distributing brushstrokes along the Z-axis and using **Forced Perspective**, the system creates an environment that resolves into a coherent painting only from specific "Sweet Spots," rewarding the viewer for navigating the chaos.

For muralists, this system extends beyond the canvas. By utilizing **Monocular Depth Estimation (MDE)**, the "Painting Preparer" can reconstruct the real-world environments in which murals exist, allowing users to fly through the physical streets and architectural contexts of the work.

## **2\. The Painting Preparer: Semantic Deconstruction and Feature Extraction**

The backend pipeline is responsible for decomposing high-resolution artwork into constituent semantic and textural atoms. This understanding allows paintings to be mathematically realigned and spatialized.

### **2.1. Foundation Models for Semantic Segmentation**

To separate a painting into strokes and shapes that follow light and color, we utilize the **Segment Anything Model (SAM)**.1 SAM acts as a promptable vision foundation model that maps paintings into a rich embedding space, capturing semantic context like "faces" or "clouds" even in impressionistic styles.2 The "Automatic Mask Generation" mode samples a grid across the image to generate masks for every object.4 These masks are post-processed via color clustering (e.g., K-Means in CIELAB space) to ensure segmented shapes respect both semantic boundaries and localized color transitions.

### **2.2. Extracting the Artist’s Handwriting: Brushstroke Analysis**

Texture is defined by the directionality and flow of paint. To synthesize transitions that feel "liquid," the system must align the grain of the incoming image with the outgoing one. The **DStroke algorithm** uses a guided filter to recover soft transitions and overlapping strokes, generating alpha mattes that preserve the depth of the painting.5 A dense vector field is computed by calculating Scharr derivatives of image luminance to obtain gradients 7:

![][image1]  
This orientation angle ![][image2] guides the transition shaders, making the morph appear to follow the natural brushwork.7

### **2.3. Pareidolia and Saliency: The "Ghost in the Machine"**

To exploit the "unnerving" effect where abstract patterns resolve into faces, we utilize a CNN fine-tuned on the "Faces in Things" dataset.9 Standard face detectors suppress false positives, but models trained on animal faces are more prone to human-like pareidolia . This module scans paintings for "illusory faces"—bounding boxes of landmarks like eyes and mouths—which serve as transition anchors . Complementing this is **Visual Saliency Detection**, which generates heat maps of visual importance to ensure transitions happen where the user is naturally looking .

## **3\. Spatial Architecture: Volumetric Anamorphosis and Forced Perspective**

The core innovation is the liberation of the painting from the 2D plane. Slices of the painting are offset in 3D space, requiring the user to find the exact perspective to see the work as intended.

### **3.1. Inverse Perspective Projection (Unproject Logic)**

To ensure that slices distributed along the Z-axis align perfectly from a specific spot, we must "unproject" 2D coordinates back into 3D world space.11

1. **Normalization**: Convert pixel coordinates ![][image3] to Normalized Device Coordinates (NDC) ranging from \-1 to 1\.12  
2. **Ray Casting**: Construct a ray from the camera position through the NDC coordinate .  
3. **Target Placement**: Given a desired depth ![][image4] (derived from depth maps or noise), the system calculates the 3D world position where the ray intersects a plane at that depth.11

### **3.2. Scale-Depth Compensation (Forced Perspective)**

In a standard perspective view, distant objects appear smaller. To maintain the 2D appearance, we apply **Scale-Depth Compensation**.14 The required world scale ![][image5] of a brushstroke is linearly proportional to its distance ![][image6] from the camera 15:

![][image7]  
This ensures that a stroke 1000 units away projects to the same screen size as a stroke 10 units away, creating the "forced perspective" illusion that they exist on the same flat plane.7

## **4\. Environment Reconstruction for Murals and Public Art**

For paintings that exist "in the world," the processor must capture the context.

### **4.1. Real-World Scene Reconstruction**

Using **ZoeDepth** or **MiDaS**, the backend generates a depth map from photographs of murals . ZoeDepth is preferred as it produces **metric depth** (absolute units like meters), allowing for geometrically plausible reconstruction of the surrounding street or wall . These depth maps allow the system to "lift" the painting off the wall and treat the entire environment as a navigable 3D volume.18

### **4.2. Occlusion Handling and Inpainting**

Moving objects into 3D space creates "occlusion holes" in the background. The pipeline uses **Stable Diffusion Inpainting** to hallucinate the missing data behind foreground elements.19 This creates a "clean" background plate that the user can fly through without the illusion breaking when they pass a foreground object.21

## **5\. Algorithmic Matchmaking: Graph Construction and Deep Image Analogy**

With paintings deconstructed, the system determines the next destination through weighted graph traversal.

### **5.1. Deep Image Analogy (DIA) for Dense Correspondence**

The **Deep Image Analogy** algorithm maps the structure of Painting A to the content of Painting B by finding semantically meaningful dense correspondences in the feature space of a VGG-19 network.22 This generates a **Nearest Neighbor Field (NNF)**, essentially a lookup table that tells the frontend exactly how to warp one image into the other.24

### **5.2. Similarity Metrics and Dynamic Pathfinding**

Edges between paintings are weighted based on **Learned Perceptual Image Patch Similarity (LPIPS)** and **DreamSim**.26 LPIPS measures texture similarity, while DreamSim focuses on mid-level layout and object pose . Navigation is handled via a **Biased Random Walk** 28:

* **Bias**: Favors similar edges for smooth transitions.  
* **Novelty**: Penalizes recently visited nodes to ensure a fresh experience .  
* **Wormholes**: High-confidence pareidolia matches (e.g., a cloud-face mapping to a portrait-face) act as shortcuts for "magical" reveals.10

## **6\. Frontend Architecture: The Volumetric Renderer**

The frontend uses **React Three Fiber (R3F)** to render thousands of brushstrokes and handle the immersive scroll.29

### **6.1. High-Performance Instancing**

To render 50,000+ strokes at 60fps, we employ **InstancedMesh** . All strokes share a single geometry (a quad), but each instance has a unique transformation matrix and texture index from an atlas . **Spatial Hashing** (via the **RBush** library) is used to load and dispose of paintings as they enter or leave the viewport, keeping memory usage constant .

### **6.2. Solving Precision with Floating Origins**

Infinite scrolling causes floating-point jitter as the camera moves far from the origin . We implement **Floating Origin Rebasing**: the camera stays at (0,0,0) and the world moves around it. When the world offset becomes too large, we reset the coordinate system by subtracting the offset from all meshes .

### **6.3. The Glassmorphic Interface**

The signature and contact menu utilize **MeshTransmissionMaterial** from the **drei** library . This material simulates real-time refraction and chromatic aberration by grabbing the rendered scene behind the UI and applying roughness-based blur .

| Analysis Layer | Recommended Tool | Role in Architecture |
| :---- | :---- | :---- |
| **Segmentation** | Meta SAM | Isolates semantic "slices" for 3D placement.1 |
| **Depth Map** | ZoeDepth | Provides metric Z-coordinates for murals . |
| **Anamorphosis** | Inverse Perspective | Mathematical alignment from "Sweet Spots".11 |
| **Correspondence** | Deep Image Analogy | Guides the structural morph between images.18 |
| **Rendering** | Three.js (R3F) | High-performance volumetric rendering.29 |
| **Animation** | GSAP ScrollTrigger | Binds scroll position to Z-axis flythrough . |

## **7\. Conclusion: The Living Gallery**

This architecture transforms the portfolio from a static viewer into a **Volumetric Installation**. By using **Volumetric Anamorphosis** and **Forced Perspective**, the site recreates the artist's internal world where meaning is found through perspective. For public works, the inclusion of **Metric Depth Reconstruction** allows the mural to be experienced within its physical environment, blurring the line between the painting and the world it inhabits. The result is a narrative where every scroll is a journey through deconstructed brushstrokes, destined to find order only at the moment of alignment.

#### **Works cited**

1. META's Segment Anything Model Architecture is a game changer for prompt-based image/video annotations : r/computervision \- Reddit, accessed February 3, 2026, [https://www.reddit.com/r/computervision/comments/1er29t6/metas\_segment\_anything\_model\_architecture\_is\_a/](https://www.reddit.com/r/computervision/comments/1er29t6/metas_segment_anything_model_architecture_is_a/)  
2. Master Image Segmentation with SAM's Zero-Shot AI \- Viso Suite, accessed February 3, 2026, [https://viso.ai/deep-learning/segment-anything-model-sam-explained/](https://viso.ai/deep-learning/segment-anything-model-sam-explained/)  
3. Segment Anything – A Foundation Model for Image Segmentation \- Learn OpenCV, accessed February 3, 2026, [https://learnopencv.com/segment-anything/](https://learnopencv.com/segment-anything/)  
4. Get Started with Segment Anything Model for Image Segmentation \- MATLAB & Simulink, accessed February 3, 2026, [https://www.mathworks.com/help/images/getting-started-with-segment-anything-model.html](https://www.mathworks.com/help/images/getting-started-with-segment-anything-model.html)  
5. Fast Accurate and Automatic Brushstroke Extraction \- Computer Graphics Group, accessed February 3, 2026, [http://graphics.csie.ncku.edu.tw/Tony/papers/ACM\_TOMM\_Yunfei\_update.pdf](http://graphics.csie.ncku.edu.tw/Tony/papers/ACM_TOMM_Yunfei_update.pdf)  
6. Review · InfinityGAN: Towards Infinite-Resolution Image Synthesis \- Daily AI Archive, accessed February 3, 2026, [https://dailyai.github.io/2021-04-09/2104-03963](https://dailyai.github.io/2021-04-09/2104-03963)  
7. Creating Pointillist Paintings with Python and OpenCV | by Matteo Ronchetti \- Medium, accessed February 3, 2026, [https://medium.com/hackernoon/creating-pointillism-paintings-with-python-and-opencv-f4274e6bbb7b](https://medium.com/hackernoon/creating-pointillism-paintings-with-python-and-opencv-f4274e6bbb7b)  
8. How to create glass material that refracts elements in DOM? \- Questions \- three.js forum, accessed February 3, 2026, [https://discourse.threejs.org/t/how-to-create-glass-material-that-refracts-elements-in-dom/53625](https://discourse.threejs.org/t/how-to-create-glass-material-that-refracts-elements-in-dom/53625)  
9. AI Pareidolia \- MGHPCC, accessed February 3, 2026, [https://www.mghpcc.org/project/ai-pareidolia/](https://www.mghpcc.org/project/ai-pareidolia/)  
10. Seeing Faces in Things: A Model and Dataset for Pareidolia \- Mark Hamilton, accessed February 3, 2026, [https://mhamilton.net/facesinthings](https://mhamilton.net/facesinthings)  
11. three.js \- Threejs and large position values \- Stack Overflow, accessed February 3, 2026, [https://stackoverflow.com/questions/36721835/threejs-and-large-position-values](https://stackoverflow.com/questions/36721835/threejs-and-large-position-values)  
12. \[Test\] Zoe Depth vs MiDaS Depth. Spoiler alert: Use MiDaS. : r/StableDiffusion \- Reddit, accessed February 3, 2026, [https://www.reddit.com/r/StableDiffusion/comments/18kv89r/test\_zoe\_depth\_vs\_midas\_depth\_spoiler\_alert\_use/](https://www.reddit.com/r/StableDiffusion/comments/18kv89r/test_zoe_depth_vs_midas_depth_spoiler_alert_use/)  
13. 3D Photography using Context-aware Layered Depth Inpainting · thygate stable-diffusion-webui-depthmap-script · Discussion \#50 · GitHub, accessed February 3, 2026, [https://github.com/thygate/stable-diffusion-webui-depthmap-script/discussions/50](https://github.com/thygate/stable-diffusion-webui-depthmap-script/discussions/50)  
14. WebGL model view projection \- Web APIs | MDN, accessed February 3, 2026, [https://developer.mozilla.org/en-US/docs/Web/API/WebGL\_API/WebGL\_model\_view\_projection](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_model_view_projection)  
15. WebGL 3D Perspective, accessed February 3, 2026, [https://webglfundamentals.org/webgl/lessons/webgl-3d-perspective.html](https://webglfundamentals.org/webgl/lessons/webgl-3d-perspective.html)  
16. Reverse Z infinite projection \- Resources \- three.js forum, accessed February 3, 2026, [https://discourse.threejs.org/t/reverse-z-infinite-projection/88394](https://discourse.threejs.org/t/reverse-z-infinite-projection/88394)  
17. Converting Screen 2D to World 3D Coordinates \[closed\] \- Stack Overflow, accessed February 3, 2026, [https://stackoverflow.com/questions/31613832/converting-screen-2d-to-world-3d-coordinates](https://stackoverflow.com/questions/31613832/converting-screen-2d-to-world-3d-coordinates)  
18. Style Transfer Review: Traditional Machine Learning to Deep Learning \- MDPI, accessed February 3, 2026, [https://www.mdpi.com/2078-2489/16/2/157](https://www.mdpi.com/2078-2489/16/2/157)  
19. Learning to Segment 3D Point Clouds in 2D Image Space \- CVF Open Access, accessed February 3, 2026, [https://openaccess.thecvf.com/content\_CVPR\_2020/papers/Lyu\_Learning\_to\_Segment\_3D\_Point\_Clouds\_in\_2D\_Image\_Space\_CVPR\_2020\_paper.pdf](https://openaccess.thecvf.com/content_CVPR_2020/papers/Lyu_Learning_to_Segment_3D_Point_Clouds_in_2D_Image_Space_CVPR_2020_paper.pdf)  
20. Scroll Driven presentation in Three.js with GSAP | by Bandinopla \- Medium, accessed February 3, 2026, [https://medium.com/@pablobandinopla/scroll-driven-presentation-in-threejs-with-gsap-a2be523e430a](https://medium.com/@pablobandinopla/scroll-driven-presentation-in-threejs-with-gsap-a2be523e430a)  
21. Depth Priors in Removal Neural Radiance Fields \- arXiv, accessed February 3, 2026, [https://arxiv.org/html/2405.00630v3](https://arxiv.org/html/2405.00630v3)  
22. The source code of 'Visual Attribute Transfer through Deep Image Analogy'. \- GitHub, accessed February 3, 2026, [https://github.com/msracver/Deep-Image-Analogy](https://github.com/msracver/Deep-Image-Analogy)  
23. WebGL Precision Issues, accessed February 3, 2026, [https://webglfundamentals.org/webgl/lessons/webgl-precision-issues.html](https://webglfundamentals.org/webgl/lessons/webgl-precision-issues.html)  
24. \[1705.01088\] Visual Attribute Transfer through Deep Image Analogy \- arXiv, accessed February 3, 2026, [https://arxiv.org/abs/1705.01088](https://arxiv.org/abs/1705.01088)  
25. GLSL Envmap hdr/exr loader \- Questions \- three.js forum, accessed February 3, 2026, [https://discourse.threejs.org/t/glsl-envmap-hdr-exr-loader/42085](https://discourse.threejs.org/t/glsl-envmap-hdr-exr-loader/42085)  
26. Learned Perceptual Image Patch Similarity (LPIPS) — PyTorch-Metrics 1.8.2 documentation, accessed February 3, 2026, [https://lightning.ai/docs/torchmetrics/stable/image/learned\_perceptual\_image\_patch\_similarity.html](https://lightning.ai/docs/torchmetrics/stable/image/learned_perceptual_image_patch_similarity.html)  
27. ssundaram21/dreamsim: DreamSim: Learning New Dimensions of Human Visual Similarity using Synthetic Data (NeurIPS 2023 Spotlight) / / / / When Does Perceptual Alignment Benefit Vision Representations? (NeurIPS 2024\) \- GitHub, accessed February 3, 2026, [https://github.com/ssundaram21/dreamsim](https://github.com/ssundaram21/dreamsim)  
28. Dijkstra's algorithm \- Wikipedia, accessed February 3, 2026, [https://en.wikipedia.org/wiki/Dijkstra%27s\_algorithm](https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm)  
29. Creative WebGL Image Transitions \- Codrops, accessed February 3, 2026, [https://tympanus.net/codrops/2019/11/05/creative-webgl-image-transitions/](https://tympanus.net/codrops/2019/11/05/creative-webgl-image-transitions/)  
30. Introduction \- React Three Fiber, accessed February 3, 2026, [https://docs.pmnd.rs/react-three-fiber?ref=trap.jp](https://docs.pmnd.rs/react-three-fiber?ref=trap.jp)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAcCAYAAADcKOPNAAAD6ElEQVR4Xu3d24uVZRTH8ZVGZoghWiKZUoqIdREEkYSgFhkWiUl5ABEk7OQhLSotazI6gGYaBHoVFR0UUQyNIIQCoQNCF13kRZfilVf9A7l+8zwPe80z797zjoxOjN8PLJ7Du9mbmavFeg6vGQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/ycTqvEZjym5vzQ+CKbXE0OIv/F06AMAAKCFXdU4Jmm3hH4xtZ5o4cnQX+mxMYwBAADQwzfV+IXQ/9rj9jAu3s7tE7m9z2Nr7ssNHj94zPF4Lc8d7zzud5PHuGqujXst/da2+gEAAMBYtawax4Tt29wu91gV5j8I/bmhH/2W24dz+2N5EKyuJ1ra6/FyPQkAADAWLaonssMefR4vhblpHk/l/iO5VQVun8caj9s8/s7zogrbW2HclLB9X0+0oOraYza4MggAADDI/R5brJOIlGpUWx/XEyNkRT3Rw+/1RA87Pf4J44mhX2wK/Q89DoZxOcQQlSVVAACAq+Kox2SPv/J4uEt0MZkZScNJ2P6tJ7rQsuk8j6/CXNMesqYkTpTcNrmnngAAABhJ+3P7Xm61OV9VJC0zfuexPs8XCy0ld4c8HvR4aODj/pOTu0M0+TS3+i6Z5fGcx6uWNvdrs39J2JQQrvN43VJ1bIfHyfxM7vY4H8by3zWKoukE6lC6fRcAAMAgm3NbkqeoqdqmKpWSvD8sVaKGe4+Z6CqMA9bZyD/J4wsbeCBACdsMj8UeRzze9XjDY4PHic7H+itm58J4tNQnRWPS2vR/BAAAaE1Lom+GsZb3HrC0GV7XXjzjcZfHzfm5KmrHLJ1wlCvZv6XKnb7ztKXLZ7VPTBfSfmYpIZOzlipuukZDidwvlk5s/mQDK2o6RHAhjKNHLVXoSjWwSbcqYDeq/tV0UOFK6G/XnkH9DQAAAK3p6osm5Yb/93Ore8REBxZG26V6Ivvc40ZLSVZJOGuP1xNDiAcSim5XgvSiyuQrlpZ44/UiAAAAQ2paGu3lznpiFJQ9cVG8ALebmbmdbSlp0t1tcblVvrRU4TuVx/HAQqH9dcOlJFLVzD02sMIJAAAwJqn6V+8hi/ebXcytXlX1kXWqhLoHLWpa7vzZ0pKl9tCJlohrv9YTLY23lCwCAABcF+q9dM+G/p+51Wd0Z5teQSULctvnMT/3dXlu6UtJxspS8YvlQdCmmtekLIXqhCwAAMCYt9Y6p06b6CTqO5aWH8t+vDaWWDqJWujtCdHz1RgAAAA99Lo+41ZLr6D6xFIVrSiHJyItnRa6ny7uW9se+nfY4GVVAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMB16TKjpY1B/9UksgAAAABJRU5ErkJggg==>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAPCAYAAAAs9AWDAAAAaklEQVR4XmNgoApgB+ImIJ4BxDowwSIg1gdiEyBuBglwAPFGqKQfEE8BMVyAeBcQ1wLxfiAuxynYCsQBIAYQ7ANiVxBjIRDrATEnEL8AYjaQYD8QqwBxEhBXQjQwMNgD8XQGiLMYYYIUAADLRxAYGQNPIQAAAABJRU5ErkJggg==>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABkAAAAOCAYAAADaOrdAAAABGUlEQVR4Xu2TO0sDURBGr2gQrVV81bailWCqtCIWgoLEFCFEsLPzAUJAUgixVlAQRRuFkMYmjV06q/wgz+ze4OQzSbG2HjjsznfZZe7s3RD+yUgZlzTMwAWOaWis4JWGGVnFqobGDa5r+AceNTC6mIv32/iEu7F+jldlFhtYxwVsuzV7pve+hHH8cvUBnmIJl/HDrXl2sIAPsb51a2e44eowhU0fwCfO4D7W+pf6sO+4F+/9d7Cs4uqEltSdeLVxWMdbOB/SsXjecDGkXa+5/BgPXZ3wLvU9XuIr3oX0aBdDukOPdf+Cm5JfY16yZK7TGg7gV3dDsMYmNbStHmkozIWf+Y/CDsuJhj1s6zb3YdgBGfgnC+c44YNvsD4h68Ym79UAAAAASUVORK5CYII=>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAANCAYAAACKCx+LAAAAVElEQVR4XmNgoBmwBOJ7QKyELgECZ9EFQEAEiDcjCzQA8SQgXgTE1TDBXiBOg7J3AjEfTGI+EJsBMT8QHwdiNyBmBkn4A/EKIF4JxLuBOB2qgVoAAGrLC22sZDcOAAAAAElFTkSuQmCC>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAcAAAAPCAYAAAAoAdW+AAAAbElEQVR4XmNgoDmwBeJFQDwBiKuAOAQmwQHEG4GYCcqfCsTqMEkTIN4E4zAg6QIBESD+AMS3gbgciJmJlgQBBQaIxCEgTocJghwRCOMAQSwQF8A4ukDch5ADe0MWxolngEi2AXEFEBvDJGgEAKbCD/G9TUnlAAAAAElFTkSuQmCC>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAkAAAAOCAYAAAD9lDaoAAAAeUlEQVR4XmNgGBDAAsR9QPweiGuBuA2IzwOxMbIiEHAC4vVIfFsgPoDEB4NKIC5HE/uOxmfYwADRDQMiDBBFjEhiDM+AmAOJ7w/EW5H4DGpAfBxZAAjmA7EfskACEE9B4vsC8TIkPtjYo0C8hQHi/ZlA3MoACZaBAACf0hJvDPusrgAAAABJRU5ErkJggg==>

[image7]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAbCAYAAADBLdN1AAACr0lEQVR4Xu3cS6hVVRgH8KWJOJAsoZRoZERCMzMhEcEaFCk9MNBAjIwCQUHEByhGD4heio8gUkhJiQyKcmKhZpoE4dSh4LRRNm6i39daB/fdIl7r3sOhfj/4s1773n24o8VZ312lAAAAAAAAAAAAAAAAAHDHnop8E/kucqi3BgDACJjWknZ2F8bhycisznhNpw8AwAR5vNPf2+n/Ew/1JwAA+Pe+aG1utn6LbIx8H1kceTPyYeSZyOHIosjKyI7Io5FX//7JUmZEPoica2MAACbQldZ+W+q3bS9Hvi51U5abs/cjR9ozX0VeLHUD90Dk0zafz6ZfWwsAMBS7I/si7/UXJtnnkbcj2/sLQzI/cjBysY3vjzzR+k9HZrZ+tmdb/1Kp9Wz72xgAYCheaO3RMbO390cZW4h/udMfj7mR1ZHX+wtDclfkZKkb1cE3Z+9GNrV+HpWm3LCdbv2PS/07/djGAABD8VfkeH9yHI70xlt749u5GrmvPwkAwM1WlRvHoYOjvi2lHpWmrOPKgv0sxM+ar1ORKZH1bT2L9LMQf2kbp/yWalcnWQ/WtyFyrPU/inzS+vmufPeetj74TJ+VusGbXer78v0590rkh/bMrVybpAAATLovWzuntbkpSxciz5daiJ/HlstLvXT2p7aeprY2a8Gmd+ZTf8OWm8KuwRFj/t70c+T3Mva6jecib7V+btC2Re6O/Bl5rdT/2BxsNM+3FgDgP++RUmvK8oqLBZGFpdZ1rW3rgw1W1nW90foHSq3reraN79Q9pV5Em9/QzYtsjrwUORG5tz3zcKnvy4tv87OtiDwWORN5sNRatImwpNTNIQAAIyqPadf1JwEAGB2/lBvXeQAAMILynjUAAEbYO/0JAABGR14Tsqw/CQAAAAAAAAAAAAAAAAAAwP/ddZ/HbXEjsyowAAAAAElFTkSuQmCC>
