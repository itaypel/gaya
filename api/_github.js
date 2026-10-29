// The admin panel writes straight into this repo through GitHub's contents
// API: each save is a commit on main, which Vercel's git integration deploys.
// GITHUB_TOKEN is a fine-grained token scoped to this repo with
// "Contents: read and write".
const OWNER = 'itaypel';
const REPO = 'gaya';
const BRANCH = 'main';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/`;

class GitHubConflictError extends Error {}

function headers() {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not configured');
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'gaya-admin',
  };
}

// Returns { sha, content (Buffer) } or null when the file doesn't exist.
async function getFile(path) {
  const res = await fetch(API + path + '?ref=' + BRANCH, { headers: headers(), cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
  const data = await res.json();
  let content = data.content ? Buffer.from(data.content, 'base64') : null;
  if (content === null) {
    // Files over 1 MB come back without inline content.
    const raw = await fetch(API + path + '?ref=' + BRANCH, { headers: Object.assign(headers(), { Accept: 'application/vnd.github.raw' }), cache: 'no-store' });
    if (!raw.ok) throw new Error(`GitHub read failed (${raw.status})`);
    content = Buffer.from(await raw.arrayBuffer());
  }
  return { sha: data.sha, content };
}

// sha must be the current blob sha when replacing a file (omit to create);
// GitHub rejects a stale one, which surfaces as GitHubConflictError.
async function putFile(path, content, message, sha) {
  const body = { message, content: Buffer.from(content).toString('base64'), branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(API + path, { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
  if (res.status === 409 || (res.status === 422 && sha)) throw new GitHubConflictError('conflict');
  if (!res.ok) throw new Error(`GitHub write failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

module.exports = { getFile, putFile, GitHubConflictError };
