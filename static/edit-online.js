// Online editor for the photoblog viewer — activated by GitHub PAT login.
// Adds editing controls (caption, merge, split, delete, add, trash) to the
// static viewer pages, routing all mutations through the GitHub API.
// Does nothing until the user logs in via the lock icon in the nav bar.
(function () {
  'use strict';

  var REPO = 'k1monfared/photoblog';
  var API = 'https://api.github.com';
  var RAW = 'https://raw.githubusercontent.com/' + REPO + '/main/';
  var TOKEN_KEY = 'gh_edit_token';

  var isPostPage = !!document.querySelector('.post-detail');
  var isGridPage = !!document.querySelector('.grid-item');
  var selected = {};
  var editMode = false;
  var PENDING_KEY = 'gh_edit_pending';
  var pendingChanges = loadPendingChanges();
  // pendingChanges structure: { slug: { postCaption: "text"|null, photoCaptions: { index: "text" } } }

  function loadPendingChanges() {
    try {
      var stored = localStorage.getItem(PENDING_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (e) { return {}; }
  }

  function savePendingChanges() {
    if (getPendingCount() === 0) {
      localStorage.removeItem(PENDING_KEY);
    } else {
      localStorage.setItem(PENDING_KEY, JSON.stringify(pendingChanges));
    }
  }

  function addPendingChange(slug, field, value, photoIndex) {
    if (!pendingChanges[slug]) pendingChanges[slug] = { postCaption: null, photoCaptions: {} };
    if (photoIndex !== null && photoIndex !== undefined) {
      pendingChanges[slug].photoCaptions[photoIndex] = value;
    } else {
      pendingChanges[slug].postCaption = value;
    }
    savePendingChanges();
    updateSaveButton();
  }

  function getPendingCount() {
    var count = 0;
    for (var slug in pendingChanges) {
      var c = pendingChanges[slug];
      if (c.postCaption !== null) count++;
      count += Object.keys(c.photoCaptions).length;
    }
    return count;
  }

  function getPendingPhotoCaption(slug, photoIndex) {
    var c = pendingChanges[slug];
    if (c && c.photoCaptions[photoIndex] !== undefined) return c.photoCaptions[photoIndex];
    return null;
  }

  function getPendingPostCaption(slug) {
    var c = pendingChanges[slug];
    return (c && c.postCaption !== null) ? c.postCaption : null;
  }

  // --- Token Management ---

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  // --- GitHub API Client ---

  function ghHeaders() {
    return {
      'Authorization': 'Bearer ' + getToken(),
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  }

  function ghRequest(path, options) {
    options = options || {};
    options.headers = ghHeaders();
    return fetch(API + path, options).then(function (res) {
      if (!res.ok) return res.json().then(function (b) {
        throw new Error('GitHub API ' + res.status + ' on ' + (options.method || 'GET') + ' ' + path + ': ' + (b.message || res.statusText));
      });
      return res.json();
    });
  }

  function ghGetFile(path) {
    return ghRequest('/repos/' + REPO + '/contents/' + path).then(function (data) {
      var raw = atob(data.content.replace(/\n/g, ''));
      var bytes = Uint8Array.from(raw, function (c) { return c.charCodeAt(0); });
      var text = new TextDecoder().decode(bytes);
      return JSON.parse(text);
    });
  }

  function ghFetchRaw(path) {
    return fetch(RAW + path).then(function (r) { return r.ok ? r.json() : null; });
  }

  function ghGetFileSha(path) {
    return ghRequest('/repos/' + REPO + '/contents/' + path).then(function (d) { return d.sha; }).catch(function () { return null; });
  }

  function ghCreateCommit(files, message) {
    var baseSha, baseTreeSha;
    return ghRequest('/repos/' + REPO + '/git/refs/heads/main')
      .then(function (ref) {
        baseSha = ref.object.sha;
        return ghRequest('/repos/' + REPO + '/git/commits/' + baseSha);
      })
      .then(function (commit) {
        baseTreeSha = commit.tree.sha;
        // Create blobs
        var treeItems = [];
        var chain = Promise.resolve();
        files.forEach(function (file) {
          chain = chain.then(function () {
            if (file.sha === null) {
              treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
              return;
            }
            if (file.blobSha) {
              treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: file.blobSha });
              return;
            }
            return ghRequest('/repos/' + REPO + '/git/blobs', {
              method: 'POST',
              body: JSON.stringify({ content: file.content, encoding: file.encoding || 'utf-8' }),
            }).then(function (blob) {
              treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
            });
          });
        });
        return chain.then(function () { return treeItems; });
      })
      .then(function (treeItems) {
        return ghRequest('/repos/' + REPO + '/git/trees', {
          method: 'POST',
          body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
        });
      })
      .then(function (tree) {
        return ghRequest('/repos/' + REPO + '/git/commits', {
          method: 'POST',
          body: JSON.stringify({ message: message, tree: tree.sha, parents: [baseSha] }),
        });
      })
      .then(function (commit) {
        return ghRequest('/repos/' + REPO + '/git/refs/heads/main', {
          method: 'PATCH',
          body: JSON.stringify({ sha: commit.sha }),
        }).then(function () { return commit; });
      });
  }

  // --- Markdown Generator (matches Python generate_markdown_from_json) ---

  function generateMarkdown(post) {
    if (post.deleted) return null;
    var photos = (post.photos || []).filter(function (p) { return !p.deleted; });
    if (photos.length === 0) return null;

    var title = post.title || post.date || 'Untitled';
    var tags = (post.tags || ['photoblog']).join(', ');
    var thumbnail = photos[0].web || '';

    var lines = ['---', 'tags: ' + tags, 'thumbnail: ' + thumbnail, '---', '', '# ' + title, ''];
    if (post.caption) { lines.push(post.caption); lines.push(''); }

    photos.forEach(function (photo) {
      var alt = photo.alt || title;
      lines.push('![' + alt + '](' + photo.web + ')');
      lines.push('');
      if (photo.caption) {
        if (photo.caption.indexOf('\n') === -1 && photo.caption.length < 120) {
          lines.push('*' + photo.caption + '*');
        } else {
          lines.push(photo.caption);
        }
        lines.push('');
      }
      var exif = photo.exif || {};
      var parts = [];
      if (exif.camera) parts.push('**Camera:** ' + exif.camera);
      if (exif.lens) parts.push('**Lens:** ' + exif.lens);
      var settings = [];
      if (exif.focal_length) settings.push(exif.focal_length);
      if (exif.aperture) settings.push(exif.aperture);
      if (exif.shutter_speed) settings.push(exif.shutter_speed);
      if (exif.iso) settings.push('ISO ' + exif.iso);
      if (settings.length) parts.push('**Settings:** ' + settings.join(' | '));
      if (parts.length) { lines.push(parts.join('  \n')); lines.push(''); }
    });

    return lines.join('\n') + '\n';
  }

  // --- Commit helpers ---

  function commitPostUpdate(post, message) {
    var files = [];
    var md = generateMarkdown(post);
    files.push({ path: 'metadata/' + post.slug + '.json', content: JSON.stringify(post, null, 2) + '\n' });
    if (md) {
      files.push({ path: 'posts/' + post.slug + '.md', content: md });
    }
    return ghCreateCommit(files, message);
  }

  function mapNonDeletedIndex(photos, ni) {
    var count = 0;
    for (var i = 0; i < photos.length; i++) {
      if (photos[i].deleted) continue;
      if (count === ni) return i;
      count++;
    }
    return null;
  }

  // --- Helpers ---

  // --- Toast notification ---

  function showToast(message, duration) {
    duration = duration || 4000;
    var existing = document.querySelector('.edit-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'edit-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('visible'); }, 10);
    setTimeout(function () {
      toast.classList.remove('visible');
      setTimeout(function () { toast.remove(); }, 300);
    }, duration);
  }

  // --- Save Button (floating, shows pending change count) ---

  var saveBtn = null;

  function createSaveButton() {
    if (saveBtn) return;
    saveBtn = document.createElement('button');
    saveBtn.className = 'edit-save-btn';
    saveBtn.style.display = 'none';
    saveBtn.addEventListener('click', commitPendingChanges);
    document.body.appendChild(saveBtn);
  }

  function updateSaveButton() {
    if (!saveBtn) return;
    var count = getPendingCount();
    var postCount = Object.keys(pendingChanges).length;
    if (count > 0) {
      saveBtn.textContent = 'Save ' + count + ' edit' + (count > 1 ? 's' : '') +
        ' in ' + postCount + ' post' + (postCount > 1 ? 's' : '');
      saveBtn.style.display = '';
      saveBtn.disabled = false;
    } else {
      saveBtn.style.display = 'none';
    }
  }

  function commitPendingChanges() {
    var count = getPendingCount();
    if (count === 0) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    var slugs = Object.keys(pendingChanges);
    var files = [];
    var chain = Promise.resolve();

    slugs.forEach(function (slug) {
      chain = chain.then(function () {
        return ghFetchRaw('metadata/' + slug + '.json').then(function (post) {
          if (!post) return;
          var changes = pendingChanges[slug];

          // Apply post caption
          if (changes.postCaption !== null) {
            post.caption = changes.postCaption;
          }

          // Apply photo captions
          for (var idxStr in changes.photoCaptions) {
            var ni = parseInt(idxStr);
            var actual = mapNonDeletedIndex(post.photos, ni);
            if (actual !== null) {
              post.photos[actual].caption = changes.photoCaptions[idxStr];
            }
          }

          var md = generateMarkdown(post);
          files.push({ path: 'metadata/' + slug + '.json', content: JSON.stringify(post, null, 2) + '\n' });
          if (md) files.push({ path: 'posts/' + slug + '.md', content: md });
        });
      });
    });

    chain.then(function () {
      return ghCreateCommitWithRetry(files, 'Update captions: ' + slugs.join(', '));
    }).then(function () {
      pendingChanges = {};
      savePendingChanges();
      updateSaveButton();
      showToast('Saved ' + count + ' change' + (count > 1 ? 's' : '') + '. Site will rebuild in ~2 min.');
    }).catch(function (err) {
      alert('Error saving: ' + err.message);
      saveBtn.disabled = false;
      updateSaveButton();
    });
  }

  // Retry on 422 (ref moved between read and update)
  function ghCreateCommitWithRetry(files, message) {
    return ghCreateCommit(files, message).catch(function (err) {
      if (err.message && err.message.indexOf('422') !== -1) {
        return ghCreateCommit(files, message);
      }
      throw err;
    });
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  function getPostSlug() {
    var el = document.querySelector('.post-detail');
    return el ? el.getAttribute('data-slug') : null;
  }

  function parseDateFromSlug(slug) {
    if (!slug) return '';
    var match = slug.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
    return match ? match[1] + '-' + match[2] + '-' + match[3] : '';
  }

  function getSelectedCount() {
    if (isPostPage) {
      var postSlug = Object.keys(selected)[0];
      return (postSlug && selected[postSlug]) ? selected[postSlug].length : 0;
    }
    return Object.keys(selected).length;
  }

  function closeDialogs() {
    document.querySelectorAll('.editor-dialog-overlay').forEach(function (el) { el.remove(); });
  }

  // --- Login UI ---

  function addLoginButton() {
    var nav = document.querySelector('header nav');
    if (!nav) return;

    var btn = document.createElement('button');
    btn.id = 'edit-login-btn';
    btn.setAttribute('aria-label', 'Edit mode');
    btn.title = 'Edit mode';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>';
    nav.appendChild(btn);

    btn.addEventListener('click', function () {
      if (editMode) {
        if (confirm('Disconnect from edit mode?')) {
          clearToken();
          location.reload();
        }
      } else {
        showLoginDialog();
      }
    });
  }

  function showLoginDialog() {
    var overlay = document.createElement('div');
    overlay.className = 'editor-dialog-overlay open';
    overlay.innerHTML =
      '<div class="editor-dialog">' +
        '<h3>Edit Mode</h3>' +
        '<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Enter a GitHub Personal Access Token with Contents read/write permission for ' + REPO + '.</p>' +
        '<input type="password" id="edit-token-input" placeholder="github_pat_..." style="margin-bottom:12px">' +
        '<div id="edit-login-error" style="color:var(--danger,#e74c3c);font-size:13px;margin-bottom:8px" hidden></div>' +
        '<div class="dialog-actions">' +
          '<button class="btn-cancel" id="login-cancel">Cancel</button>' +
          '<button class="btn-primary" id="login-connect">Connect</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector('#login-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    var input = overlay.querySelector('#edit-token-input');
    var connectBtn = overlay.querySelector('#login-connect');
    var errorEl = overlay.querySelector('#edit-login-error');

    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') connectBtn.click(); });
    input.focus();

    connectBtn.addEventListener('click', function () {
      var token = input.value.trim();
      if (!token) { errorEl.textContent = 'Please enter a token'; errorEl.hidden = false; return; }
      connectBtn.disabled = true;
      connectBtn.textContent = 'Validating...';

      fetch(API + '/repos/' + REPO, {
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github.v3+json' },
      })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok || !result.data.permissions || !result.data.permissions.push) {
          errorEl.textContent = 'Invalid token or missing write permission';
          errorEl.hidden = false;
          connectBtn.disabled = false;
          connectBtn.textContent = 'Connect';
          return;
        }
        setToken(token);
        overlay.remove();
        activateEditMode();
      })
      .catch(function (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect';
      });
    });
  }

  // --- Edit Mode Activation ---

  function activateEditMode() {
    editMode = true;

    // Change lock icon to unlocked
    var loginBtn = document.getElementById('edit-login-btn');
    if (loginBtn) {
      loginBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg>';
      loginBtn.title = 'Disconnect edit mode';
    }

    document.body.classList.add('edit-mode');
    createSaveButton();
    setupEditorNav();
    setupModalEditing();
    createToolbar();

    if (isPostPage) {
      setupCaptionEditing();
      setupPostSelection();
      applyPendingToPostPage();
    }
    if (isGridPage) {
      setupGridSelection();
    }
  }

  // Apply any pending changes to the current post page DOM on load
  function applyPendingToPostPage() {
    var slug = getPostSlug();
    if (!slug || !pendingChanges[slug]) return;
    var changes = pendingChanges[slug];

    // Apply post caption
    if (changes.postCaption !== null) {
      var postBody = document.querySelector('.post-body');
      if (postBody) {
        var firstChild = postBody.firstElementChild;
        if (firstChild && firstChild.tagName === 'P' && !firstChild.querySelector('img')) {
          firstChild.textContent = changes.postCaption;
          firstChild.classList.add('caption-pending');
        }
      }
    }

    // Apply photo captions
    var containers = getPhotoContainers();
    for (var idxStr in changes.photoCaptions) {
      var idx = parseInt(idxStr);
      if (containers[idx]) {
        var next = containers[idx].nextElementSibling;
        if (next && (next.querySelector('em') || (!next.querySelector('img') && next.tagName === 'P'))) {
          next.innerHTML = '<em>' + escapeHTML(changes.photoCaptions[idxStr]) + '</em>';
          next.classList.add('caption-pending');
        }
      }
    }
  }

  // --- Modal Caption Editing ---

  var currentModalSlug = null;
  var currentModalCaptions = [];

  function setupModalEditing() {
    var modal = document.getElementById('post-modal');
    if (!modal) return;

    // Add edit button to post caption in modal
    var postCapEl = modal.querySelector('#modal-post-caption');
    if (postCapEl) {
      var editBtn = document.createElement('button');
      editBtn.className = 'modal-edit-btn';
      editBtn.title = 'Edit post caption';
      editBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (currentModalSlug) {
          var currentText = postCapEl.textContent || '';
          openCaptionEditor(currentModalSlug, null, currentText);
        }
      });
      postCapEl.parentNode.insertBefore(editBtn, postCapEl.nextSibling);
    }

    // Add edit button to photo caption in modal
    var photoCaptionEl = modal.querySelector('#modal-photo-caption');
    if (photoCaptionEl) {
      var photoEditBtn = document.createElement('button');
      photoEditBtn.className = 'modal-edit-btn modal-photo-edit-btn';
      photoEditBtn.title = 'Edit photo caption';
      photoEditBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      photoEditBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (currentModalSlug) {
          var currentIdx = parseInt(modal.querySelector('#carousel-counter').textContent.split('/')[0].trim()) - 1 || 0;
          var currentText = currentModalCaptions[currentIdx] || '';
          // Check pending changes first
          var pending = getPendingPhotoCaption(currentModalSlug, currentIdx);
          if (pending !== null) currentText = pending;
          openCaptionEditor(currentModalSlug, currentIdx, currentText);
        }
      });
      photoCaptionEl.appendChild(photoEditBtn);
    }

    // Hook into modal open to track current slug and captions
    var origOpenModal = window._origOpenModal;
    // Observe the modal for when it opens
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName === 'class' && modal.classList.contains('open')) {
          // Find which grid item opened the modal by checking active item
          var items = document.querySelectorAll('.grid-item');
          items.forEach(function (item) {
            var imgSrc = modal.querySelector('.modal-img').getAttribute('src') || '';
            try {
              var itemImages = JSON.parse(item.dataset.images || '[]');
              if (itemImages.indexOf(imgSrc) !== -1 || (itemImages.length > 0 && imgSrc.indexOf(itemImages[0]) !== -1)) {
                currentModalSlug = item.dataset.slug || null;
                try { currentModalCaptions = JSON.parse(item.dataset.captions || '[]'); } catch (e) { currentModalCaptions = []; }
              }
            } catch (e) {}
          });
        }
      });
    });
    observer.observe(modal, { attributes: true });
  }

  function updateModalCaptionsFromPending() {
    var modal = document.getElementById('post-modal');
    if (!modal || !modal.classList.contains('open') || !currentModalSlug) return;

    // Update post caption
    var postCapEl = modal.querySelector('#modal-post-caption');
    if (postCapEl) {
      var pendingPost = getPendingPostCaption(currentModalSlug);
      if (pendingPost !== null) {
        postCapEl.textContent = pendingPost;
        postCapEl.parentNode.style.display = pendingPost ? '' : 'none';
      }
    }

    // Update photo caption (use the span inside the div)
    var photoCaptionEl = modal.querySelector('#modal-photo-caption');
    if (photoCaptionEl) {
      var counterText = modal.querySelector('#carousel-counter').textContent || '1 / 1';
      var currentIdx = parseInt(counterText.split('/')[0].trim()) - 1 || 0;
      var pendingPhoto = getPendingPhotoCaption(currentModalSlug, currentIdx);
      if (pendingPhoto !== null) {
        var capSpan = photoCaptionEl.querySelector('.caption-text');
        if (capSpan) capSpan.textContent = pendingPhoto;
        photoCaptionEl.style.display = '';
      }
    }
  }

  // --- Editor Nav Controls ---

  function setupEditorNav() {
    var nav = document.querySelector('header nav');
    if (!nav) return;

    var loginBtn = document.getElementById('edit-login-btn');

    // Add button
    var addBtn = document.createElement('button');
    addBtn.className = 'nav-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add new post';
    addBtn.addEventListener('click', openAddDialog);
    nav.insertBefore(addBtn, loginBtn);

    // Show deleted toggle
    var showDelBtn = document.createElement('button');
    showDelBtn.className = 'nav-show-deleted-btn';
    showDelBtn.textContent = 'Show deleted';
    showDelBtn.addEventListener('click', function () {
      var showing = showDelBtn.textContent === 'Hide deleted';
      showDelBtn.textContent = showing ? 'Show deleted' : 'Hide deleted';
      document.querySelectorAll('.grid-item.deleted, .feed-card.deleted').forEach(function (el) {
        el.style.display = showing ? 'none' : '';
      });
    });
    nav.insertBefore(showDelBtn, loginBtn);

    // Trash button
    var trashBtn = document.createElement('button');
    trashBtn.className = 'nav-trash-btn';
    trashBtn.textContent = 'Trash';
    trashBtn.addEventListener('click', openTrashDialog);
    nav.insertBefore(trashBtn, loginBtn);

    // Hide deleted items by default
    document.querySelectorAll('.grid-item.deleted, .feed-card.deleted').forEach(function (el) {
      el.style.display = 'none';
    });
  }

  // --- Caption Editing ---

  function setupCaptionEditing() {
    if (!isPostPage) return;
    var slug = getPostSlug();
    var postBody = document.querySelector('.post-body');
    var postMeta = document.querySelector('.post-meta');
    if (!postBody || !postMeta) return;

    // Post caption edit button
    var postBtn = document.createElement('button');
    postBtn.className = 'caption-edit-btn';
    postBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    postBtn.title = 'Edit post caption';
    postBtn.addEventListener('click', function () {
      var currentCaption = getPostCaption();
      openCaptionEditor(slug, null, currentCaption);
    });
    postMeta.parentNode.insertBefore(postBtn, postMeta.nextSibling);

    // Photo caption edit buttons — fetch real captions from metadata JSON
    var photos = getPhotoContainers();
    var photoCaptionsFromJson = [];

    ghFetchRaw('metadata/' + slug + '.json').then(function (post) {
      if (!post) return;
      var nonDeleted = (post.photos || []).filter(function (p) { return !p.deleted; });
      photoCaptionsFromJson = nonDeleted.map(function (p) { return p.caption || ''; });
    }).catch(function () {}).then(function () {
      photos.forEach(function (container, i) {
        var btn = document.createElement('button');
        btn.className = 'caption-edit-btn';
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
        btn.title = 'Edit photo caption';
        btn.addEventListener('click', function () {
          // Use JSON caption (authoritative), fall back to DOM, check pending
          var caption = photoCaptionsFromJson[i] || getPhotoCaption(container);
          var pending = getPendingPhotoCaption(slug, i);
          if (pending !== null) caption = pending;
          openCaptionEditor(slug, i, caption);
        });
        container.parentNode.insertBefore(btn, container.nextSibling);
      });
    });
  }

  function getPhotoContainers() {
    var postBody = document.querySelector('.post-body');
    if (!postBody) return [];
    var paragraphs = postBody.querySelectorAll('p');
    var containers = [];
    paragraphs.forEach(function (p) { if (p.querySelector('img')) containers.push(p); });
    return containers;
  }

  function getPostCaption() {
    var postBody = document.querySelector('.post-body');
    if (!postBody) return '';
    var children = postBody.children;
    var caption = '';
    for (var i = 0; i < children.length; i++) {
      if (children[i].querySelector && children[i].querySelector('img')) break;
      if (children[i].tagName === 'P') caption += (caption ? '\n' : '') + children[i].textContent;
    }
    return caption;
  }

  function getPhotoCaption(photoP) {
    var next = photoP.nextElementSibling;
    if (!next) return '';
    if (next.tagName === 'P' && next.querySelector('em')) return next.querySelector('em').textContent;
    if (next.tagName === 'EM') return next.textContent;
    if (next.tagName === 'P' && !next.querySelector('img')) return next.textContent;
    return '';
  }

  function openCaptionEditor(slug, photoIndex, currentText) {
    // Check if there's already a pending change for this
    var pending;
    if (photoIndex !== null && photoIndex !== undefined) {
      pending = getPendingPhotoCaption(slug, photoIndex);
    } else {
      pending = getPendingPostCaption(slug);
    }
    var displayText = (pending !== null) ? pending : (currentText || '');

    var overlay = document.createElement('div');
    overlay.className = 'editor-dialog-overlay open';
    overlay.innerHTML =
      '<div class="editor-dialog">' +
        '<h3>' + (photoIndex !== null && photoIndex !== undefined ? 'Photo caption' : 'Post caption') + '</h3>' +
        '<textarea id="caption-textarea" rows="4">' + escapeHTML(displayText) + '</textarea>' +
        '<div class="dialog-actions">' +
          '<button class="btn-cancel">Cancel</button>' +
          '<button class="btn-primary" id="caption-save">Done</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    overlay.querySelector('#caption-textarea').focus();
    overlay.querySelector('.btn-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#caption-save').addEventListener('click', function () {
      var newCaption = overlay.querySelector('#caption-textarea').value;
      addPendingChange(slug, null, newCaption, photoIndex);
      overlay.remove();

      // Optimistic DOM update
      if (photoIndex !== null && photoIndex !== undefined) {
        // Update photo caption in DOM if on post page
        var containers = getPhotoContainers();
        if (containers[photoIndex]) {
          var next = containers[photoIndex].nextElementSibling;
          if (next && (next.querySelector('em') || (!next.querySelector('img') && next.tagName === 'P'))) {
            next.innerHTML = newCaption ? '<em>' + escapeHTML(newCaption) + '</em>' : '';
          }
        }
      } else {
        // Update post caption in DOM
        var postBody = document.querySelector('.post-body');
        if (postBody) {
          var firstChild = postBody.firstElementChild;
          if (firstChild && firstChild.tagName === 'P' && !firstChild.querySelector('img')) {
            firstChild.textContent = newCaption;
          }
        }
      }

      // Update modal captions if open
      updateModalCaptionsFromPending();
      showToast('Caption updated. Click Save to push changes.');
    });
  }

  // --- Grid Selection ---

  function setupGridSelection() {
    if (!isGridPage) return;
    document.querySelectorAll('.grid-item').forEach(function (item) {
      if (item.classList.contains('deleted')) return;
      var checkbox = document.createElement('div');
      checkbox.className = 'photo-checkbox';
      item.insertBefore(checkbox, item.firstChild);

      checkbox.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        var slug = item.getAttribute('data-slug');
        if (checkbox.classList.contains('checked')) {
          checkbox.classList.remove('checked');
          delete selected[slug];
        } else {
          checkbox.classList.add('checked');
          selected[slug] = true;
        }
        updateToolbar();
      });
    });
  }

  // --- Post Photo Selection ---

  function setupPostSelection() {
    if (!isPostPage) return;
    var postSlug = getPostSlug();
    var photos = getPhotoContainers();

    photos.forEach(function (container, index) {
      var checkbox = document.createElement('div');
      checkbox.className = 'photo-checkbox';
      container.style.position = 'relative';
      container.insertBefore(checkbox, container.firstChild);

      checkbox.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        if (!selected[postSlug]) selected[postSlug] = [];
        var arr = selected[postSlug];
        var pos = arr.indexOf(index);
        if (checkbox.classList.contains('checked')) {
          checkbox.classList.remove('checked');
          if (pos !== -1) arr.splice(pos, 1);
          if (arr.length === 0) delete selected[postSlug];
        } else {
          checkbox.classList.add('checked');
          if (pos === -1) arr.push(index);
        }
        updateToolbar();
      });
    });
  }

  // --- Floating Toolbar ---

  var toolbar = null;

  function createToolbar() {
    toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    toolbar.style.display = 'none';

    if (isGridPage) {
      toolbar.innerHTML =
        '<span class="toolbar-count"></span>' +
        '<button class="merge-btn">Merge</button>' +
        '<button class="delete-btn">Delete</button>' +
        '<button class="cancel-sel-btn">Cancel</button>';
      toolbar.querySelector('.merge-btn').addEventListener('click', openMergeDialog);
      toolbar.querySelector('.delete-btn').addEventListener('click', openDeleteDialog);
      toolbar.querySelector('.cancel-sel-btn').addEventListener('click', clearSelection);
    } else if (isPostPage) {
      toolbar.innerHTML =
        '<span class="toolbar-count"></span>' +
        '<button class="split-btn">Split</button>' +
        '<button class="delete-btn">Delete</button>' +
        '<button class="cancel-sel-btn">Cancel</button>';
      toolbar.querySelector('.split-btn').addEventListener('click', openSplitDialog);
      toolbar.querySelector('.delete-btn').addEventListener('click', openDeleteDialog);
      toolbar.querySelector('.cancel-sel-btn').addEventListener('click', clearSelection);
    }
    document.body.appendChild(toolbar);
  }

  function updateToolbar() {
    if (!toolbar) return;
    var count = getSelectedCount();
    if (count > 0) {
      toolbar.style.display = 'flex';
      var label = isPostPage ? ' photo(s)' : ' post(s)';
      toolbar.querySelector('.toolbar-count').textContent = count + label + ' selected';
      document.body.classList.add('selection-mode');
    } else {
      toolbar.style.display = 'none';
      document.body.classList.remove('selection-mode');
    }
  }

  function clearSelection() {
    selected = {};
    document.querySelectorAll('.photo-checkbox.checked').forEach(function (el) { el.classList.remove('checked'); });
    updateToolbar();
  }

  // --- Merge Dialog ---

  function openMergeDialog() {
    var slugs = Object.keys(selected);
    if (slugs.length < 2) { alert('Select at least 2 posts to merge.'); return; }

    var earliest = '';
    slugs.forEach(function (slug) {
      var d = parseDateFromSlug(slug);
      if (!earliest || d < earliest) earliest = d;
    });

    var overlay = document.createElement('div');
    overlay.className = 'editor-dialog-overlay open';
    overlay.innerHTML =
      '<div class="editor-dialog">' +
        '<h3>Merge ' + slugs.length + ' posts</h3>' +
        '<label>Date:<br><input type="text" class="merge-date" value="' + escapeHTML(earliest) + '" placeholder="YYYY-MM-DD"></label><br>' +
        '<label>Slug:<br><input type="text" class="merge-slug" placeholder="my_photo_title"></label><br>' +
        '<label>Caption:<br><textarea class="merge-caption" rows="4"></textarea></label><br>' +
        '<div class="dialog-actions"><button class="btn-cancel">Cancel</button><button class="btn-primary" id="merge-go">Merge</button></div>' +
      '</div>';

    document.body.appendChild(overlay);
    overlay.querySelector('.btn-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#merge-go').addEventListener('click', function () {
      var btn = overlay.querySelector('#merge-go');
      var date = overlay.querySelector('.merge-date').value.trim();
      var slugName = overlay.querySelector('.merge-slug').value.trim();
      var caption = overlay.querySelector('.merge-caption').value;
      if (!date || !slugName) { alert('Date and slug are required'); return; }

      btn.disabled = true;
      btn.textContent = 'Merging...';

      var datePart = date.replace(/-/g, '');
      var newSlug = datePart + '_' + slugName;
      var allPhotos = [];
      var firstTags = null;
      var files = [];

      var chain = Promise.resolve();
      slugs.forEach(function (srcSlug) {
        chain = chain.then(function () {
          return ghFetchRaw('metadata/' + srcSlug + '.json').then(function (post) {
            if (!post) return;
            if (!firstTags) firstTags = post.tags;
            (post.photos || []).forEach(function (photo) {
              if (!photo.deleted) allPhotos.push({ photo: photo, srcSlug: srcSlug });
            });
          });
        });
      });

      chain.then(function () {
        if (allPhotos.length === 0) throw new Error('No photos found');

        // Get blob SHAs for image copying
        var blobChain = Promise.resolve();
        var newPhotos = [];
        allPhotos.forEach(function (item, seq) {
          blobChain = blobChain.then(function () {
            var nn = String(seq + 1).padStart(2, '0');
            var newWebRel = 'files/photoblog/' + date + '_' + slugName + '_' + nn + '.jpg';
            return ghGetFileSha(item.photo.web).then(function (sha) {
              if (sha) files.push({ path: newWebRel, blobSha: sha });
              var p = Object.assign({}, item.photo, { web: newWebRel });
              delete p.deleted;
              newPhotos.push(p);
            });
          });
        });
        return blobChain.then(function () { return newPhotos; });
      }).then(function (newPhotos) {
        var title = slugName.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        var newPost = { title: title, date: date, slug: newSlug, caption: caption, tags: firstTags || ['photoblog'], photos: newPhotos, thumbnail: newPhotos[0].web };
        var md = generateMarkdown(newPost);
        files.push({ path: 'metadata/' + newSlug + '.json', content: JSON.stringify(newPost, null, 2) + '\n' });
        if (md) files.push({ path: 'posts/' + newSlug + '.md', content: md });

        // Soft-delete source posts
        var delChain = Promise.resolve();
        slugs.forEach(function (srcSlug) {
          delChain = delChain.then(function () {
            return ghFetchRaw('metadata/' + srcSlug + '.json').then(function (post) {
              if (!post) return;
              post.photos.forEach(function (p) { p.deleted = true; });
              post.deleted = true;
              var srcMd = generateMarkdown(post);
              files.push({ path: 'metadata/' + srcSlug + '.json', content: JSON.stringify(post, null, 2) + '\n' });
              if (srcMd) files.push({ path: 'posts/' + srcSlug + '.md', content: srcMd });
              else return ghGetFileSha('posts/' + srcSlug + '.md').then(function (sha) { if (sha) files.push({ path: 'posts/' + srcSlug + '.md', sha: null }); });
            });
          });
        });
        return delChain;
      }).then(function () {
        return ghCreateCommitWithRetry(files, 'Merge ' + slugs.length + ' posts into: ' + slugName);
      }).then(function () {
        overlay.remove();
        showToast('Saved. Site will rebuild in ~2 minutes.');
      }).catch(function (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Merge';
      });
    });
  }

  // --- Split Dialog ---

  function openSplitDialog() {
    var postSlug = getPostSlug();
    var indices = selected[postSlug];
    if (!indices || indices.length === 0) { alert('Select at least 1 photo to split.'); return; }

    var dateStr = parseDateFromSlug(postSlug);
    var overlay = document.createElement('div');
    overlay.className = 'editor-dialog-overlay open';
    overlay.innerHTML =
      '<div class="editor-dialog">' +
        '<h3>Split ' + indices.length + ' photo(s)</h3>' +
        '<label>Date:<br><input type="text" class="split-date" value="' + escapeHTML(dateStr) + '" placeholder="YYYY-MM-DD"></label><br>' +
        '<label>Slug:<br><input type="text" class="split-slug" placeholder="new_post_slug"></label><br>' +
        '<label>Caption:<br><textarea class="split-caption" rows="4"></textarea></label><br>' +
        '<div class="dialog-actions"><button class="btn-cancel">Cancel</button><button class="btn-primary" id="split-go">Split</button></div>' +
      '</div>';

    document.body.appendChild(overlay);
    overlay.querySelector('.btn-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#split-go').addEventListener('click', function () {
      var btn = overlay.querySelector('#split-go');
      var date = overlay.querySelector('.split-date').value.trim();
      var slugName = overlay.querySelector('.split-slug').value.trim();
      var caption = overlay.querySelector('.split-caption').value;
      if (!date || !slugName) { alert('Date and slug are required'); return; }

      btn.disabled = true;
      btn.textContent = 'Splitting...';

      var datePart = date.replace(/-/g, '');
      var newSlug = datePart + '_' + slugName;
      var files = [];

      ghFetchRaw('metadata/' + postSlug + '.json').then(function (srcPost) {
        if (!srcPost) throw new Error('Post not found');

        var actualIndices = indices.map(function (ni) { return mapNonDeletedIndex(srcPost.photos, ni); }).filter(function (i) { return i !== null; });
        if (actualIndices.length === 0) throw new Error('No valid photos');

        var newPhotos = [];
        var blobChain = Promise.resolve();
        actualIndices.forEach(function (actualIdx, seq) {
          blobChain = blobChain.then(function () {
            var photo = srcPost.photos[actualIdx];
            var nn = String(seq + 1).padStart(2, '0');
            var newWebRel = 'files/photoblog/' + date + '_' + slugName + '_' + nn + '.jpg';
            return ghGetFileSha(photo.web).then(function (sha) {
              if (sha) files.push({ path: newWebRel, blobSha: sha });
              var p = Object.assign({}, photo, { web: newWebRel });
              delete p.deleted;
              newPhotos.push(p);
            });
          });
        });

        return blobChain.then(function () {
          var title = slugName.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
          var newPost = { title: title, date: date, slug: newSlug, caption: caption, tags: srcPost.tags || ['photoblog'], photos: newPhotos, thumbnail: newPhotos[0].web };
          var md = generateMarkdown(newPost);
          files.push({ path: 'metadata/' + newSlug + '.json', content: JSON.stringify(newPost, null, 2) + '\n' });
          if (md) files.push({ path: 'posts/' + newSlug + '.md', content: md });

          // Mark split photos deleted in source
          actualIndices.forEach(function (idx) { srcPost.photos[idx].deleted = true; });
          if (srcPost.photos.every(function (p) { return p.deleted; })) srcPost.deleted = true;
          var srcMd = generateMarkdown(srcPost);
          files.push({ path: 'metadata/' + postSlug + '.json', content: JSON.stringify(srcPost, null, 2) + '\n' });
          if (srcMd) files.push({ path: 'posts/' + postSlug + '.md', content: srcMd });
          else return ghGetFileSha('posts/' + postSlug + '.md').then(function (sha) { if (sha) files.push({ path: 'posts/' + postSlug + '.md', sha: null }); });
        });
      }).then(function () {
        return ghCreateCommitWithRetry(files, 'Split photos from ' + postSlug + ' into: ' + slugName);
      }).then(function () { overlay.remove(); showToast('Saved. Site will rebuild in ~2 minutes.'); })
      .catch(function (err) { alert('Error: ' + err.message); btn.disabled = false; btn.textContent = 'Split'; });
    });
  }

  // --- Delete Dialog ---

  function openDeleteDialog() {
    var count = getSelectedCount();
    var label = isPostPage ? 'photo(s)' : 'post(s)';
    if (!confirm('Delete ' + count + ' ' + label + '? They will be moved to trash.')) return;

    var slugs, photoIndices;
    if (isPostPage) {
      var postSlug = getPostSlug();
      slugs = [postSlug];
      photoIndices = selected[postSlug] ? selected[postSlug].slice().sort() : [];
    } else {
      slugs = Object.keys(selected);
      photoIndices = null;
    }

    var files = [];
    var chain = Promise.resolve();
    slugs.forEach(function (slug) {
      chain = chain.then(function () {
        return ghFetchRaw('metadata/' + slug + '.json').then(function (post) {
          if (!post) return;
          if (!photoIndices) {
            post.deleted = true;
            post.photos.forEach(function (p) { p.deleted = true; });
          } else {
            photoIndices.forEach(function (ni) {
              var actual = mapNonDeletedIndex(post.photos, ni);
              if (actual !== null) post.photos[actual].deleted = true;
            });
            if (post.photos.every(function (p) { return p.deleted; })) post.deleted = true;
          }
          var md = generateMarkdown(post);
          files.push({ path: 'metadata/' + slug + '.json', content: JSON.stringify(post, null, 2) + '\n' });
          if (md) files.push({ path: 'posts/' + slug + '.md', content: md });
          else return ghGetFileSha('posts/' + slug + '.md').then(function (sha) { if (sha) files.push({ path: 'posts/' + slug + '.md', sha: null }); });
        });
      });
    });

    chain.then(function () {
      return ghCreateCommitWithRetry(files, 'Delete: ' + slugs.join(', '));
    }).then(function () {
      // Optimistic: hide deleted items from DOM
      slugs.forEach(function (slug) {
        var el = document.querySelector('[data-slug="' + slug + '"]');
        if (el) el.style.display = 'none';
      });
      clearSelection();
      showToast('Deleted. Site will rebuild in ~2 minutes.');
    })
    .catch(function (err) { alert('Error: ' + err.message); });
  }

  // --- Trash Dialog ---

  function openTrashDialog() {
    var overlay = document.createElement('div');
    overlay.className = 'editor-dialog-overlay open';
    overlay.innerHTML =
      '<div class="editor-dialog trash-dialog">' +
        '<h3>Trash</h3>' +
        '<div class="trash-grid" id="trash-grid-content"><p>Loading...</p></div>' +
        '<div class="dialog-actions"><button class="btn-cancel">Close</button></div>' +
      '</div>';

    document.body.appendChild(overlay);
    overlay.querySelector('.btn-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    // Fetch all metadata to find deleted posts
    ghRequest('/repos/' + REPO + '/contents/metadata').then(function (files) {
      var jsonFiles = files.filter(function (f) { return f.name.endsWith('.json'); });
      var deleted = [];
      var chain = Promise.resolve();
      jsonFiles.forEach(function (f) {
        chain = chain.then(function () {
          return ghFetchRaw('metadata/' + f.name).then(function (post) {
            if (post && post.deleted) {
              deleted.push(post);
            }
          }).catch(function () {});
        });
      });
      return chain.then(function () { return deleted; });
    }).then(function (deleted) {
      var container = overlay.querySelector('#trash-grid-content');
      if (deleted.length === 0) {
        container.innerHTML = '<p>Trash is empty.</p>';
        return;
      }
      container.innerHTML = deleted.map(function (post) {
        var thumb = post.thumbnail || (post.photos[0] && post.photos[0].web) || '';
        var thumbUrl = thumb ? RAW + thumb : '';
        return '<div class="trash-item" data-slug="' + escapeHTML(post.slug) + '">' +
          (thumbUrl ? '<img src="' + escapeHTML(thumbUrl) + '" onerror="this.style.display=\'none\'">' : '') +
          '<div class="trash-item-title">' + escapeHTML(post.title) + '</div>' +
          '<button class="trash-restore-btn">Restore</button>' +
          '<button class="trash-purge-btn">Purge</button>' +
        '</div>';
      }).join('');

      container.querySelectorAll('.trash-restore-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var item = btn.closest('.trash-item');
          var slug = item.getAttribute('data-slug');
          btn.disabled = true;
          btn.textContent = '...';
          ghFetchRaw('metadata/' + slug + '.json').then(function (post) {
            delete post.deleted;
            post.photos.forEach(function (p) { delete p.deleted; });
            return commitPostUpdate(post, 'Restore: ' + post.title);
          }).then(function () { item.remove(); })
          .catch(function (err) { alert('Error: ' + err.message); btn.disabled = false; btn.textContent = 'Restore'; });
        });
      });

      container.querySelectorAll('.trash-purge-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var item = btn.closest('.trash-item');
          var slug = item.getAttribute('data-slug');
          if (!confirm('Permanently delete "' + slug + '"? This cannot be undone.')) return;
          btn.disabled = true;
          btn.textContent = '...';
          ghFetchRaw('metadata/' + slug + '.json').then(function (post) {
            var files = [];
            (post.photos || []).forEach(function (photo) {
              if (photo.web) {
                files.push({ path: photo.web, sha: null });
                var thumbName = photo.web.split('/').pop().replace(/\.\w+$/, '.png');
                files.push({ path: 'files/thumbs/' + thumbName, sha: null });
              }
            });
            files.push({ path: 'metadata/' + slug + '.json', sha: null });
            files.push({ path: 'posts/' + slug + '.md', sha: null });
            return ghCreateCommitWithRetry(files, 'Purge: ' + slug);
          }).then(function () { item.remove(); })
          .catch(function (err) { alert('Error: ' + err.message); btn.disabled = false; btn.textContent = 'Purge'; });
        });
      });
    }).catch(function (err) {
      overlay.querySelector('#trash-grid-content').innerHTML = '<p>Error: ' + escapeHTML(err.message) + '</p>';
    });
  }

  // --- Add Post Dialog ---

  function generateSlug(title) {
    return title.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'photo';
  }

  function openAddDialog() {
    var today = new Date().toISOString().slice(0, 10);
    var overlay = document.createElement('div');
    overlay.className = 'editor-dialog-overlay open';
    overlay.innerHTML =
      '<div class="editor-dialog add-dialog">' +
        '<h3>Add new post</h3>' +
        '<div class="add-photo-buttons">' +
          '<button class="btn-icon-action" id="add-camera" title="Take photo">' +
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>' +
          '</button>' +
          '<button class="btn-icon-action" id="add-gallery" title="Choose from gallery">' +
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="add-previews" id="add-previews"></div>' +
        '<input type="file" id="add-camera-input" accept="image/*" capture="environment" style="display:none">' +
        '<input type="file" id="add-gallery-input" accept="image/*" multiple style="display:none">' +
        '<label>Date</label><input type="text" id="add-date" value="' + today + '" placeholder="YYYY-MM-DD"><br>' +
        '<label>Title</label><input type="text" id="add-title" value="' + today + '"><br>' +
        '<label>Caption</label><textarea id="add-caption" rows="3"></textarea><br>' +
        '<label>Tags</label><input type="text" id="add-tags" value="photoblog"><br>' +
        '<div class="dialog-actions"><button class="btn-cancel">Cancel</button><button class="btn-primary" id="add-submit">Add post</button></div>' +
      '</div>';

    document.body.appendChild(overlay);
    overlay.querySelector('.btn-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    var cameraInput = overlay.querySelector('#add-camera-input');
    var galleryInput = overlay.querySelector('#add-gallery-input');
    var previews = overlay.querySelector('#add-previews');
    var selectedFiles = [];

    overlay.querySelector('#add-camera').addEventListener('click', function () { cameraInput.click(); });
    overlay.querySelector('#add-gallery').addEventListener('click', function () { galleryInput.click(); });

    cameraInput.addEventListener('change', function () { addFilesToList(cameraInput.files); });
    galleryInput.addEventListener('change', function () { addFilesToList(galleryInput.files); });

    function addFilesToList(fileList) {
      for (var i = 0; i < fileList.length; i++) {
        if (!fileList[i].type.startsWith('image/')) continue;
        selectedFiles.push(fileList[i]);
        (function (file) {
          var reader = new FileReader();
          reader.onload = function (ev) {
            var thumb = document.createElement('div');
            thumb.className = 'add-preview-thumb';
            thumb.innerHTML = '<img src="' + ev.target.result + '"><button class="add-preview-remove">&times;</button>';
            thumb.querySelector('.add-preview-remove').addEventListener('click', function (e) {
              e.stopPropagation();
              var idx = selectedFiles.indexOf(file);
              if (idx >= 0) selectedFiles.splice(idx, 1);
              thumb.remove();
            });
            previews.appendChild(thumb);
          };
          reader.readAsDataURL(file);
        })(fileList[i]);
      }
    }

    overlay.querySelector('#add-submit').addEventListener('click', function () {
      var btn = overlay.querySelector('#add-submit');
      var date = overlay.querySelector('#add-date').value.trim();
      var title = overlay.querySelector('#add-title').value.trim() || date;
      var caption = overlay.querySelector('#add-caption').value;
      var tags = overlay.querySelector('#add-tags').value;

      if (!date || selectedFiles.length === 0) {
        alert('Date and at least one photo are required.');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Uploading...';

      // Auto-generate slug from title, check for duplicates
      var slugName = generateSlug(title);
      var datePart = date.replace(/-/g, '').slice(0, 8);

      // Check for duplicate slugs via metadata listing
      ghRequest('/repos/' + REPO + '/contents/metadata').then(function (metaFiles) {
        var existingSlugs = metaFiles.map(function (f) { return f.name.replace('.json', ''); });
        var baseSlug = datePart + '_' + slugName;
        var newSlug = baseSlug;
        var counter = 2;
        while (existingSlugs.indexOf(newSlug) !== -1) {
          newSlug = baseSlug + '_' + counter;
          counter++;
        }

        var files = [];
        var photos = [];

        // Process images: resize via OffscreenCanvas, encode as base64
        var imgChain = Promise.resolve();
        selectedFiles.forEach(function (file, seq) {
          imgChain = imgChain.then(function () {
            return createImageBitmap(file).then(function (bitmap) {
              var w = bitmap.width, h = bitmap.height;
              if (w > 1200 || h > 1600) {
                var ratio = Math.min(1200 / w, 1600 / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
              }
              var canvas = new OffscreenCanvas(w, h);
              canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
              bitmap.close();
              return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
            }).then(function (blob) {
              return blob.arrayBuffer();
            }).then(function (buffer) {
              var bytes = new Uint8Array(buffer);
              var binary = '';
              for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
              var b64 = btoa(binary);

              var nn = String(seq + 1).padStart(2, '0');
              var webName = date + '_' + newSlug.replace(/^\d{8}_/, '') + '_' + nn + '.jpg';
              var webRel = 'files/photoblog/' + webName;
              files.push({ path: webRel, content: b64, encoding: 'base64' });

              photos.push({
                web: webRel,
                original: file.name,
                alt: selectedFiles.length > 1 ? title + ' - ' + (seq + 1) : title,
                caption: '',
                status: 'jpeg',
              });
            });
          });
        });

        return imgChain.then(function () {
          var tagList = tags.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
          var post = {
            title: title, date: date, slug: newSlug, caption: caption,
            tags: tagList.length ? tagList : ['photoblog'],
            photos: photos, thumbnail: photos[0].web,
          };
          var md = generateMarkdown(post);
          files.push({ path: 'metadata/' + newSlug + '.json', content: JSON.stringify(post, null, 2) + '\n' });
          if (md) files.push({ path: 'posts/' + newSlug + '.md', content: md });
          return ghCreateCommitWithRetry(files, 'Add post: ' + title);
        });
      }).then(function () { overlay.remove(); showToast('Post added. Site will rebuild in ~2 minutes.'); })
      .catch(function (err) { alert('Error: ' + err.message); btn.disabled = false; btn.textContent = 'Add post'; });
    });
  }

  // --- Init ---

  function init() {
    addLoginButton();
    if (getToken()) {
      // Show save button immediately if there are pending changes (don't wait for API)
      if (getPendingCount() > 0) {
        createSaveButton();
        updateSaveButton();
      }
      // Verify token is still valid, then activate full edit mode
      fetch(API + '/repos/' + REPO, {
        headers: { 'Authorization': 'Bearer ' + getToken(), 'Accept': 'application/vnd.github.v3+json' },
      }).then(function (res) {
        if (res.ok) {
          activateEditMode();
        } else {
          clearToken();
        }
      }).catch(function () {
        // Offline or error, activate anyway if token exists
        activateEditMode();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
