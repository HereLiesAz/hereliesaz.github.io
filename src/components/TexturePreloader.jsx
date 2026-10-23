import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { fetchTheaterMeta } from './TheaterPainting';

// Only three paintings are ever mounted (the one we're on, the one we
// just left, the one we're headed toward). To keep the handoff seamless
// we warm the ones JUST outside that window: their theater.json, their
// painting.webp and their depth png, so the window sliding onto them finds the
// files already downloaded instead of making a cold request.
//
// This only primes the browser's HTTP cache. THREE.TextureLoader (same URL)
// still decodes the image again and the GPU upload still happens on the first
// visible frame; what is saved is the network round trip. Purely side-effectful:
// renders nothing.
const AHEAD  = 3;   // warm this many segments forward (we move forward most)
const BEHIND = 2;   // and this many back, for scroll-up handoffs

const warmed = new Set();
// Hold a reference to each in-flight Image until it settles. Without this
// the object can be GC'd before the fetch completes, and some browsers
// abort the request when its Image is collected — defeating the warm.
const inFlight = new Set();

function warm(id) {
  if (!id || warmed.has(id)) return;
  warmed.add(id);
  // theater.json first — buildFlats needs it the instant the painting mounts, and
  // it names the depth file (meta.depth.file), which is not always {id}.depth.png.
  fetchTheaterMeta(id).then(meta => {
    // A failed theater.json fetch is evicted from the meta cache; let the next
    // window slide retry the whole warm instead of remembering the failure.
    if (!meta) warmed.delete(id);
    const enc = encodeURIComponent(id);
    const depthFile = meta?.depth?.file || `${id}.depth.png`;
    for (const url of [
      `/data/theater/${enc}.painting.webp`,
      `/data/theater/${encodeURIComponent(depthFile)}`,
    ]) {
      const img = new Image();
      inFlight.add(img);
      img.onload = () => inFlight.delete(img);
      // A failed warm (network blip, 5xx) must not mark the id warmed for the
      // rest of the session — forget it so the next window slide retries.
      img.onerror = () => { inFlight.delete(img); warmed.delete(id); };
      img.src = url;
    }
  }).catch(() => { warmed.delete(id); });
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
