// Thin GitHub REST API client for the /admin app. Every mutation (add/
// remove a painting, edit metadata/site content, trigger a bake or a
// removal) goes straight from this browser to api.github.com, using a
// token the user pastes once into TokenSetup.jsx — there is no backend.
// See docs/ARCHITECTURE.md and the plan this was built from for why.

const OWNER = 'HereLiesAz';
const REPO = 'hereliesaz.github.io';
const BRANCH = 'main';
const TOKEN_KEY = 'admin.githubToken';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable (private mode) — token just won't persist */ }
}
export function hasToken() {
  return getToken().length > 0;
}

class GitHubApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

async function api(path, options = {}) {
  const token = getToken();
  if (!token) throw new GitHubApiError('No GitHub token set — open Settings first.', 401);
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.message || ''; } catch { /* non-JSON error body */ }
    throw new GitHubApiError(
      `GitHub API ${options.method || 'GET'} ${path} failed: ${res.status}${detail ? ` — ${detail}` : ''}`,
      res.status,
    );
  }
  if (res.status === 204) return null;
  return res.json();
}

// UTF-8/binary-safe base64 encode — btoa() alone chokes on multi-byte
// characters and on raw image bytes read via a plain FileReader text
// path, so route everything through the byte-accurate encoder instead.
function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000; // avoid a call-stack blowup from String.fromCharCode(...hugeArray)
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(toBase64(new Uint8Array(reader.result)));
    reader.readAsArrayBuffer(file);
  });
}

export function textToBase64(text) {
  return toBase64(new TextEncoder().encode(text));
}

/** Fetch a repo file's content (decoded to a UTF-8 string) and its sha
 * (needed to update/delete it). Returns null if it doesn't exist yet —
 * every caller treats "no file yet" as a normal, expected case. */
export async function getFile(path) {
  try {
    const data = await api(`/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${BRANCH}`);
    const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
    return { content, sha: data.sha };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/** Create or update a file. `contentBase64` is already-encoded (image
 * bytes via fileToBase64, or text via textToBase64) — this function never
 * assumes an encoding so it works for both source photos and JSON. Pass
 * `sha` when overwriting an existing file (GitHub requires it to avoid
 * silently clobbering a concurrent edit); omit it to create a new one. */
export function putFile(path, contentBase64, message, sha) {
  return api(`/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: contentBase64, branch: BRANCH, ...(sha ? { sha } : {}) }),
  });
}

/** Delete a file. Requires its current sha (fetch via getFile first). */
export function deleteFile(path, message, sha) {
  return api(`/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch: BRANCH }),
  });
}

/** Trigger a workflow_dispatch. `workflowFile` is the filename under
 * .github/workflows/ (e.g. "theater_bake.yml"). `inputs` mirrors that
 * workflow's declared `on.workflow_dispatch.inputs`. */
export function dispatchWorkflow(workflowFile, inputs = {}) {
  return api(`/repos/${OWNER}/${REPO}/actions/workflows/${workflowFile}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: BRANCH, inputs }),
  });
}

/** List recent runs of a workflow, newest first — used to show "bake
 * dispatched, here's its status" instead of leaving the user guessing. */
export async function listWorkflowRuns(workflowFile, perPage = 5) {
  const data = await api(`/repos/${OWNER}/${REPO}/actions/workflows/${workflowFile}/runs?per_page=${perPage}`);
  return data.workflow_runs || [];
}

/** Verifies the stored token actually works and can see this repo,
 * without requiring any specific scope up front — TokenSetup uses this
 * to give immediate, concrete feedback instead of a silent save. */
export async function verifyToken() {
  const data = await api(`/repos/${OWNER}/${REPO}`);
  return { login: data.owner?.login, permissions: data.permissions };
}

export { OWNER, REPO, BRANCH, GitHubApiError };
