// Token management and GitHub repo validation

const REPO = 'k1monfared/photoblog';
const STORAGE_KEY = 'gh_token';

export function getToken() {
  return localStorage.getItem(STORAGE_KEY);
}

export function setToken(token) {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isAuthenticated() {
  return !!getToken();
}

export function getRepo() {
  return REPO;
}

export async function validateToken(token) {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    if (!res.ok) {
      return { valid: false, error: `HTTP ${res.status}: check token and repo access` };
    }
    const data = await res.json();
    if (!data.permissions || !data.permissions.push) {
      return { valid: false, error: 'Token needs Contents: read/write permission' };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}
