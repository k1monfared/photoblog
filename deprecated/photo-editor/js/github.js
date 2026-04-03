// GitHub API client (Contents API + Git Trees API)

import { getToken, getRepo } from './auth.js';

const API = 'https://api.github.com';

function headers() {
  return {
    'Authorization': `Bearer ${getToken()}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
}

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, { headers: headers(), ...options });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`GitHub API ${res.status}: ${body.message || res.statusText}`);
  }
  return res.json();
}

// List files in a directory
export async function listFiles(path) {
  const repo = getRepo();
  return request(`/repos/${repo}/contents/${path}`);
}

// Get a single file's content (decodes base64)
export async function getFile(path) {
  const repo = getRepo();
  const data = await request(`/repos/${repo}/contents/${path}`);
  const content = atob(data.content.replace(/\n/g, ''));
  const bytes = Uint8Array.from(content, c => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes);
  return { content: text, sha: data.sha, path: data.path };
}

// Get a file's blob SHA (for tree operations)
export async function getFileSha(path) {
  try {
    const repo = getRepo();
    const data = await request(`/repos/${repo}/contents/${path}`);
    return data.sha;
  } catch {
    return null;
  }
}

// Create a single atomic commit with multiple files
// files: [{ path, content, encoding: 'utf-8' | 'base64' }]
// To delete a file, include { path, sha: null }
export async function createCommit(files, message) {
  const repo = getRepo();

  // 1. Get current commit SHA for main
  const ref = await request(`/repos/${repo}/git/refs/heads/main`);
  const baseSha = ref.object.sha;

  // 2. Get base tree
  const baseCommit = await request(`/repos/${repo}/git/commits/${baseSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  // 3. Create blobs and build tree items
  const treeItems = [];
  for (const file of files) {
    if (file.sha === null) {
      // Delete this file
      treeItems.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: null,
      });
    } else if (file.blobSha) {
      // Reference an existing blob (for copying files without re-uploading)
      treeItems.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: file.blobSha,
      });
    } else {
      // Create new blob
      const blobData = await request(`/repos/${repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({
          content: file.content,
          encoding: file.encoding || 'utf-8',
        }),
      });
      treeItems.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      });
    }
  }

  // 4. Create tree
  const tree = await request(`/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });

  // 5. Create commit
  const commit = await request(`/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: [baseSha],
    }),
  });

  // 6. Update ref
  await request(`/repos/${repo}/git/refs/heads/main`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });

  return commit;
}
