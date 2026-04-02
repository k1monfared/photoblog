// Main app controller and screen router

import { isAuthenticated, getToken, setToken, clearToken, validateToken } from './auth.js';
import { fetchPostList, fetchPost, fetchPostRaw, updateCaption, deletePosts, restorePosts, purgePosts, mergePosts, splitPhotos, addPost, rawUrl, thumbUrl } from './posts.js';
import { pickImages, storeImage, getStoredImages, removeStoredImage, createThumbnailUrl } from './images.js';
import { getAllTags } from './tags.js';
import { clearSessionImages } from './storage.js';

const app = document.getElementById('app');
let selectedSlugs = [];
let selectedPhotos = [];
let currentPostCache = {}; // slug -> post data
let showingDeleted = false;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function parseDateFromSlug(slug) {
  const m = slug.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

// --- Setup Screen ---

function showSetup() {
  app.innerHTML = `
    <div class="screen setup-screen">
      <h1>Photo Editor</h1>
      <p>Connect to your photoblog repo on GitHub.</p>
      <ol>
        <li>Go to <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub Token Settings</a></li>
        <li>Select repository: <strong>k1monfared/photoblog</strong></li>
        <li>Set <strong>Contents: Read and write</strong></li>
        <li>Paste the token below</li>
      </ol>
      <div class="form-group">
        <input type="password" id="token-input" placeholder="github_pat_..." autocomplete="off">
        <button id="connect-btn" class="btn primary">Connect</button>
      </div>
      <div id="setup-error" class="error" hidden></div>
    </div>
  `;

  const input = app.querySelector('#token-input');
  const btn = app.querySelector('#connect-btn');
  const error = app.querySelector('#setup-error');

  btn.addEventListener('click', async () => {
    const token = input.value.trim();
    if (!token) { error.textContent = 'Please enter a token'; error.hidden = false; return; }
    btn.disabled = true;
    btn.textContent = 'Validating...';
    const result = await validateToken(token);
    if (result.valid) {
      setToken(token);
      showGrid();
    } else {
      error.textContent = result.error;
      error.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Connect';
    }
  });

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
}

// --- Grid Screen ---

async function showGrid() {
  selectedSlugs = [];
  app.innerHTML = `
    <div class="screen grid-screen">
      <header class="app-header">
        <h1>Photoblog</h1>
        <div class="header-actions">
          <button id="add-btn" class="nav-add-btn" title="Add post">+</button>
          <button id="show-deleted-btn" class="btn small">${showingDeleted ? 'Hide deleted' : 'Show deleted'}</button>
          <button id="refresh-btn" class="btn icon" title="Refresh"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></button>
          <button id="trash-btn" class="btn icon" title="Trash"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
          <button id="settings-btn" class="btn icon" title="Settings"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></button>
        </div>
      </header>
      <div id="tag-filter" class="tag-filter"></div>
      <div id="grid" class="photo-grid">
        <div class="loading">Loading posts...</div>
      </div>
    </div>
  `;

  app.querySelector('#add-btn').addEventListener('click', showAddPost);
  app.querySelector('#refresh-btn').addEventListener('click', () => loadGrid(true));
  app.querySelector('#trash-btn').addEventListener('click', showTrash);
  app.querySelector('#settings-btn').addEventListener('click', showSettings);
  app.querySelector('#show-deleted-btn').addEventListener('click', () => {
    showingDeleted = !showingDeleted;
    const btn = app.querySelector('#show-deleted-btn');
    if (btn) btn.textContent = showingDeleted ? 'Hide deleted' : 'Show deleted';
    // Toggle visibility of deleted items
    document.querySelectorAll('.grid-item.deleted').forEach(el => {
      el.style.display = showingDeleted ? '' : 'none';
    });
  });

  await loadGrid();
}

async function loadGrid(force = false) {
  const gridEl = app.querySelector('#grid');
  if (!gridEl) return;

  try {
    const summaries = await fetchPostList(force);
    if (!gridEl.isConnected) return;

    // Render grid with placeholders
    gridEl.innerHTML = summaries.map(s => {
      const namePart = s.slug.replace(/^\d{8}_/, '');
      return `
        <div class="grid-item" data-slug="${escapeHtml(s.slug)}">
          <img src="" alt="${escapeHtml(s.slug)}" loading="lazy"
               onerror="this.style.display='none'" style="display:none">
          <div class="check"></div>
          <div class="title-overlay">${escapeHtml(namePart.replace(/_/g, ' '))}</div>
        </div>
      `;
    }).join('');

    // Attach click handlers IMMEDIATELY (before thumbnail loading)
    attachGridHandlers(gridEl);

    // Lazy-load thumbnails in background batches
    loadThumbnails(gridEl, summaries);

    // Off-screen image memory management (matches viewer pagination.js)
    setupMemoryObserver(gridEl);
  } catch (err) {
    if (gridEl.isConnected) {
      gridEl.innerHTML = `<div class="error">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function attachGridHandlers(gridEl) {
  gridEl.querySelectorAll('.grid-item').forEach(el => {
    let longPressTimer = null;
    let longPressTriggered = false;

    // Checkbox click (separate from item click)
    const check = el.querySelector('.check');
    if (check) {
      check.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!el.classList.contains('deleted')) {
          toggleSelection(el, el.dataset.slug);
        }
      });
    }

    // Item click: open modal preview (unless in selection mode)
    el.addEventListener('click', (e) => {
      if (longPressTriggered) { longPressTriggered = false; return; }
      const slug = el.dataset.slug;
      if (selectedSlugs.length > 0) {
        if (!el.classList.contains('deleted')) toggleSelection(el, slug);
      } else {
        // If post data is loaded (has data-images), open modal. Otherwise open detail.
        if (el.dataset.images) {
          openModal(el);
        } else {
          showPostDetail(slug);
        }
      }
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!el.classList.contains('deleted')) {
        toggleSelection(el, el.dataset.slug);
      }
    });

    // Long press for mobile
    el.addEventListener('touchstart', () => {
      longPressTriggered = false;
      longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        if (!el.classList.contains('deleted')) {
          toggleSelection(el, el.dataset.slug);
        }
      }, 500);
    }, { passive: true });

    el.addEventListener('touchend', () => clearTimeout(longPressTimer));
    el.addEventListener('touchmove', () => clearTimeout(longPressTimer));
  });
}

async function loadThumbnails(gridEl, summaries) {
  const BATCH = 30;
  for (let i = 0; i < summaries.length; i += BATCH) {
    if (!gridEl.isConnected) break;
    const batch = summaries.slice(i, i + BATCH);
    await Promise.all(batch.map(async (s) => {
      try {
        const post = await fetchPostRaw(s.slug);
        if (!post || !gridEl.isConnected) return;
        const el = gridEl.querySelector(`[data-slug="${s.slug}"]`);
        if (!el) return;

        if (post.deleted) {
          if (!showingDeleted) {
            el.style.display = 'none';
          } else {
            el.classList.add('deleted');
          }
        }

        const photos = (post.photos || []).filter(p => !p.deleted);
        if (photos.length === 0) return;

        // Use web image directly (thumbs are gitignored, not on GitHub)
        const firstWeb = photos[0].web;
        const url = rawUrl(firstWeb);
        const img = el.querySelector('img');
        if (img) { img.src = url; img.dataset.src = url; img.style.display = ''; }

        // Store post data for modal
        const imageUrls = photos.map(p => rawUrl(p.web));
        el.dataset.images = JSON.stringify(imageUrls);
        el.dataset.captions = JSON.stringify(photos.map(p => p.caption || ''));
        el.dataset.postCaption = post.caption || '';
        el.dataset.title = post.title || '';
        el.dataset.date = post.date || '';
        el.dataset.excerpt = post.caption || '';
        el.dataset.tags = (post.tags || []).join(', ');

        // Multi-image indicator
        if (photos.length > 1) {
          const icon = document.createElement('span');
          icon.className = 'grid-multi-icon';
          icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
          el.appendChild(icon);
        }

        // Update title overlay
        const titleEl = el.querySelector('.title-overlay');
        if (titleEl) titleEl.textContent = post.title || '';
      } catch { /* skip failures */ }
    }));
  }
}

function setupMemoryObserver(gridEl) {
  if (!('IntersectionObserver' in window)) return;

  // Wait briefly for thumbnails to start loading before observing
  setTimeout(() => {
    const images = gridEl.querySelectorAll('.grid-item img');
    images.forEach(img => {
      if (img.src) img.dataset.src = img.src;
    });

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const img = entry.target;
        if (entry.isIntersecting) {
          if (!img.getAttribute('src') && img.dataset.src) {
            img.src = img.dataset.src;
          }
        } else {
          if (img.getAttribute('src')) {
            img.removeAttribute('src');
          }
        }
      });
    }, { rootMargin: '500% 0px' });

    images.forEach(img => observer.observe(img));
  }, 2000);
}

function toggleSelection(el, slug) {
  const idx = selectedSlugs.indexOf(slug);
  if (idx >= 0) {
    selectedSlugs.splice(idx, 1);
    el.classList.remove('selected');
  } else {
    selectedSlugs.push(slug);
    el.classList.add('selected');
  }
  updateSelectionBar();
}

function updateSelectionBar() {
  let bar = document.querySelector('.selection-bar');
  if (selectedSlugs.length === 0) {
    if (bar) bar.remove();
    return;
  }

  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'selection-bar';
    document.body.appendChild(bar);
  }

  bar.innerHTML = `
    <span class="count">${selectedSlugs.length} selected</span>
    ${selectedSlugs.length >= 2 ? '<button class="btn primary" id="sel-merge">Merge</button>' : ''}
    <button class="btn danger" id="sel-delete">Delete</button>
    <button class="btn" id="sel-cancel">Cancel</button>
  `;

  const mergeBtn = bar.querySelector('#sel-merge');
  if (mergeBtn) mergeBtn.addEventListener('click', () => showMerge(selectedSlugs.slice()));

  bar.querySelector('#sel-delete').addEventListener('click', async () => {
    if (!confirm(`Delete ${selectedSlugs.length} post(s)?`)) return;
    try {
      await deletePosts(selectedSlugs);
      selectedSlugs = [];
      updateSelectionBar();
      loadGrid(true);
    } catch (err) { alert('Error: ' + err.message); }
  });

  bar.querySelector('#sel-cancel').addEventListener('click', () => {
    selectedSlugs = [];
    document.querySelectorAll('.grid-item.selected').forEach(e => e.classList.remove('selected'));
    updateSelectionBar();
  });
}

// --- Post Detail Screen ---

async function showPostDetail(slug) {
  app.innerHTML = `
    <div class="screen detail-screen">
      <header class="app-header">
        <button id="back-btn" class="btn icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg></button>
        <h2 id="post-title">Loading...</h2>
        <div class="header-actions">
          <button id="edit-caption-btn" class="btn icon" title="Edit post caption"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        </div>
      </header>
      <div id="post-content"><div class="loading">Loading...</div></div>
    </div>
  `;

  app.querySelector('#back-btn').addEventListener('click', showGrid);

  try {
    const post = await fetchPost(slug);
    currentPostCache[slug] = post;

    app.querySelector('#post-title').textContent = post.title;

    // Show restore button for deleted posts
    if (post.deleted) {
      const header = app.querySelector('.header-actions');
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'btn small primary';
      restoreBtn.textContent = 'Restore';
      restoreBtn.addEventListener('click', async () => {
        restoreBtn.disabled = true;
        restoreBtn.textContent = 'Restoring...';
        try {
          await restorePosts([slug]);
          showPostDetail(slug);
        } catch (err) { alert('Error: ' + err.message); restoreBtn.disabled = false; restoreBtn.textContent = 'Restore'; }
      });
      header.prepend(restoreBtn);
    }

    app.querySelector('#edit-caption-btn').addEventListener('click', () => {
      showCaptionDialog(slug, null, post.caption);
    });

    const photos = (post.photos || []).filter(p => !p.deleted);
    const content = app.querySelector('#post-content');
    selectedPhotos = [];

    // Date + tags (matches local post-meta)
    let html = `<div class="post-tags">
      <span class="tag-pill">${escapeHtml(post.date)}</span>
      ${post.tags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}
    </div>`;

    // Post caption
    if (post.caption) {
      html += `<div class="post-caption">${escapeHtml(post.caption)}</div>`;
    }

    // Photos
    html += photos.map((photo, i) => {
      const imgUrl = rawUrl(photo.web);
      const exif = photo.exif || {};
      const exifParts = [];
      if (exif.camera) exifParts.push(exif.camera);
      const settings = [exif.focal_length, exif.aperture, exif.shutter_speed, exif.iso ? `ISO ${exif.iso}` : null].filter(Boolean);
      if (settings.length) exifParts.push(settings.join(' | '));

      return `
        <div class="post-photo" data-index="${i}">
          <div class="check"></div>
          <img src="${imgUrl}" alt="${escapeHtml(photo.alt)}" loading="lazy">
        </div>
        <div class="caption-row">
          <span class="caption-text">${photo.caption ? escapeHtml(photo.caption) : '(no caption)'}</span>
          <button class="edit-btn" data-index="${i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        </div>
        ${exifParts.length ? `<div class="exif-info">${escapeHtml(exifParts.join(' | '))}</div>` : ''}
      `;
    }).join('');

    content.innerHTML = html;

    // Photo selection (tap the check circle)
    content.querySelectorAll('.post-photo .check').forEach(check => {
      check.addEventListener('click', (e) => {
        e.stopPropagation();
        const photoEl = check.closest('.post-photo');
        const idx = parseInt(photoEl.dataset.index);
        const pos = selectedPhotos.indexOf(idx);
        if (pos >= 0) {
          selectedPhotos.splice(pos, 1);
          photoEl.classList.remove('selected');
        } else {
          selectedPhotos.push(idx);
          photoEl.classList.add('selected');
        }
        updatePhotoSelectionBar(slug);
      });
    });

    // Caption edit buttons
    content.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        showCaptionDialog(slug, idx, photos[idx].caption);
      });
    });

  } catch (err) {
    app.querySelector('#post-content').innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

function updatePhotoSelectionBar(slug) {
  let bar = document.querySelector('.selection-bar');
  if (selectedPhotos.length === 0) {
    if (bar) bar.remove();
    return;
  }

  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'selection-bar';
    document.body.appendChild(bar);
  }

  bar.innerHTML = `
    <span class="count">${selectedPhotos.length} photo(s)</span>
    <button class="btn primary" id="sel-split">Split</button>
    <button class="btn danger" id="sel-delete-photos">Delete</button>
    <button class="btn" id="sel-cancel">Cancel</button>
  `;

  bar.querySelector('#sel-split').addEventListener('click', () => {
    showSplit(slug, selectedPhotos.slice());
  });

  bar.querySelector('#sel-delete-photos').addEventListener('click', async () => {
    if (!confirm(`Delete ${selectedPhotos.length} photo(s)?`)) return;
    try {
      await deletePosts([slug], selectedPhotos);
      selectedPhotos = [];
      updatePhotoSelectionBar(slug);
      showPostDetail(slug);
    } catch (err) { alert('Error: ' + err.message); }
  });

  bar.querySelector('#sel-cancel').addEventListener('click', () => {
    selectedPhotos = [];
    document.querySelectorAll('.post-photo.selected').forEach(e => e.classList.remove('selected'));
    updatePhotoSelectionBar(slug);
  });
}

// --- Caption Dialog ---

function showCaptionDialog(slug, photoIndex, currentCaption) {
  const label = photoIndex !== null && photoIndex !== undefined ? 'Photo caption' : 'Post caption';
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog">
      <h3>${label}</h3>
      <div class="form-group">
        <textarea id="caption-input" rows="4">${escapeHtml(currentCaption || '')}</textarea>
      </div>
      <div class="dialog-actions">
        <button class="btn" id="caption-cancel">Cancel</button>
        <button class="btn primary" id="caption-save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#caption-input').focus();

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#caption-cancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#caption-save').addEventListener('click', async () => {
    const btn = overlay.querySelector('#caption-save');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const text = overlay.querySelector('#caption-input').value;
      await updateCaption(slug, text, photoIndex);
      overlay.remove();
      showPostDetail(slug);
    } catch (err) {
      alert('Error: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  });
}

// --- Add Post Screen ---

async function showAddPost() {
  const sessionId = `add_${Date.now()}`;
  let attachedImages = [];
  const today = new Date().toISOString().slice(0, 10);

  app.innerHTML = `
    <div class="screen add-screen">
      <header class="app-header">
        <button id="back-btn" class="btn icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg></button>
        <h2>Add Post</h2>
      </header>
      <div class="form-group">
        <label>Photos</label>
        <button id="pick-btn" class="btn full-width">Pick from Camera / Gallery</button>
        <div id="image-previews" class="image-previews"></div>
      </div>
      <div class="form-group">
        <label>Date</label>
        <input type="text" id="field-date" value="${today}" placeholder="YYYY-MM-DD">
      </div>
      <div class="form-group">
        <label>Slug</label>
        <input type="text" id="field-slug" placeholder="my_photo">
      </div>
      <div class="form-group">
        <label>Title</label>
        <input type="text" id="field-title" value="${today}">
      </div>
      <div class="form-group">
        <label>Caption</label>
        <textarea id="field-caption" rows="3" placeholder="Optional"></textarea>
      </div>
      <div class="form-group">
        <label>Tags</label>
        <input type="text" id="field-tags" value="photoblog" placeholder="comma-separated">
      </div>
      <button id="submit-btn" class="btn primary full-width" disabled>Add Post</button>
    </div>
  `;

  app.querySelector('#back-btn').addEventListener('click', () => {
    clearSessionImages(sessionId);
    showGrid();
  });

  const previewsEl = app.querySelector('#image-previews');
  const submitBtn = app.querySelector('#submit-btn');

  function updatePreviews() {
    previewsEl.innerHTML = attachedImages.map((img, i) => `
      <div class="thumb">
        <img src="${createThumbnailUrl(img)}" alt="${escapeHtml(img.name)}">
        <button class="remove" data-index="${i}">&times;</button>
      </div>
    `).join('');

    previewsEl.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        removeStoredImage(attachedImages[idx].id);
        attachedImages.splice(idx, 1);
        updatePreviews();
      });
    });

    submitBtn.disabled = attachedImages.length === 0;
  }

  app.querySelector('#pick-btn').addEventListener('click', async () => {
    const images = await pickImages();
    for (const img of images) {
      const record = await storeImage(sessionId, img);
      attachedImages.push(record);
    }
    updatePreviews();
  });

  // Slug auto-sanitize
  app.querySelector('#field-slug').addEventListener('input', (e) => {
    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  });

  submitBtn.addEventListener('click', async () => {
    const date = app.querySelector('#field-date').value.trim();
    const slugName = app.querySelector('#field-slug').value.trim();
    const title = app.querySelector('#field-title').value.trim() || date;
    const caption = app.querySelector('#field-caption').value;
    const tags = app.querySelector('#field-tags').value.split(',').map(t => t.trim()).filter(Boolean);

    if (!date || !slugName) { alert('Date and slug are required'); return; }
    if (attachedImages.length === 0) { alert('Add at least one photo'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading...';

    try {
      const newSlug = await addPost(date, slugName, title, caption, tags, attachedImages);
      await clearSessionImages(sessionId);
      if (newSlug) {
        showPostDetail(newSlug);
      } else {
        alert('Post with this slug already exists');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Post';
      }
    } catch (err) {
      alert('Error: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add Post';
    }
  });
}

// --- Merge Screen ---

function showMerge(slugs) {
  const bar = document.querySelector('.selection-bar');
  if (bar) bar.remove();

  const earliest = slugs.map(parseDateFromSlug).filter(Boolean).sort()[0] || '';

  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog">
      <h3>Merge ${slugs.length} posts</h3>
      <div class="form-group">
        <label>Date</label>
        <input type="text" id="merge-date" value="${earliest}" placeholder="YYYY-MM-DD">
      </div>
      <div class="form-group">
        <label>Slug</label>
        <input type="text" id="merge-slug" placeholder="combined_photos">
      </div>
      <div class="form-group">
        <label>Caption</label>
        <textarea id="merge-caption" rows="3"></textarea>
      </div>
      <div class="dialog-actions">
        <button class="btn" id="merge-cancel">Cancel</button>
        <button class="btn primary" id="merge-confirm">Merge</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#merge-slug').addEventListener('input', (e) => {
    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  });

  overlay.querySelector('#merge-cancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#merge-confirm').addEventListener('click', async () => {
    const date = overlay.querySelector('#merge-date').value.trim();
    const slugName = overlay.querySelector('#merge-slug').value.trim();
    const caption = overlay.querySelector('#merge-caption').value;

    if (!date || !slugName) { alert('Date and slug are required'); return; }

    const btn = overlay.querySelector('#merge-confirm');
    btn.disabled = true;
    btn.textContent = 'Merging...';

    try {
      const newSlug = await mergePosts(slugs, date, slugName, caption);
      overlay.remove();
      selectedSlugs = [];
      showPostDetail(newSlug);
    } catch (err) {
      alert('Error: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Merge';
    }
  });
}

// --- Split Screen ---

function showSplit(sourceSlug, indices) {
  const bar = document.querySelector('.selection-bar');
  if (bar) bar.remove();

  const dateStr = parseDateFromSlug(sourceSlug);

  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog">
      <h3>Split ${indices.length} photo(s)</h3>
      <div class="form-group">
        <label>Date</label>
        <input type="text" id="split-date" value="${dateStr}" placeholder="YYYY-MM-DD">
      </div>
      <div class="form-group">
        <label>Slug</label>
        <input type="text" id="split-slug" placeholder="new_post">
      </div>
      <div class="form-group">
        <label>Caption</label>
        <textarea id="split-caption" rows="3"></textarea>
      </div>
      <div class="dialog-actions">
        <button class="btn" id="split-cancel">Cancel</button>
        <button class="btn primary" id="split-confirm">Split</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#split-slug').addEventListener('input', (e) => {
    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  });

  overlay.querySelector('#split-cancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#split-confirm').addEventListener('click', async () => {
    const date = overlay.querySelector('#split-date').value.trim();
    const slugName = overlay.querySelector('#split-slug').value.trim();
    const caption = overlay.querySelector('#split-caption').value;

    if (!date || !slugName) { alert('Date and slug are required'); return; }

    const btn = overlay.querySelector('#split-confirm');
    btn.disabled = true;
    btn.textContent = 'Splitting...';

    try {
      const newSlug = await splitPhotos(sourceSlug, indices, date, slugName, caption);
      overlay.remove();
      selectedPhotos = [];
      showPostDetail(newSlug);
    } catch (err) {
      alert('Error: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Split';
    }
  });
}

// --- Trash Screen ---

async function showTrash() {
  app.innerHTML = `
    <div class="screen trash-screen">
      <header class="app-header">
        <button id="back-btn" class="btn icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg></button>
        <h2>Trash</h2>
      </header>
      <div id="trash-list"><div class="loading">Loading...</div></div>
    </div>
  `;

  app.querySelector('#back-btn').addEventListener('click', showGrid);

  try {
    const allPosts = await fetchPostList();
    const trashEl = app.querySelector('#trash-list');
    const deletedSlugs = [];

    // We need to check each post for deleted flag
    // For efficiency, fetch recent ones first
    for (const s of allPosts.slice(0, 100)) {
      try {
        const post = await fetchPost(s.slug);
        if (post.deleted) deletedSlugs.push({ slug: s.slug, post });
      } catch { /* skip */ }
    }

    if (deletedSlugs.length === 0) {
      trashEl.innerHTML = '<div class="empty">Trash is empty</div>';
      return;
    }

    trashEl.innerHTML = deletedSlugs.map(({ slug, post }) => {
      const thumbPath = post.thumbnail || (post.photos[0] && post.photos[0].web) || '';
      const tUrl = thumbPath ? rawUrl(thumbPath) : '';
      return `
        <div class="trash-item" data-slug="${escapeHtml(slug)}">
          ${tUrl ? `<img src="${tUrl}" alt="" onerror="this.style.display='none'">` : ''}
          <div class="info">
            <div class="title">${escapeHtml(post.title)}</div>
            <div class="date">${escapeHtml(post.date)} | ${post.photos.length} photos</div>
          </div>
          <div class="actions">
            <button class="btn small restore-btn">Restore</button>
            <button class="btn small danger purge-btn">Purge</button>
          </div>
        </div>
      `;
    }).join('');

    trashEl.querySelectorAll('.restore-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const item = btn.closest('.trash-item');
        const slug = item.dataset.slug;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await restorePosts([slug]);
          item.remove();
        } catch (err) { alert('Error: ' + err.message); btn.disabled = false; btn.textContent = 'Restore'; }
      });
    });

    trashEl.querySelectorAll('.purge-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const item = btn.closest('.trash-item');
        const slug = item.dataset.slug;
        if (!confirm(`Permanently delete "${slug}"? This cannot be undone.`)) return;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await purgePosts([slug]);
          item.remove();
        } catch (err) { alert('Error: ' + err.message); btn.disabled = false; btn.textContent = 'Purge'; }
      });
    });

  } catch (err) {
    app.querySelector('#trash-list').innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

// --- Settings Screen ---

function showSettings() {
  app.innerHTML = `
    <div class="screen settings-screen">
      <header class="app-header">
        <button id="back-btn" class="btn icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg></button>
        <h2>Settings</h2>
      </header>
      <div class="form-group">
        <label>GitHub Token</label>
        <input type="password" id="current-token" value="${getToken() || ''}" readonly>
        <button id="disconnect-btn" class="btn danger" style="margin-top:8px">Disconnect</button>
      </div>
      <div class="form-group">
        <label>About</label>
        <p class="muted">Photoblog Editor PWA. Changes are committed directly to the main branch via GitHub API.</p>
      </div>
    </div>
  `;

  app.querySelector('#back-btn').addEventListener('click', showGrid);
  app.querySelector('#disconnect-btn').addEventListener('click', () => {
    if (confirm('Disconnect from GitHub?')) {
      clearToken();
      showSetup();
    }
  });
}

// --- Carousel Modal (matches viewer lightbox.js) ---

let modalEl = null;
let modalImages = [];
let modalCaptions = [];
let modalIdx = 0;
let modalSlug = null;

function ensureModal() {
  if (modalEl) return;
  modalEl = document.createElement('div');
  modalEl.className = 'modal-overlay';
  modalEl.id = 'post-modal';
  modalEl.innerHTML = `
    <div class="modal-content">
      <button class="modal-close">&times;</button>
      <div class="modal-photo">
        <button class="carousel-prev">&#8249;</button>
        <img class="modal-img" src="" alt="">
        <button class="carousel-next">&#8250;</button>
        <div class="carousel-dots" id="carousel-dots"></div>
        <span class="carousel-counter" id="carousel-counter"></span>
        <div class="modal-photo-caption" id="modal-photo-caption">
          <span class="caption-text"></span>
          <button class="caption-edit-icon" title="Edit photo caption"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        </div>
      </div>
      <div class="modal-details">
        <h2 class="modal-title"></h2>
        <span class="modal-date"></span>
        <div class="modal-post-caption-row">
          <p class="modal-post-caption" id="modal-post-caption"></p>
          <button class="caption-edit-icon" id="edit-post-caption-btn" title="Edit post caption"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        </div>
        <div class="modal-tags"></div>
        <button class="btn primary full-width" id="modal-view-post">View full post</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  // Close
  modalEl.querySelector('.modal-close').addEventListener('click', closeModal);
  modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });

  // Prev/Next
  modalEl.querySelector('.carousel-prev').addEventListener('click', (e) => {
    e.stopPropagation();
    if (modalIdx > 0) { modalIdx--; updateModal(); }
  });
  modalEl.querySelector('.carousel-next').addEventListener('click', (e) => {
    e.stopPropagation();
    if (modalIdx < modalImages.length - 1) { modalIdx++; updateModal(); }
  });

  // View full post
  modalEl.querySelector('#modal-view-post').addEventListener('click', (e) => {
    e.stopPropagation();
    if (modalSlug) {
      closeModal();
      showPostDetail(modalSlug);
    }
  });

  // Edit post caption
  modalEl.querySelector('#edit-post-caption-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (modalSlug) {
      const currentText = modalEl.querySelector('#modal-post-caption').textContent;
      closeModal();
      showCaptionDialog(modalSlug, null, currentText);
    }
  });

  // Edit photo caption
  modalEl.querySelector('.modal-photo-caption .caption-edit-icon').addEventListener('click', (e) => {
    e.stopPropagation();
    if (modalSlug) {
      const currentText = modalCaptions[modalIdx] || '';
      closeModal();
      showCaptionDialog(modalSlug, modalIdx, currentText);
    }
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (!modalEl.classList.contains('open')) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'ArrowLeft' && modalIdx > 0) { modalIdx--; updateModal(); }
    if (e.key === 'ArrowRight' && modalIdx < modalImages.length - 1) { modalIdx++; updateModal(); }
  });

  // Touch swipe
  let startX = null, startT = null;
  modalEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || modalImages.length <= 1) return;
    startX = e.touches[0].clientX;
    startT = Date.now();
  }, { passive: true });
  modalEl.addEventListener('touchend', (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dt = Date.now() - startT;
    startX = null;
    if (dt > 600 || Math.abs(dx) < 50) return;
    if (dx < 0 && modalIdx < modalImages.length - 1) { modalIdx++; updateModal(); }
    if (dx > 0 && modalIdx > 0) { modalIdx--; updateModal(); }
  }, { passive: true });
}

