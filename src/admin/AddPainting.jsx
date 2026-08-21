import { useState } from 'react';
import { dispatchWorkflow, fileToBase64, putFile } from './github.js';

function idFromFilename(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** Uploads raw photo(s) to public/assets/ and dispatches theater_bake.yml
 * for exactly the new id(s) — the existing pipeline (crop → photorealize
 * → depth → hinge graph → validate → publish) does the rest, unchanged
 * from how a developer would trigger it by hand. See
 * .github/workflows/theater_bake.yml. */
export default function AddPainting() {
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState(null); // null | 'uploading' | 'baking' | 'done' | { error }
  const [dispatchedIds, setDispatchedIds] = useState([]);

  const run = async () => {
    if (files.length === 0) return;
    setStatus('uploading');
    const ids = [];
    try {
      for (const file of files) {
        const id = idFromFilename(file.name);
        const b64 = await fileToBase64(file);
        await putFile(`public/assets/${file.name}`, b64, `admin: add painting ${id}`);
        ids.push(id);
      }
      setStatus('baking');
      await dispatchWorkflow('theater_bake.yml', { ids: ids.join(',') });
      setDispatchedIds(ids);
      setStatus('done');
      setFiles([]);
    } catch (e) {
      setStatus({ error: e.message });
    }
  };

  return (
    <div className="admin-panel">
      <h2>Add paintings</h2>
      <p>Pick one or more photos. Each uploads to <code>public/assets/</code> and gets baked (crop, depth, hinge graph) automatically — that usually takes a few minutes per painting once dispatched.</p>
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={e => setFiles(Array.from(e.target.files || []))}
        className="admin-input"
      />
      {files.length > 0 && (
        <ul className="admin-file-list">
          {files.map(f => <li key={f.name}>{f.name} ({Math.round(f.size / 1024)} KB)</li>)}
        </ul>
      )}
      <div className="admin-row">
        <button type="button" onClick={run} disabled={files.length === 0 || status === 'uploading' || status === 'baking'}>
          {status === 'uploading' ? 'uploading…' : status === 'baking' ? 'dispatching bake…' : `upload ${files.length || ''}`.trim()}
        </button>
      </div>
      {status === 'done' && (
        <p className="admin-ok">
          Uploaded and dispatched: {dispatchedIds.join(', ')}.{' '}
          <a href={`https://github.com/HereLiesAz/hereliesaz.github.io/actions/workflows/theater_bake.yml`} target="_blank" rel="noreferrer noopener">
            watch the bake run
          </a>.
        </p>
      )}
      {status?.error && <p className="admin-error">{status.error}</p>}
    </div>
  );
}
