import { useEffect, useMemo, useState } from 'react';
import { loadBandOverrides, saveBandOverrideEntry } from './data.js';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/** Renders just the pixels whose depth falls in [bandMin, bandMax) —
 * everything else transparent — the same hard-discard test
 * TheaterPainting.jsx's shader does per band, done here in a 2D canvas so
 * the admin can SEE a band before deciding whether it's a redundant
 * duplicate of its neighbor. depth.png is 16-bit but canvas only exposes
 * 8-bit-per-channel pixel data (browsers downsample on decode) — that's
 * the same precision loss the actual WebGL texture upload incurs too, so
 * this preview matches what actually renders, not just an approximation
 * of it. */
function renderBandMask(paintingImg, depthImg, bandMin, bandMax) {
  const w = paintingImg.naturalWidth || paintingImg.width;
  const h = paintingImg.naturalHeight || paintingImg.height;

  const depthCanvas = document.createElement('canvas');
  depthCanvas.width = w; depthCanvas.height = h;
  const dctx = depthCanvas.getContext('2d');
  dctx.drawImage(depthImg, 0, 0, w, h);
  const depthPixels = dctx.getImageData(0, 0, w, h).data;

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(paintingImg, 0, 0, w, h);
  const painting = ctx.getImageData(0, 0, w, h);
  const px = painting.data;

  for (let i = 0, n = w * h; i < n; i++) {
    const d = depthPixels[i * 4] / 255;
    if (d < bandMin || d >= bandMax) px[i * 4 + 3] = 0;
  }
  ctx.putImageData(painting, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Depth-band curation for one painting: a thumbnail per band (rendered
 * client-side, see renderBandMask above) with a checkbox to hide/merge
 * it. Hiding a band folds its depth range into a still-visible neighbor
 * (see src/utils/bandOverrides.js) rather than leaving a rendering gap.
 * Writes public/band-overrides.json — no re-bake needed, takes effect on
 * the next deploy since TheaterPainting.jsx applies the override at
 * render time from the already-baked theater.json. */
export default function BandEditor({ id }) {
  const [status, setStatus] = useState('loading'); // loading | ready | { error } | 'saving' | 'saved'
  const [bands, setBands] = useState([]); // [{ index, min, max, preview }]
  const [hidden, setHidden] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setBands([]);
    setHidden(new Set());

    (async () => {
      const [theaterRes, overrides] = await Promise.all([
        fetch(`/data/theater/${encodeURIComponent(id)}.theater.json`, { cache: 'no-store' }),
        loadBandOverrides().catch(() => ({})),
      ]);
      if (!theaterRes.ok) throw new Error(`could not load theater data for ${id}`);
      const theater = await theaterRes.json();
      const edges = theater?.depth?.bands?.edges;
      const centers = theater?.depth?.bands?.centers;
      if (!Array.isArray(edges) || !Array.isArray(centers) || centers.length === 0) {
        throw new Error('this painting has no depth bands to edit');
      }

      const [paintingImg, depthImg] = await Promise.all([
        loadImage(`/data/theater/${encodeURIComponent(id)}.painting.webp`),
        loadImage(`/data/theater/${encodeURIComponent(theater.depth.file || `${id}.depth.png`)}`),
      ]);
      if (cancelled) return;

      const built = centers.map((_, i) => ({
        index: i,
        min: edges[i],
        max: edges[i + 1],
        preview: renderBandMask(paintingImg, depthImg, edges[i], edges[i + 1]),
      }));
      if (cancelled) return;
      setBands(built);
      setHidden(new Set(overrides?.[id]?.hidden || []));
      setStatus('ready');
    })().catch(e => { if (!cancelled) setStatus({ error: e.message }); });

    return () => { cancelled = true; };
  }, [id]);

  const toggle = (index) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    if (status === 'saved') setStatus('ready');
  };

  const visibleCount = bands.length - hidden.size;

  const save = async () => {
    setStatus('saving');
    try {
      await saveBandOverrideEntry(id, [...hidden]);
      setStatus('saved');
    } catch (e) {
      setStatus({ error: e.message });
    }
  };

  if (status === 'loading') return <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>loading layers…</p>;
  if (status?.error) return <p className="admin-error" role="alert">{status.error}</p>;

  return (
    <div>
      <p style={{ fontSize: '0.75rem', opacity: 0.6 }}>
        Each tile is one depth layer, darkest/farthest first. Hide the ones that look like duplicates of a
        neighbor — hidden layers fold into whichever visible layer is next to them, so nothing goes missing,
        it just stops being its own cutout.
      </p>
      <div className="admin-grid">
        {bands.map(b => (
          <button
            type="button"
            key={b.index}
            className="admin-grid-item"
            onClick={() => toggle(b.index)}
            aria-pressed={hidden.has(b.index)}
            style={{ opacity: hidden.has(b.index) ? 0.35 : 1, cursor: 'pointer', border: 'none' }}
          >
            <img src={b.preview} alt={`layer ${b.index}`} loading="lazy" />
            <span>layer {b.index}{hidden.has(b.index) ? ' — hidden' : ''}</span>
          </button>
        ))}
      </div>
      <div className="admin-row" style={{ marginTop: '0.8em' }}>
        <button type="button" onClick={save} disabled={status === 'saving' || visibleCount === 0}>
          {status === 'saving' ? 'saving…' : 'save layers'}
        </button>
        {visibleCount === 0 && <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>at least one layer must stay visible</span>}
      </div>
      {status === 'saved' && <p className="admin-ok" role="status" aria-live="polite">Saved — live after the next deploy (usually under a minute).</p>}
    </div>
  );
}
