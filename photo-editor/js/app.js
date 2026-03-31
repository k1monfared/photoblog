// Main app controller and screen router

import { isAuthenticated, getToken, setToken, clearToken, validateToken } from './auth.js';
import { fetchPostList, fetchPost, updateCaption, deletePosts, restorePosts, purgePosts, mergePosts, splitPhotos, addPost, rawUrl, thumbUrl } from './posts.js';
import { pickImages, storeImage, getStoredImages, removeStoredImage, createThumbnailUrl, clearSessionImages } from './images.js';
import { getAllTags } from './tags.js';
import { clearSessionImages as clearImages } from './storage.js';

const app = document.getElementById('app');
let selectedSlugs = [];
let selectedPhotos = [];
let currentPostCache = {}; // slug -> post data

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
          <button id="refresh-btn" class="btn icon" title="Refresh">&#8635;</button>
          <button id="trash-btn" class="btn icon" title="Trash">&#128465;</button>
          <button id="settings-btn" class="btn icon" title="Settings">&#9881;</button>
        </div>
      </header>
      <button id="add-btn" class="btn primary full-width">+ Add Post</button>
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

  await loadGrid();
}

async function loadGrid(force = false) {
  const gridEl = app.querySelector('#grid');
  if (!gridEl) return;

  try {
    const summaries = await fetchPostList(force);
    if (!gridEl.isConnected) return;

    // Load metadata for visible posts to get thumbnails
    // For speed, just use the slug to construct a likely thumbnail path
    gridEl.innerHTML = summaries.map(s => {
      // Thumbnail: guess from slug pattern YYYYMMDD_name -> YYYY-MM-DD_name_01.png
      const dateStr = parseDateFromSlug(s.slug);
      const namePart = s.slug.replace(/^\d{8}_/, '');
      const thumbPath = `files/thumbs/${dateStr}_${namePart}_01.png`;
      const url = rawUrl(thumbPath);

      return `
        <div class="grid-item" data-slug="${escapeHtml(s.slug)}">
          <img src="${url}" alt="${escapeHtml(s.slug)}" loading="lazy"
               onerror="this.style.display='none'">
          <div class="check">&#10003;</div>
          <div class="title-overlay">${escapeHtml(namePart.replace(/_/g, ' '))}</div>
        </div>
      `;
    }).join('');

    // Click handlers
    gridEl.querySelectorAll('.grid-item').forEach(el => {
      let longPressTimer = null;

      el.addEventListener('click', (e) => {
        const slug = el.dataset.slug;
        if (selectedSlugs.length > 0) {
          toggleSelection(el, slug);
        } else {
          showPostDetail(slug);
        }
      });

      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const slug = el.dataset.slug;
        toggleSelection(el, slug);
      });

      // Long press for mobile
      el.addEventListener('touchstart', () => {
        longPressTimer = setTimeout(() => {
          const slug = el.dataset.slug;
          toggleSelection(el, slug);
        }, 500);
      }, { passive: true });

      el.addEventListener('touchend', () => clearTimeout(longPressTimer));
      el.addEventListener('touchmove', () => clearTimeout(longPressTimer));
    });
  } catch (err) {
    if (gridEl.isConnected) {
      gridEl.innerHTML = `<div class="error">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
  }
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
        <button id="back-btn" class="btn icon">&larr;</button>
        <h2 id="post-title">Loading...</h2>
        <div class="header-actions">
          <button id="edit-caption-btn" class="btn icon" title="Edit post caption">&#9998;</button>
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

    app.querySelector('#edit-caption-btn').addEventListener('click', () => {
      showCaptionDialog(slug, null, post.caption);
    });

    const photos = (post.photos || []).filter(p => !p.deleted);
    const content = app.querySelector('#post-content');
    selectedPhotos = [];

    // Post caption
    let html = '';
    if (post.caption) {
      html += `<p style="padding:0 0 8px;color:var(--fg2)">${escapeHtml(post.caption)}</p>`;
    }

    // Date + tags
    html += `<div class="post-tags">
      <span class="tag-pill">${escapeHtml(post.date)}</span>
      ${post.tags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}
    </div>`;

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
          <div class="check">&#10003;</div>
          <img src="${imgUrl}" alt="${escapeHtml(photo.alt)}" loading="lazy">
        </div>
        <div class="caption-row">
          <span class="caption-text">${photo.caption ? escapeHtml(photo.caption) : '(no caption)'}</span>
          <button class="edit-btn" data-index="${i}">&#9998;</button>
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
        <button id="back-btn" class="btn icon">&larr;</button>
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
        <button id="back-btn" class="btn icon">&larr;</button>
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
        <button id="back-btn" class="btn icon">&larr;</button>
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
