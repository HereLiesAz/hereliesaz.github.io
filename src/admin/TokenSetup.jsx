import { useState } from 'react';
import { getToken, setToken, verifyToken } from './github.js';

/** One-time (or rotate-anytime) screen for the GitHub token this whole
 * app runs on. See docs/ARCHITECTURE.md's admin-app section for why this
 * is a client-only fine-grained PAT rather than a backend secret. */
export default function TokenSetup({ onVerified }) {
  const [value, setValue] = useState(getToken());
  const [status, setStatus] = useState(null); // null | 'checking' | 'ok' | { error }

  const save = async () => {
    setStatus('checking');
    setToken(value.trim());
    try {
      const info = await verifyToken();
      const canWrite = !!info.permissions?.push;
      if (!canWrite) {
        setStatus({ error: `Token works but has no write access to this repo (logged in as ${info.login}). Check the token's repository permissions.` });
      } else if (!info.actionsOk) {
        setStatus({ error: `Token has Contents write access but no Actions permission (logged in as ${info.login}) — adding or removing a painting dispatches a workflow, which needs Actions: Read and write too. Edit the token's permissions on GitHub and try again.` });
      } else {
        setStatus('ok');
        onVerified?.();
      }
    } catch (e) {
      setStatus({ error: e.message });
    }
  };

  const clear = () => {
    setToken('');
    setValue('');
    setStatus(null);
  };

  return (
    <div className="admin-panel">
      <h2>GitHub access</h2>
      <p>
        Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer noopener">
        fine-grained personal access token</a> scoped to just the <code>HereLiesAz/hereliesaz.github.io</code> repository,
        with <strong>Contents: Read and write</strong> and <strong>Actions: Read and write</strong> permissions. Nothing
        else needs access. The token is stored only in this browser (localStorage) — it never leaves your device except
        to talk directly to api.github.com.
      </p>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="github_pat_…"
        aria-label="GitHub personal access token"
        value={value}
        onChange={e => setValue(e.target.value)}
        className="admin-input"
      />
      <div className="admin-row">
        <button type="button" onClick={save} disabled={!value.trim() || status === 'checking'}>
          {status === 'checking' ? 'checking…' : 'save & verify'}
        </button>
        {getToken() && <button type="button" onClick={clear} className="admin-btn-danger">clear token</button>}
      </div>
      {status === 'ok' && <p className="admin-ok" role="status" aria-live="polite">Verified — write access confirmed.</p>}
      {status?.error && <p className="admin-error" role="alert">{status.error}</p>}
    </div>
  );
}
