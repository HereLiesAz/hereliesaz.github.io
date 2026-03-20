import { create } from 'zustand';
import * as THREE from 'three';

const useStore = create((set, get) => ({
  // --- STATE ---
  nodes: [],           
  edges: [],           
  
  activeClusters: [],  // [{ id, worldPos, anchorId }]
  currentPath: null,   // THREE.Curve for camera
  
  currentNodeId: null, // Legacy support for Overlay
  currentShardCount: 0,
  currentResolution: [1000, 1000],
  
  transitionProgress: 0, 
  isTransitioning: false,
  
  // UI State
  showMenu: false,

  // --- ACTIONS ---
  setGraph: (graphData) => {
    if (!graphData) return;
    set({ 
      nodes: Array.isArray(graphData.nodes) ? graphData.nodes : [],
      edges: Array.isArray(graphData.edges) ? graphData.edges : []
    });
  },

  setStartNode: (id) => {
    console.log("[Store] Starting at:", id);
    const firstCluster = { id, worldPos: [0, 0, 0] };
    set({ activeClusters: [firstCluster], currentNodeId: id });
    get().buildNextSegment();
  },

  setCurrentResolution: (res) => set({ currentResolution: res }),
  setCurrentShardCount: (count) => set({ currentShardCount: count }),

  // Build the next step in the infinite void
  buildNextSegment: () => {
    const { nodes, edges, activeClusters } = get();
    if (activeClusters.length === 0) return;

    const current = activeClusters[activeClusters.length - 1];
    const currentZ = current.worldPos[2];
    
    // 1. Pick next node (Stochastic)
    const candidates = edges.filter(e => e.source === current.id);
    let edge;
    if (candidates.length > 0) {
        edge = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
        const others = nodes.filter(n => n.id !== current.id);
        const randomTarget = others[Math.floor(Math.random() * others.length)].id;
        edge = { target: randomTarget };
    }

    const nextId = edge.target;
    const nextNode = nodes.find(n => n.id === nextId);
    
    // --- PRECISE ANCHOR ALIGNMENT ---
    const worldHeight = 10;
    const imgAspect = (nextNode?.res?.[0] || 1000) / (nextNode?.res?.[1] || 1000);
    const worldWidth = worldHeight * imgAspect;
    const FULCRUM_Z = -10.0;

    let nextPos = [0, 0, currentZ - 35.0]; 

    let anchorWorldPos = null;

    if (edge.s_nx !== undefined && edge.t_nx !== undefined) {
        const z_a = - (edge.s_depth * 50.0 + 5.0);
        const factor_a = z_a / FULCRUM_Z;
        anchorWorldPos = new THREE.Vector3(
            current.worldPos[0] + edge.s_nx * worldWidth * factor_a,
            current.worldPos[1] + edge.s_ny * worldHeight * factor_a,
            current.worldPos[2] + z_a
        );

        const z_next_local = - (edge.t_depth * 50.0 + 5.0);
        const factor_next = z_next_local / FULCRUM_Z;
        
        nextPos = [
            anchorWorldPos.x - (edge.t_nx * worldWidth * factor_next),
            anchorWorldPos.y - (edge.t_ny * worldHeight * factor_next),
            anchorWorldPos.z - z_next_local
        ];

        // Update the current cluster's exit anchor properly (no mutation)
        set(state => ({
            activeClusters: state.activeClusters.map(c => 
                c.id === current.id ? { ...c, anchorId: edge.source_shard } : c
            )
        }));
    } else {
        nextPos[0] += (Math.random() - 0.5) * 10;
        nextPos[1] += (Math.random() - 0.5) * 10;
    }

    // --- CINEMATIC TRANSFORMATION BUDGET (35°) ---
    const TOTAL_BUDGET = 35.0; // Degrees
    const randomWeights = [Math.random(), Math.random(), Math.random(), Math.random()];
    const W_SUM = randomWeights.reduce((a, b) => a + b, 0);
    const budget = randomWeights.map(w => (w / W_SUM) * TOTAL_BUDGET);
    
    // Euler Swerve (Store in Degrees for unified verification)
    const rotSway = budget.slice(0, 3);
    // Path Swerve (Lateral displacement in world units)
    // Approx: 1 unit of swerve at distance 17 is ~3 degrees? Let's scale for impact.
    const swerveDist = budget[3] * 0.5; 

    const nextCluster = { 
        id: nextId, 
        worldPos: nextPos, 
        anchorId: edge.target_shard,
        rotSway: rotSway
    };
    
    // 3. Camera Spline through Anchor with Swerve
    const startPoint = new THREE.Vector3(current.worldPos[0], current.worldPos[1], currentZ);
    const endPoint = new THREE.Vector3(nextPos[0], nextPos[1], nextPos[2]);
    
    // Displace anchorWorldPos laterally for the "Path Curve" part of the 35°
    const midPoint = (anchorWorldPos || new THREE.Vector3(
        (startPoint.x + endPoint.x) * 0.5,
        (startPoint.y + endPoint.y) * 0.5,
        (startPoint.z + endPoint.z) * 0.5
    )).clone();

    // Apply lateral swerve (Random direction in XY)
    const swerveAngle = Math.random() * Math.PI * 2;
    midPoint.x += Math.cos(swerveAngle) * swerveDist;
    midPoint.y += Math.sin(swerveAngle) * swerveDist;

    set({ 
        activeClusters: [...activeClusters, nextCluster],
        currentPath: [startPoint, midPoint, endPoint]
    });
    
    console.log(`[Store] Pareidolic Bridge Formed: ${current.id} -> ${nextId}`);
  },

  completeTransition: () => {
    const { activeClusters } = get();
    if (activeClusters.length < 2) return;

    const newActive = activeClusters.slice(-2); 
    const nextNodeId = newActive[newActive.length - 1].id;
    
    set({ 
        activeClusters: newActive,
        currentNodeId: nextNodeId,
        transitionProgress: 0,
        isTransitioning: false
    });

    get().buildNextSegment();
  },

  setTransitionProgress: (val) => set({ transitionProgress: val, isTransitioning: val > 0.01 && val < 0.99 }),
  toggleMenu: () => set(state => ({ showMenu: !state.showMenu })),
}));

export { useStore };
export default useStore;
