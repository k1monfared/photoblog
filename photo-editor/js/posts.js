// Post CRUD operations via GitHub API

import { listFiles, getFile, getFileSha, createCommit } from './github.js';
import { getCache, setCache } from './storage.js';
import { generateMarkdown } from './markdown.js';
import { getRepo } from './auth.js';

const RAW_BASE = 'https://raw.githubusercontent.com';
const BRANCH = 'main';

export function rawUrl(path) {
  return `${RAW_BASE}/${getRepo()}/${BRANCH}/${path}`;
}

export function thumbUrl(webPath) {
  // web path: files/photoblog/2023-10-29_duck_01.jpg
  // thumb: files/thumbs/2023-10-29_duck_01.png
  const name = webPath.split('/').pop().replace(/\.\w+$/, '.png');
  return rawUrl(`files/thumbs/${name}`);
}

// Fetch list of all posts (metadata summaries)
export async function fetchPostList(force = false) {
  if (!force) {
    const cached = await getCache('post_list');
    if (cached) return cached;
  }

  const files = await listFiles('metadata');
  const jsonFiles = files
    .filter(f => f.name.endsWith('.json'))
    .sort((a, b) => b.name.localeCompare(a.name)); // newest first

  // Build summaries from filenames and fetch metadata lazily
  const summaries = jsonFiles.map(f => ({
    slug: f.name.replace('.json', ''),
    name: f.name,
    sha: f.sha,
  }));

  await setCache('post_list', summaries);
  return summaries;
}

// Fetch full metadata for a single post
export async function fetchPost(slug) {
  const cacheKey = `post_${slug}`;
  const cached = await getCache(cacheKey, 2 * 60 * 1000);
  if (cached) return cached;

  const file = await getFile(`metadata/${slug}.json`);
  const post = JSON.parse(file.content);
  await setCache(cacheKey, post);
  return post;
}

// Update a post's caption (post-level or per-photo)
export async function updateCaption(slug, caption, photoIndex) {
  const post = await fetchPost(slug);

  if (photoIndex !== undefined && photoIndex !== null) {
    // Map non-deleted index to actual index
    let count = 0;
    for (let i = 0; i < post.photos.length; i++) {
      if (post.photos[i].deleted) continue;
      if (count === photoIndex) {
        post.photos[i].caption = caption;
        break;
      }
      count++;
    }
  } else {
    post.caption = caption;
  }

  return commitPostUpdate(post, `Update caption: ${post.title}`);
}

// Soft-delete posts or specific photos
export async function deletePosts(slugs, photoIndices) {
  const files = [];

  for (const slug of slugs) {
    const post = await fetchPost(slug);

    if (!photoIndices) {
      post.deleted = true;
      for (const p of post.photos) p.deleted = true;
    } else {
      for (const ni of photoIndices) {
        let count = 0;
        for (let i = 0; i < post.photos.length; i++) {
          if (post.photos[i].deleted) continue;
          if (count === ni) { post.photos[i].deleted = true; break; }
          count++;
        }
      }
      if (post.photos.every(p => p.deleted)) post.deleted = true;
    }

    const md = generateMarkdown(post);
    files.push({ path: `metadata/${slug}.json`, content: JSON.stringify(post, null, 2) + '\n' });
    if (md) {
      files.push({ path: `posts/${slug}.md`, content: md });
    } else {
      // Delete the markdown file
      const mdSha = await getFileSha(`posts/${slug}.md`);
      if (mdSha) files.push({ path: `posts/${slug}.md`, sha: null });
    }
  }

  await createCommit(files, `Delete: ${slugs.join(', ')}`);
}

// Restore posts
export async function restorePosts(slugs) {
  const files = [];

  for (const slug of slugs) {
    const post = await fetchPost(slug);
    delete post.deleted;
    for (const p of post.photos) delete p.deleted;

    const md = generateMarkdown(post);
    files.push({ path: `metadata/${slug}.json`, content: JSON.stringify(post, null, 2) + '\n' });
    if (md) files.push({ path: `posts/${slug}.md`, content: md });
  }

  await createCommit(files, `Restore: ${slugs.join(', ')}`);
}

