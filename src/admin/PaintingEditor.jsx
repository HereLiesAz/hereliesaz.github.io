import { useEffect, useState } from 'react';
import { loadMeta, removePainting, saveMetaEntry } from './data.js';

const BLANK = { title: '', description: '', tags: '', forSale: false, price: '', currency: 'USD' };

/** Metadata form for one painting id, plus its delete action. Reads/writes
 * public/meta.json as a whole (see data.js) — small enough at this
 * corpus size that a full read-modify-write per edit is simpler and safer
 * (no partial-update races) than a per-field patch API. */
export default function PaintingEditor({ id, onClose, onRemoved }) {
  const [form, setForm] = useState(BLANK);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null); // null | 'saving' | 'saved' | 'removing' | { error }

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
    setStatus('saving');
    try {
      const entry = {
        title: form.title.trim(),
        description: form.description.trim(),
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        forSale: !!form.forSale,
        ...(form.forSale && form.price !== '' ? { price: Number(form.price), currency: form.currency.trim() || 'USD' } : {}),
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
      // run and redeploy), reading as "nothing happened". Show confirmation
      // + a link to watch it instead; the list catches up whenever the
      // user next hits refresh.
      setStatus('removed');
    } catch (e) {
      setStatus({ error: e.message });
    }
  };

  if (loading) return <div className="admin-panel"><p>loading…</p></div>;

  return (
    <div className="admin-panel">
      <div className="admin-row admin-row--between">
        <h2 style={{ wordBreak: 'break-all' }}>{id}</h2>
        <button type="button" onClick={onClose} className="admin-btn-plain">close</button>
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
          <input className="admin-input" style={{ maxWidth: '8rem' }} type="number" min="0" step="1" value={form.price} onChange={set('price')} placeholder="price" />
          <input className="admin-input" style={{ maxWidth: '6rem' }} value={form.currency} onChange={set('currency')} placeholder="USD" />
        </div>
      )}

      <div className="admin-row">
        <button type="button" onClick={save} disabled={status === 'saving' || status === 'removed'}>{status === 'saving' ? 'saving…' : 'save'}</button>
        <button type="button" onClick={remove} disabled={status === 'removing' || status === 'removed'} className="admin-btn-danger">
          {status === 'removing' ? 'removing…' : status === 'removed' ? 'removal dispatched' : 'remove from site'}
        </button>
      </div>
      {status === 'saved' && <p className="admin-ok">Saved — live after the next deploy (usually under a minute).</p>}
      {status === 'removed' && (
        <p className="admin-ok">
          Removal dispatched — this takes a few minutes to actually run (delete the baked files, rebuild the
          hinge graph, redeploy).{' '}
          <a href="https://github.com/HereLiesAz/hereliesaz.github.io/actions/workflows/remove_painting.yml" target="_blank" rel="noreferrer noopener">
            watch the run
          </a>, then <button type="button" className="admin-btn-plain" onClick={() => onRemoved?.(id)}>back to the list</button>.
        </p>
      )}
      {status?.error && <p className="admin-error">{status.error}</p>}
    </div>
  );
}