function openModal(gridItem) {
  ensureModal();
  modalSlug = gridItem.dataset.slug || null;

  try {
    modalImages = JSON.parse(gridItem.dataset.images || '[]');
  } catch { modalImages = []; }

  if (modalImages.length === 0) {
    const img = gridItem.querySelector('img');
    if (img && img.src) modalImages = [img.src];
  }

  // Per-photo captions
  try {
    modalCaptions = JSON.parse(gridItem.dataset.captions || '[]');
  } catch { modalCaptions = []; }

  modalIdx = 0;
  modalEl.querySelector('.modal-title').textContent = gridItem.dataset.title || '';
  modalEl.querySelector('.modal-date').textContent = gridItem.dataset.date || '';

  // Post caption (persistent across photos)
  const postCap = gridItem.dataset.postCaption || gridItem.dataset.excerpt || '';
  const postCapEl = modalEl.querySelector('#modal-post-caption');
  postCapEl.textContent = postCap;
  postCapEl.parentElement.style.display = postCap ? '' : 'none';

  modalEl.querySelector('.modal-tags').innerHTML =
    (gridItem.dataset.tags || '').split(', ').filter(Boolean)
      .map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');

  // Build dots
  const dotsEl = modalEl.querySelector('#carousel-dots');
  const counterEl = modalEl.querySelector('#carousel-counter');
  dotsEl.innerHTML = '';
  if (modalImages.length > 1) {
    modalImages.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
      dot.addEventListener('click', () => { modalIdx = i; updateModal(); });
      dotsEl.appendChild(dot);
    });
    dotsEl.classList.add('visible');
    counterEl.classList.add('visible');
  } else {
    dotsEl.classList.remove('visible');
    counterEl.classList.remove('visible');
  }

  updateModal();
  modalEl.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function updateModal() {
  if (modalImages.length === 0) return;
  modalEl.querySelector('.modal-img').src = modalImages[modalIdx];
  const dots = modalEl.querySelectorAll('.carousel-dot');
  dots.forEach((d, i) => d.classList.toggle('active', i === modalIdx));
  modalEl.querySelector('#carousel-counter').textContent = `${modalIdx + 1} / ${modalImages.length}`;
  modalEl.querySelector('.carousel-prev').classList.toggle('visible', modalIdx > 0);
  modalEl.querySelector('.carousel-next').classList.toggle('visible', modalIdx < modalImages.length - 1);

  // Update per-photo caption
  const cap = modalCaptions[modalIdx] || '';
  const capEl = modalEl.querySelector('#modal-photo-caption');
  capEl.querySelector('.caption-text').textContent = cap;
  capEl.style.display = cap ? '' : 'none';
}

function closeModal() {
  if (!modalEl) return;
  modalEl.classList.remove('open');
  document.body.style.overflow = '';
  modalEl.querySelector('.carousel-prev').classList.remove('visible');
  modalEl.querySelector('.carousel-next').classList.remove('visible');
  modalEl.querySelector('#carousel-dots').classList.remove('visible');
  modalEl.querySelector('#carousel-counter').classList.remove('visible');
}

// --- Router ---

function route() {
  if (!isAuthenticated()) {
    showSetup();
  } else {
    const hash = window.location.hash.slice(1);
    if (hash === 'settings') showSettings();
    else if (hash === 'trash') showTrash();
    else showGrid();
  }
}

window.addEventListener('hashchange', route);
route();