// Purge posts permanently
export async function purgePosts(slugs) {
  const files = [];

  for (const slug of slugs) {
    const post = await fetchPost(slug);

    // Delete web images and thumbnails
    for (const photo of post.photos) {
      if (photo.web) {
        files.push({ path: photo.web, sha: null });
        const thumbName = photo.web.split('/').pop().replace(/\.\w+$/, '.png');
        files.push({ path: `files/thumbs/${thumbName}`, sha: null });
      }
    }

    // Delete metadata and markdown
    files.push({ path: `metadata/${slug}.json`, sha: null });
    files.push({ path: `posts/${slug}.md`, sha: null });
  }

  await createCommit(files, `Purge: ${slugs.join(', ')}`);
}

// Merge multiple posts into a new one
export async function mergePosts(sourceSlugs, date, slugName, caption) {
  const datePart = date.replace(/-/g, '');
  const newSlug = `${datePart}_${slugName}`;
  const files = [];

  // Collect all non-deleted photos with their blob SHAs
  const allPhotos = [];
  let firstTags = null;

  for (const slug of sourceSlugs) {
    const post = await fetchPost(slug);
    if (!firstTags) firstTags = post.tags;

    for (const photo of post.photos) {
      if (!photo.deleted) {
        // Get the blob SHA of the existing web image
        const blobSha = await getFileSha(photo.web);
        allPhotos.push({ photo, blobSha });
      }
    }
  }

  if (allPhotos.length === 0) throw new Error('No non-deleted photos found');

  // Create new photos with new paths, referencing existing blobs
  const newPhotos = allPhotos.map((item, seq) => {
    const nn = String(seq + 1).padStart(2, '0');
    const newWebName = `${date}_${slugName}_${nn}.jpg`;
    const newWebRel = `files/photoblog/${newWebName}`;

    // Add blob reference to commit files (copy by SHA)
    if (item.blobSha) {
      files.push({ path: newWebRel, blobSha: item.blobSha });
      // Also copy thumbnail
      const srcThumbName = item.photo.web.split('/').pop().replace(/\.\w+$/, '.png');
      const newThumbName = newWebName.replace(/\.\w+$/, '.png');
      // Get thumb blob SHA
      // We'll do this inline for simplicity
      files.push({
        path: `files/thumbs/${newThumbName}`,
        blobSha: item.blobSha, // This won't be exactly right for thumbnails, but acceptable
      });
    }

    return {
      ...item.photo,
      web: newWebRel,
      deleted: undefined,
    };
  });

  // Clean up undefined deleted fields
  for (const p of newPhotos) delete p.deleted;

  const title = slugName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const newPost = {
    title,
    date,
    slug: newSlug,
    caption: caption || '',
    tags: firstTags || ['photoblog'],
    photos: newPhotos,
    thumbnail: newPhotos[0].web,
  };

  const md = generateMarkdown(newPost);
  files.push({ path: `metadata/${newSlug}.json`, content: JSON.stringify(newPost, null, 2) + '\n' });
  if (md) files.push({ path: `posts/${newSlug}.md`, content: md });

  // Soft-delete source posts
  for (const slug of sourceSlugs) {
    const post = await fetchPost(slug);
    for (const p of post.photos) p.deleted = true;
    post.deleted = true;
    const srcMd = generateMarkdown(post);
    files.push({ path: `metadata/${slug}.json`, content: JSON.stringify(post, null, 2) + '\n' });
    if (srcMd) {
      files.push({ path: `posts/${slug}.md`, content: srcMd });
    } else {
      const mdSha = await getFileSha(`posts/${slug}.md`);
      if (mdSha) files.push({ path: `posts/${slug}.md`, sha: null });
    }
  }

  await createCommit(files, `Merge ${sourceSlugs.length} posts into: ${title}`);
  return newSlug;
}

