import { useEffect, useState } from 'react';
import { listBakedPaintings, loadMeta } from './data.js';
import PaintingEditor from './PaintingEditor.jsx';

export default function PaintingsList() {
  const [ids, setIds] = useState(null);
  const [meta, setMeta] = useState({});
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('');

  const [error, setError] = useState(null);
  const [metaError, setMetaError] = useState(null);

  const reload = () => {
    setIds(null);
    setError(null);
    setMetaError(null);
    // The list and the titles fail independently: no list is an error with a
    // retry; no titles still shows the paintings, by id, with a note.
    Promise.all([
      listBakedPaintings().then(list => ({ list }), err => ({ err })),
      loadMeta().then(m => ({ m }), err => ({ err })),
    ]).then(([listResult, metaResult]) => {
      if (listResult.err) {
        setIds([]);
        setError(listResult.err.message);
      } else {
        setIds(listResult.list);
      }
      if (metaResult.err) setMetaError(metaResult.err.message);
      else setMeta(metaResult.m);
    });
  };
  useEffect(reload, []);

  if (selected) {
    return (
      <PaintingEditor
        id={selected}
        onClose={() => setSelected(null)}
        onRemoved={() => { setSelected(null); reload(); }}
      />
    );
  }

  const visible = (ids || []).filter(id =>
    !filter || id.toLowerCase().includes(filter.toLowerCase())
    || (meta[id]?.title || '').toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="admin-panel">
      <div className="admin-row admin-row--between">
        <h2>Paintings ({ids ? ids.length : '…'})</h2>
        <button type="button" onClick={reload} className="admin-btn-plain" disabled={ids === null}>
          {ids === null ? 'refreshing…' : 'refresh'}
        </button>
      </div>
      <p style={{ fontSize: '0.75rem', opacity: 0.6 }}>
        This list is the live, deployed site's data — adding or removing a painting runs in the
        background (usually a few minutes) before it shows up here, even after refreshing.
      </p>
      <input
        className="admin-input"
        placeholder="filter…"
        aria-label="filter paintings"
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />
      {ids === null && <p>loading…</p>}
      {error && (
        <p className="admin-error" role="alert">
          {error} <button type="button" className="admin-btn-plain" onClick={reload}>try again</button>
        </p>
      )}
      {metaError && !error && (
        <p className="admin-error" role="alert">
          Titles and prices could not be loaded ({metaError}); paintings are listed by id.
        </p>
      )}
      {ids !== null && !error && ids.length === 0 && <p>No paintings are baked yet.</p>}
      <div className="admin-grid">
        {visible.map(id => (
          <button type="button" key={id} className="admin-grid-item" onClick={() => setSelected(id)}>
            <img src={`/data/theater/${encodeURIComponent(id)}.painting.webp`} alt="" loading="lazy" />
            <span>{meta[id]?.title || id}</span>
            {meta[id]?.forSale && <span className="admin-badge">for sale</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
