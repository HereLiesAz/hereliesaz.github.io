import { useState } from 'react';
import { dispatchWorkflow, fileToBase64, putFile } from './github.js';

/** Derives both the painting id and the filename actually uploaded from a
 * picked file's name. The id gets spliced into a comma-joined batch
 * (theater_bake.yml's `--ids`) and used as a GitHub Contents API path
 * segment, so it's restricted to a safe, corpus-consistent character set —
 * a raw filename could contain a comma (corrupts the batch, silently
 * dropping that painting) or other characters that don't belong in a path
 * segment. The uploaded filename is rebuilt from the sanitized id (not the
 * original name) so the file on disk and the id used to bake it always
 * match. */
function sanitizeIdAndFilename(name) {
  const i = name.lastIndexOf('.');
  const stem = i > 0 ? name.slice(0, i) : name;
  const ext = i > 0 ? name.slice(i) : '';
  const id = stem.replace(/[^A-Za-z0-9._~()-]/g, '_') || 'photo';
  return { id, filename: `${id}${ext}` };
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
    const uploaded = [];
    const remaining = [...files];
    let uploadError = null;

    // Sequential, not Promise.all: each successfully-uploaded file is a
    // real, non-rollback-able commit to main. On a failure partway
    // through, stop rather than continue committing more files under an
    // error the user hasn't seen yet — and only remove the files that
    // actually succeeded from the picker, so a retry doesn't re-attempt
    // putFile on a path that now exists without a sha (which the Contents
    // API rejects).
    while (remaining.length > 0) {
      const file = remaining[0];
      const { id, filename } = sanitizeIdAndFilename(file.name);
      try {
        const b64 = await fileToBase64(file);
        await putFile(`public/assets/${filename}`, b64, `admin: add painting ${id}`);
        uploaded.push(id);
        remaining.shift();
      } catch (e) {
        uploadError = e;
        break;
      }
    }
    setFiles(remaining);

    if (uploaded.length > 0) {
      setStatus('baking');
      try {
        await dispatchWorkflow('theater_bake.yml', { ids: uploaded.join(',') });
        setDispatchedIds(uploaded);
      } catch (e) {
        setStatus({ error: `Uploaded ${uploaded.join(', ')} but failed to dispatch the bake: ${e.message}. The photo(s) are on main — dispatch theater_bake.yml by hand with these ids, or retry once the underlying issue is fixed.` });
        return;
      }
    }

    if (uploadError) {
      setStatus({
        error: `${uploaded.length ? `Uploaded and dispatched ${uploaded.join(', ')}, but stopped` : 'Stopped'} after a failure: ${uploadError.message}. ${remaining.length} file(s) left in the picker — fix the issue and click upload again.`,
      });
    } else {
      setStatus('done');
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
        aria-label="select painting photos"
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
        <p className="admin-ok" role="status" aria-live="polite">
          Uploaded and dispatched: {dispatchedIds.join(', ')}.{' '}
          <a href={`https://github.com/HereLiesAz/hereliesaz.github.io/actions/workflows/theater_bake.yml`} target="_blank" rel="noreferrer noopener">
            watch the bake run
          </a>.
        </p>
      )}
      {status?.error && <p className="admin-error" role="alert">{status.error}</p>}
    </div>
  );
}