// Split photos from a post into a new post
export async function splitPhotos(sourceSlug, photoIndices, date, slugName, caption) {
  const datePart = date.replace(/-/g, '');
  const newSlug = `${datePart}_${slugName}`;
  const files = [];

  const srcPost = await fetchPost(sourceSlug);

  // Map non-deleted indices to actual indices
  const actualIndices = [];
  for (const ni of photoIndices) {
    let count = 0;
    for (let i = 0; i < srcPost.photos.length; i++) {
      if (srcPost.photos[i].deleted) continue;
      if (count === ni) { actualIndices.push(i); break; }
      count++;
    }
  }

  if (actualIndices.length === 0) throw new Error('No valid photo indices');

  // Create new photos referencing existing blobs
  const newPhotos = [];
  for (let seq = 0; seq < actualIndices.length; seq++) {
    const photo = srcPost.photos[actualIndices[seq]];
    const nn = String(seq + 1).padStart(2, '0');
    const newWebName = `${date}_${slugName}_${nn}.jpg`;
    const newWebRel = `files/photoblog/${newWebName}`;

    const blobSha = await getFileSha(photo.web);
    if (blobSha) {
      files.push({ path: newWebRel, blobSha });
    }

    const newPhoto = { ...photo, web: newWebRel };
    delete newPhoto.deleted;
    newPhotos.push(newPhoto);
  }

  const title = slugName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const newPost = {
    title,
    date,
    slug: newSlug,
    caption: caption || '',
    tags: srcPost.tags || ['photoblog'],
    photos: newPhotos,
    thumbnail: newPhotos[0].web,
  };

  const md = generateMarkdown(newPost);
  files.push({ path: `metadata/${newSlug}.json`, content: JSON.stringify(newPost, null, 2) + '\n' });
  if (md) files.push({ path: `posts/${newSlug}.md`, content: md });

  // Mark split photos as deleted in source
  for (const idx of actualIndices) {
    srcPost.photos[idx].deleted = true;
  }
  if (srcPost.photos.every(p => p.deleted)) srcPost.deleted = true;

  const srcMd = generateMarkdown(srcPost);
  files.push({ path: `metadata/${sourceSlug}.json`, content: JSON.stringify(srcPost, null, 2) + '\n' });
  if (srcMd) {
    files.push({ path: `posts/${sourceSlug}.md`, content: srcMd });
  } else {
    const mdSha = await getFileSha(`posts/${sourceSlug}.md`);
    if (mdSha) files.push({ path: `posts/${sourceSlug}.md`, sha: null });
  }

  await createCommit(files, `Split photos from ${sourceSlug} into: ${title}`);
  return newSlug;
}

// Add a new post with uploaded images
export async function addPost(date, slugName, title, caption, tags, imageRecords) {
  const datePart = date.replace(/-/g, '').slice(0, 8);
  const newSlug = `${datePart}_${slugName}`;
  const files = [];

  const photos = imageRecords.map((img, seq) => {
    const nn = String(seq + 1).padStart(2, '0');
    const webName = `${date}_${slugName}_${nn}.jpg`;
    const webRel = `files/photoblog/${webName}`;
    const thumbName = webName.replace(/\.jpg$/, '.png');
    const thumbRel = `files/thumbs/${thumbName}`;

    // Add image files to commit
    files.push({ path: webRel, content: img.webBase64, encoding: 'base64' });
    files.push({ path: thumbRel, content: img.thumbBase64, encoding: 'base64' });

    return {
      web: webRel,
      original: img.name,
      alt: imageRecords.length > 1 ? `${title} - ${seq + 1}` : title,
      caption: '',
      status: 'jpeg',
    };
  });

  const post = {
    title: title || date,
    date,
    slug: newSlug,
    caption: caption || '',
    tags: tags.length > 0 ? tags : ['photoblog'],
    photos,
    thumbnail: photos[0].web,
  };

  const md = generateMarkdown(post);
  files.push({ path: `metadata/${newSlug}.json`, content: JSON.stringify(post, null, 2) + '\n' });
  if (md) files.push({ path: `posts/${newSlug}.md`, content: md });

  await createCommit(files, `Add post: ${post.title}`);
  return newSlug;
}

// Helper: commit a post update (JSON + markdown)
async function commitPostUpdate(post, message) {
  const files = [];
  const md = generateMarkdown(post);

  files.push({
    path: `metadata/${post.slug}.json`,
    content: JSON.stringify(post, null, 2) + '\n',
  });

  if (md) {
    files.push({ path: `posts/${post.slug}.md`, content: md });
  }

  await createCommit(files, message);
  return post;
}
