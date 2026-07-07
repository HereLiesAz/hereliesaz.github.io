import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { fetchTheaterMeta } from './TheaterPainting';

// Only three paintings are ever mounted (the one we're on, the one we
// just left, the one we're headed toward). To keep the handoff seamless
// we warm the ones JUST outside that window — their theater.json, their
// painting.webp, and their depth.png — so when the window slides onto
// them the decode/upload is already done and there's no cold-fetch pop.
//
// The browser's HTTP + image caches do the holding: kicking off an
// Image() for a URL means THREE.TextureLoader (same URL) hits cache when
// the painting actually mounts. Purely side-effectful — renders nothing.
const AHEAD  = 3;   // warm this many segments forward (we move forward most)
const BEHIND = 2;   // and this many back, for scroll-up handoffs

const warmed = new Set();

function warm(id) {
  if (!id || warmed.has(id)) return;
  warmed.add(id);
  // theater.json first — buildFlats needs it the instant the painting mounts.
  fetchTheaterMeta(id);
  const enc = encodeURIComponent(id);
  new Image().src = `/data/theater/${enc}.painting.webp`;
  new Image().src = `/data/theater/${enc}.depth.png`;
}

export default function TexturePreloader() {
  const activeClusters      = useStore(s => s.activeClusters);
  const currentSegmentIndex = useStore(s => s.currentSegmentIndex);

  useEffect(() => {
    for (let i = currentSegmentIndex - BEHIND; i <= currentSegmentIndex + AHEAD; i++) {
      const c = activeClusters[i];
      if (c) warm(c.id);
    }
  }, [activeClusters, currentSegmentIndex]);

  return null;
}
