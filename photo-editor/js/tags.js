// Tag extraction from cached post data

import { fetchPostList, fetchPost } from './posts.js';
import { getCache, setCache } from './storage.js';

// Get all unique tags with counts (from cached metadata)
export async function getAllTags() {
  const cached = await getCache('all_tags', 10 * 60 * 1000);
  if (cached) return cached;

  const summaries = await fetchPostList();
  const counts = {};

  // Fetch a sample of posts to collect tags (not all 660+ for speed)
  // We'll fetch up to 50 recent posts for tag discovery
  const toFetch = summaries.slice(0, 50);
  for (const s of toFetch) {
    try {
      const post = await fetchPost(s.slug);
      if (!post.deleted) {
        for (const tag of (post.tags || [])) {
          counts[tag] = (counts[tag] || 0) + 1;
        }
      }
    } catch {
      // skip failures
    }
  }

  const result = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  await setCache('all_tags', result);
  return result;
}
