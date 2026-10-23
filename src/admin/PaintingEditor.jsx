import { useEffect, useState } from 'react';
import { deploySite, loadMeta, removePainting, saveMetaEntry } from './data.js';
import BandEditor from './BandEditor.jsx';

/** Starts deploy.yml; removals land on the art-data branch, which does not
 * trigger a deploy on its own. */
function DeployNow() {
  const [state, setState] = useState(null); // null | 'working' | 'queued' | { error }
  const go = async () => {
    setState('working');
    try {
      await deploySite();
      setState('queued');
    } catch (e) {
      setState({ error: e.message });
    }
  };
  if (state === 'queued') return <>deploy queued — live in a few minutes</>;
  return (
    <>
      <button type="button" className="admin-btn-plain" onClick={go} disabled={state === 'working'}>
        {state === 'working' ? 'queueing…' : 'deploy now'}
      </button>
      {state?.error && <span className="admin-error" role="alert"> {state.error}</span>}
    </>
  );
}

const BLANK = { title: '', description: '', tags: '', forSale: false, price: '', currency: 'USD' };

/** Metadata form for one painting id, plus its delete action. Reads/writes
 * public/meta.json as a whole (see data.js) — small enough at this
 * corpus size that a full read-modify-write per edit is simpler and safer
 * (no partial-update races) than a per-field patch API. */
export default function PaintingEditor({ id, onClose, onRemoved }) {
  const [form, setForm] = useState(BLANK);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null); // null | 'saving' | 'saved' | 'removing' | { error }
  // Lazy: BandEditor loads the full painting + depth images and does
  // per-pixel canvas work to build previews — real cost, not worth paying
  // just from opening a painting to edit its title.
  const [showBands, setShowBands] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMeta().then(meta => {
      if (cancelled) return;
      const entry = meta[id];
      setForm(entry ? {
        title: entry.title || '',
        description: entry.description || '',
        tags: Array.isArray(entry.tags) ? entry.tags.join(', ') : '',
        forSale: !!entry.forSale,
        price: entry.price ?? '',
        currency: entry.currency || 'USD',
      } : BLANK);
      setLoading(false);
    }).catch(e => { if (!cancelled) { setStatus({ error: e.message }); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id]);

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    if (form.forSale && form.price === '') {
      setStatus({ error: 'Marked "for sale" needs a price — the gallery caption has nothing to show without one.' });
      return;
    }
    if (form.forSale && Number(form.price) < 0) {
      setStatus({ error: 'Price can\'t be negative.' });
      return;
    }
    setStatus('saving');
    try {
      const entry = {
        title: form.title.trim(),
        description: form.description.trim(),
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        forSale: !!form.forSale,
        ...(form.forSale && form.price !== '' ? { price: Number(form.price), currency: form.currency.trim().toUpperCase() || 'USD' } : {}),
      };
      await saveMetaEntry(id, entry);
      setStatus('saved');
    } catch (e) {
      setStatus({ error: e.message });
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove "${id}" from the site? This deletes the source photo and all baked data. It cannot be undone from here.`)) return;
    setStatus('removing');
    try {
      await removePainting(id);
      // Deliberately NOT calling onRemoved() here — that would close this
      // panel and reload the list immediately, which still shows the
      // painting (the removal workflow takes a few minutes to actually
      // run, and the site only drops the painting at its next deploy), reading as "nothing happened". Show confirmation
      // + a link to watch it instead; the list catches up whenever the
      // user next hits refresh.
      setStatus('removed');
    } catch (e) {
      // removePainting() dispatches the actual removal first and only
      // throws afterward (with `.dispatched = true`) if a secondary
      // cleanup step (source photo delete, metadata strip) failed — the
      // painting is still going away, just with loose ends. Show both:
      // the removal confirmation AND the cleanup error, not just one.
      if (e.dispatched) setStatus({ removedWithWarning: e.message });
      else setStatus({ error: e.message });
    }
  };

  if (loading) return <div className="admin-panel"><p>loading…</p></div>;

  return (
    <div className="admin-panel">
      <div className="admin-row admin-row--between">
        <h2 style={{ wordBreak: 'break-all' }}>{id}</h2>
        {/* Disabled mid-removal: closing would unmount this panel while
            removePainting() is still awaiting the queued dispatch, losing
            its success/failure report. */}
        <button type="button" onClick={onClose} className="admin-btn-plain" disabled={status === 'removing'}>close</button>
      </div>
      <img src={`/data/theater/${encodeURIComponent(id)}.painting.webp`} alt="" className="admin-thumb-large" />

      <label className="admin-label">Title
        <input className="admin-input" value={form.title} onChange={set('title')} placeholder={id} />
      </label>
      <label className="admin-label">Description
        <textarea className="admin-input" rows={3} value={form.description} onChange={set('description')} />
      </label>
      <label className="admin-label">Tags (comma-separated)
        <input className="admin-input" value={form.tags} onChange={set('tags')} placeholder="ink, figure, 2024" />
      </label>
      <label className="admin-row">
        <input type="checkbox" checked={form.forSale} onChange={set('forSale')} /> For sale
      </label>
      {form.forSale && (
        <div className="admin-row">
          <input className="admin-input" style={{ maxWidth: '8rem' }} type="number" min="0" step="1" value={form.price} onChange={set('price')} placeholder="price" aria-label="price" />
          <input className="admin-input" style={{ maxWidth: '6rem' }} value={form.currency} onChange={set('currency')} placeholder="USD" aria-label="currency" />
        </div>
      )}

      <h3>Depth layers</h3>
      <button type="button" className="admin-btn-plain" onClick={() => setShowBands(v => !v)} aria-expanded={showBands}>
        {showBands ? 'hide layer editor' : 'edit layers'}
      </button>
      {showBands && <BandEditor id={id} />}

      <div className="admin-row">
        <button type="button" onClick={save} disabled={status === 'saving' || status === 'removed' || (status && status.removedWithWarning)}>{status === 'saving' ? 'saving…' : 'save'}</button>
        <button type="button" onClick={remove} disabled={status === 'removing' || status === 'removed' || (status && status.removedWithWarning)} className="admin-btn-danger">
          {status === 'removing' ? 'removing…' : (status === 'removed' || (status && status.removedWithWarning)) ? 'removal dispatched' : 'remove from site'}
        </button>
      </div>
      {status === 'removing' && (
        <p role="status" aria-live="polite" style={{ fontSize: '0.75rem', opacity: 0.6 }}>
          Waiting for it to be safe to dispatch — if another removal is still running, this can take a few minutes
          rather than a few seconds. That's expected, not stuck.
        </p>
      )}
      {status === 'saved' && <p className="admin-ok" role="status" aria-live="polite">Saved — live after the next deploy (usually under a minute).</p>}
      {(status === 'removed' || (status && status.removedWithWarning)) && (
        <p className="admin-ok" role="status" aria-live="polite">
          Removal dispatched. It runs in{' '}
          <a href="https://github.com/HereLiesAz/workflows/actions" target="_blank" rel="noreferrer noopener">
            HereLiesAz/workflows
          </a>{' '}
          and takes a few minutes (delete the baked files, rebuild the manifest and graph). The live site drops
          the painting at its next deploy: <DeployNow />. Then{' '}
          <button type="button" className="admin-btn-plain" onClick={() => onRemoved?.(id)}>back to the list</button>.
        </p>
      )}
      {status?.removedWithWarning && <p className="admin-error" role="alert">{status.removedWithWarning}</p>}
      {status?.error && <p className="admin-error" role="alert">{status.error}</p>}
    </div>
  );
}
