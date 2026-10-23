import { useState } from 'react';
import { dispatchWorkflow, fileToBase64, getFile, putFile } from './github.js';
import { deploySite, listBakedPaintings } from './data.js';

/** Starts deploy.yml and reports the outcome. Bakes land on the art-data branch,
 * which does not trigger a deploy on its own. */
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

/** Returns a {id, filename} that collides with neither an already-baked
 * painting, an existing source file on main, nor another file earlier in
 * this same batch. Sanitizing can map distinct names onto one id
 * ("a b.jpg" and "a_b.jpg"), and re-uploading a photo whose name matches an
 * existing painting would otherwise hit putFile without a sha (rejected) or,
 * worse, re-bake over an unrelated painting's id. Disambiguates with a
 * numeric suffix: id-2, id-3, … */
async function uniqueIdAndFilename(name, taken) {
  const { id: baseId, filename: baseName } = sanitizeIdAndFilename(name);
  const ext = baseName.slice(baseId.length);
  for (let n = 1; ; n++) {
    const id = n === 1 ? baseId : `${baseId}-${n}`;
    const filename = `${id}${ext}`;
    if (taken.has(id)) continue;
    if (await getFile(`public/assets/${filename}`)) continue;
    return { id, filename };
  }
}

/** Uploads raw photo(s) to public/assets/ and dispatches theater_bake.yml
 * for exactly the new id(s) — the existing pipeline (crop → photorealize
 * → depth → hinge graph → validate → publish) does the rest, unchanged
 * from how a developer would trigger it by hand. See
 * .github/workflows/theater_bake.yml. */
export default function AddPainting() {
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState(null); // null | 'uploading' | 'baking' | { done, renamed } | { error }
  const [dispatchedIds, setDispatchedIds] = useState([]);

  const run = async () => {
    if (files.length === 0) return;
    setStatus('uploading');
    const uploaded = [];
    const remaining = [...files];
    let uploadError = null;
    let taken;
    try {
      taken = new Set(await listBakedPaintings());
    } catch (e) {
      setStatus({ error: `Could not load the existing painting list to check for id collisions: ${e.message}` });
      return;
    }
    const renamed = [];

    // Sequential, not Promise.all: each successfully-uploaded file is a
    // real, non-rollback-able commit to main. On a failure partway
    // through, stop rather than continue committing more files under an
    // error the user hasn't seen yet — and only remove the files that
    // actually succeeded from the picker, so a retry doesn't re-attempt
    // putFile on a path that now exists without a sha (which the Contents
    // API rejects).
    while (remaining.length > 0) {
      const file = remaining[0];
      try {
        const { id, filename } = await uniqueIdAndFilename(file.name, taken);
        if (id !== sanitizeIdAndFilename(file.name).id) renamed.push(`${file.name} → ${id}`);
        taken.add(id);
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
      setStatus({ done: true, renamed });
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
      {status?.done && (
        <p className="admin-ok" role="status" aria-live="polite">
          Uploaded and dispatched: {dispatchedIds.join(', ')}.{' '}
          {status.renamed.length > 0 && <>Renamed to avoid an id collision: {status.renamed.join('; ')}.{' '}</>}
          The bake runs in{' '}
          <a href="https://github.com/HereLiesAz/workflows/actions" target="_blank" rel="noreferrer noopener">
            HereLiesAz/workflows
          </a>{' '}
          (the run in this repository only hands off). When it finishes, publish it:{' '}
          <DeployNow />.
        </p>
      )}
      {status?.error && <p className="admin-error" role="alert">{status.error}</p>}
    </div>
  );
}
