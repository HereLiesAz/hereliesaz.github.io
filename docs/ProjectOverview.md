# Shard Cloud: Project Overview

## Core Concept
The Shard Cloud project is an immersive, non-linear 3D art viewer. It reimagines the traditional gallery as a "Pareidolic Bridge" across an infinite void. Each artwork is deconstructed into thousands of primitive "shards" or "strokes," which are distributed in 3D space to create a volumetric cloud that remains abstract until viewed from a specific, anamorphic perspective.

## Requirements & Purpose

### 1. Pareidolic Bridges (Semantic Linking)
- **Requirement**: Use DINOv2 features to build a graph of visual similarities between paintings.
- **Purpose**: To ensure transitions feel "dreamlike" and "unnerving," where patterns in one image logically (but unpredictably) lead to the next.

### 2. Anamorphic Projection
- **Requirement**: Shards must coalesce via forced perspective into the original image.
- **Purpose**: To reward the user's navigation through the void with a "moment of clarity" when a coherent painting is revealed.

### 3. Depth-Aware Deconstruction (ZoeDepth & SAM)
- **Requirement**: Segment paintings using Segment Anything Model (SAM) and assign depth using ZoeDepth.
- **Purpose**: To give shards meaningful placement in space, rather than random dispersal, allowing the cloud to have a sense of "volume" that reflects the painting's internal composition.

### 4. Continuous Shard Mirroring
- **Requirement**: Mirror shard placement across the image's focal plane.
- **Purpose**: To eliminate "dead zones" in the void. By creating a bi-directional cloud (extending both toward and away from the camera), the space between two paintings becomes a continuous field of abstract marks, enhancing the feeling of a persistent, shared environment.

### 5. Incontrovertible Stasis
- **Requirement**: Shards must be stationary; movement is achieved ENTIRELY by the camera.
- **Purpose**: To maintain the integrity of the forced perspective. If shards moved procedurally, the anamorphic alignment would be a "moving target," losing its mathematical purity and impact.

### 6. Infinite Scroll Navigation
- **Requirement**: Use spline-based camera paths through "anchors" (shared shards).
- **Purpose**: To create a seamless, non-linear traversal that feels like floating through a constellation of art rather than browsing a list.

## Technical Achieving
The project utilizes **React Three Fiber (WebGL)** for rendering, **Zustand** for state management of the infinite graph, and **Custom GLSL Shaders** to handle the forced perspective math and volumetric rendering of thousands of instances at 60 FPS.
