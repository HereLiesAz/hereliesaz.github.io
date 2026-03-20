import { create } from 'zustand';
import {
  SEGMENT_LENGTH, RECENT_EXCLUDE,
  computeT, pickNextNode, computeAnchorMidpoint, buildHistoryEntry
} from './storeHelpers.js';

const useStore = create((set, get) => ({
  // Graph data
  nodes: [],
  edges: [],

  // Session history: [{ id, sweetZ, splinePoints: [[x,y,z],[x,y,z],[x,y,z]] }]
  history: [],
  historyPosition: -1,  // index of painting the camera is currently leaving

  // Camera
  cameraZ: 0,

  // UI
  showMenu: false,

  // Buffer rollover signal (incremented to trigger VoidField to roll)
  rolloverCount: 0,
  nextPaintingId: null,    // id to load into slot 1 on next rollover

  // --- Actions ---

  setGraph(graphData) {
    if (!graphData) return;
    const nodes = Array.isArray(graphData.nodes) ? graphData.nodes : [];
    const edges = Array.isArray(graphData.edges) ? graphData.edges : [];
    set({ nodes, edges });
  },

  /** Called once after graph loads: picks a random start painting. */
  initSession() {
    const { nodes, edges } = get();
    if (nodes.length === 0) return;

    const startNode = nodes[Math.floor(Math.random() * nodes.length)];
    if (!startNode) return;

    const sweetZ     = 0;
    const firstEntry = buildHistoryEntry({
      id: startNode.id, sweetZ,
      splineStart: [0, 0, 0], splineMid: [0, 0, -SEGMENT_LENGTH / 2],
      splineEnd:   [0, 0, -SEGMENT_LENGTH],
    });

    // Pre-pick the next painting
    const recentIds   = [startNode.id];
    let nextId = null;
    try {
      nextId = pickNextNode(startNode.id, edges, recentIds);
    } catch (e) {
      console.warn("Could not pick next node:", e.message);
      // If we can't find a next node, just keep the current one active
      set({ history: [firstEntry], historyPosition: 0 });
      return;
    }

    const nextNode    = nodes.find(n => n.id === nextId);
    const nextSweetZ  = -SEGMENT_LENGTH;
    const edge        = edges.find(e => e.source === startNode.id && e.target === nextId);
    
    // Safety: ensure we have both nodes for the spline computation
    const midpoint    = (edge && startNode && nextNode)
      ? computeAnchorMidpoint(
          edge,
          { ...startNode, sweetZ },
          { ...nextNode,  sweetZ: nextSweetZ },
          SEGMENT_LENGTH
        )
      : [0, 0, -SEGMENT_LENGTH / 2];

    const secondEntry = buildHistoryEntry({
      id: nextId, sweetZ: nextSweetZ,
      splineStart: [0, 0, sweetZ],
      splineMid:   midpoint,
      splineEnd:   [0, 0, nextSweetZ],
    });

    set({
      history: [firstEntry, secondEntry],
      historyPosition: 0,
      nextPaintingId: nextId,
    });
  },

  setCameraZ(z) {
    const { history, historyPosition, nodes, edges, rolloverCount } = get();
    if (history.length === 0) return;

    const currentEntry = history[historyPosition];
    if (!currentEntry) return;

    const t = computeT({ sweetZ: currentEntry.sweetZ, cameraZ: z });

    // Trigger preload at 60%
    if (t >= 0.6 && historyPosition + 1 < history.length) {
      const upcomingId = history[historyPosition + 1]?.id;
      set({ nextPaintingId: upcomingId, cameraZ: z });
    } else {
      set({ cameraZ: z });
    }

    // Rollover at 100%: advance history position
    if (t >= 1.0) {
      const nextPos = historyPosition + 1;
      if (nextPos < history.length) {
        // Moving forward in known history (deterministic)
        set({ historyPosition: nextPos, rolloverCount: rolloverCount + 1 });
        get()._ensureNextEntryExists(nextPos);
      }
    }

    // Going backward: detect by comparing cameraZ to previous sweet spot
    if (historyPosition > 0) {
      const prevEntry = history[historyPosition - 1];
      // camera has passed prevEntry's sweet spot going backward (cameraZ is larger/less negative than sweetZ)
      if (z > prevEntry.sweetZ) {
        const prevPos = historyPosition - 1;
        set({ historyPosition: prevPos, rolloverCount: rolloverCount + 1,
              nextPaintingId: currentEntry.id });
      }
    }
  },

  /** Ensure there is always an entry after the current position. */
  _ensureNextEntryExists(currentPos) {
    const { history, nodes, edges } = get();
    if (currentPos + 1 < history.length) return; // already exists

    const currentEntry = history[currentPos];
    const recentIds = history
      .slice(Math.max(0, currentPos - RECENT_EXCLUDE), currentPos + 1)
      .map(e => e.id);

    // Pick next node with safety
    let pickId = null;
    try {
      pickId = pickNextNode(currentEntry.id, edges, recentIds);
    } catch (e) {
       console.warn("Could not pick next node:", e.message);
       return;
    }

    const nextNode   = nodes.find(n => n.id === pickId);
    const nextSweetZ = currentEntry.sweetZ - SEGMENT_LENGTH;
    const edge       = edges.find(e => e.source === currentEntry.id && e.target === pickId);
    const startNode  = nodes.find(n => n.id === currentEntry.id);

    const midpoint   = (edge && startNode && nextNode)
      ? computeAnchorMidpoint(
          edge,
          { ...startNode, sweetZ: currentEntry.sweetZ },
          { ...nextNode, sweetZ: nextSweetZ },
          SEGMENT_LENGTH
        )
      : [0, 0, currentEntry.sweetZ - SEGMENT_LENGTH / 2];

    const nextEntry = buildHistoryEntry({
      id: pickId, sweetZ: nextSweetZ,
      splineStart: [0, 0, currentEntry.sweetZ],
      splineMid:   midpoint,
      splineEnd:   [0, 0, nextSweetZ],
    });

    set({ history: [...history, nextEntry], nextPaintingId: nextId });
  },

  toggleMenu() { set(state => ({ showMenu: !state.showMenu })); },
}));

export { useStore };
export default useStore;