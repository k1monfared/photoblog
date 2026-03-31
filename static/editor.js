(function() {
  'use strict';

  var selected = {};
  var isPostPage = !!document.querySelector('.post-detail');
  var isGridPage = !!document.querySelector('.grid-item');

  // --- Helpers ---

  function api(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function(r) { return r.json(); });
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function getSelectedCount() {
    if (isPostPage) {
      var count = 0;
      var postSlug = Object.keys(selected)[0];
      if (postSlug && selected[postSlug]) {
        count = selected[postSlug].length;
      }
      return count;
    }
    return Object.keys(selected).length;
  }

  function updateSelectionMode() {
    var count = getSelectedCount();
    if (count > 0) {
      document.body.classList.add('selection-mode');
    } else {
      document.body.classList.remove('selection-mode');
    }
    updateToolbar();
  }

  function getPostSlug() {
    var el = document.querySelector('.post-detail');
    return el ? el.getAttribute('data-slug') : null;
  }

  function parseDateFromSlug(slug) {
    if (!slug) return '';
    var match = slug.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
    if (match) return match[1] + '-' + match[2] + '-' + match[3];
    return '';
  }

  function closeAllEditors() {
    var editors = document.querySelectorAll('.caption-editor');
    for (var i = 0; i < editors.length; i++) {
      editors[i].parentNode.removeChild(editors[i]);
    }
  }

  function closeDialogs() {
    var overlays = document.querySelectorAll('.editor-dialog-overlay');
    for (var i = 0; i < overlays.length; i++) {
      overlays[i].parentNode.removeChild(overlays[i]);
    }
  }

  // --- 1. Caption Editing (post pages only) ---

  function setupCaptionEditing() {
    if (!isPostPage) return;

    var slug = getPostSlug();
    var postBody = document.querySelector('.post-body');
    var postMeta = document.querySelector('.post-meta');
    if (!postBody || !postMeta) return;

    // Post caption pencil button (after .post-meta)
    var postCaptionBtn = document.createElement('button');
    postCaptionBtn.className = 'caption-edit-btn';
    postCaptionBtn.textContent = '\u270F';
    postCaptionBtn.title = 'Edit post caption';
    postCaptionBtn.addEventListener('click', function() {
      closeAllEditors();
      var currentCaption = getPostCaption();
      openCaptionEditor(postMeta, slug, null, currentCaption);
    });
    postMeta.parentNode.insertBefore(postCaptionBtn, postMeta.nextSibling);

    // Photo caption pencil buttons
    var photoContainers = getPhotoContainers();
    for (var i = 0; i < photoContainers.length; i++) {
      (function(index, container) {
        var btn = document.createElement('button');
        btn.className = 'caption-edit-btn';
        btn.textContent = '\u270F';
        btn.title = 'Edit photo caption';
        btn.addEventListener('click', function() {
          closeAllEditors();
          var currentCaption = getPhotoCaption(container);
          openCaptionEditor(container, slug, index, currentCaption);
        });
        container.parentNode.insertBefore(btn, container.nextSibling);
      })(i, photoContainers[i]);
    }
  }

  function getPhotoContainers() {
    var postBody = document.querySelector('.post-body');
    if (!postBody) return [];
    var paragraphs = postBody.querySelectorAll('p');
    var containers = [];
    for (var i = 0; i < paragraphs.length; i++) {
      if (paragraphs[i].querySelector('img')) {
        containers.push(paragraphs[i]);
      }
    }
    return containers;
  }

  function getPostCaption() {
    var postBody = document.querySelector('.post-body');
    if (!postBody) return '';
    var children = postBody.children;
    var caption = '';
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.querySelector && child.querySelector('img')) break;
      if (child.tagName === 'P') {
        caption += (caption ? '\n' : '') + child.textContent;
      }
    }
    return caption;
  }

  function getPhotoCaption(photoP) {
    var next = photoP.nextElementSibling;
    if (!next) return '';
    if (next.tagName === 'P' && next.querySelector('em')) {
      return next.querySelector('em').textContent;
    }
    if (next.tagName === 'EM') {
      return next.textContent;
    }
    if (next.tagName === 'P' && !next.querySelector('img')) {
      return next.textContent;
    }
    return '';
  }

  function openCaptionEditor(afterElement, slug, photoIndex, currentText) {
    var editor = document.createElement('div');
    editor.className = 'caption-editor';

    var textarea = document.createElement('textarea');
    textarea.value = currentText || '';
    textarea.rows = 3;

    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'caption-save-btn';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'caption-cancel-btn';

    editor.appendChild(textarea);
    editor.appendChild(saveBtn);
    editor.appendChild(cancelBtn);

    afterElement.parentNode.insertBefore(editor, afterElement.nextSibling);

    textarea.focus();

    saveBtn.addEventListener('click', function() {
      api('POST', '/api/caption', {
        slug: slug,
        caption: textarea.value,
        photo_index: photoIndex
      }).then(function(res) {
        if (res.error) {
          alert('Error: ' + res.error);
        } else {
          location.reload();
        }
      });
    });

    cancelBtn.addEventListener('click', function() {
      editor.parentNode.removeChild(editor);
    });
  }

  // --- 2. Selection Mode (Grid pages) ---

  function setupGridSelection() {
    if (!isGridPage) return;

    var items = document.querySelectorAll('.grid-item');
    for (var i = 0; i < items.length; i++) {
      (function(item) {
        var checkbox = document.createElement('div');
        checkbox.className = 'photo-checkbox';
        item.insertBefore(checkbox, item.firstChild);

        checkbox.addEventListener('click', function(e) {
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
          updateSelectionMode();
        });
      })(items[i]);
    }
  }

  // --- 3. Selection Mode (Post pages) ---

  function setupPostSelection() {
    if (!isPostPage) return;

    var postSlug = getPostSlug();
    var photoContainers = getPhotoContainers();

    for (var i = 0; i < photoContainers.length; i++) {
      (function(container, index) {
        var checkbox = document.createElement('div');
        checkbox.className = 'photo-checkbox';
        container.style.position = 'relative';
        container.insertBefore(checkbox, container.firstChild);

        checkbox.addEventListener('click', function(e) {
          e.stopPropagation();
          e.preventDefault();

          if (!selected[postSlug]) {
            selected[postSlug] = [];
          }

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
          updateSelectionMode();
        });
      })(photoContainers[i], i);
    }
  }

  // --- 4. Floating Toolbar ---

  var toolbar = null;

  function createToolbar() {
    toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    toolbar.style.display = 'none';

    if (isGridPage) {
      toolbar.innerHTML =
        '<span class="toolbar-count"></span>' +
        '<button class="toolbar-merge-btn">Merge selected</button>' +
        '<button class="toolbar-delete-btn">Delete selected</button>' +
        '<button class="toolbar-cancel-btn">Cancel</button>';

      toolbar.querySelector('.toolbar-merge-btn').addEventListener('click', openMergeDialog);
      toolbar.querySelector('.toolbar-delete-btn').addEventListener('click', openDeleteDialog);
      toolbar.querySelector('.toolbar-cancel-btn').addEventListener('click', clearSelection);
    } else if (isPostPage) {
      toolbar.innerHTML =
        '<span class="toolbar-count"></span>' +
        '<button class="toolbar-split-btn">Split to new post</button>' +
        '<button class="toolbar-delete-btn">Delete photos</button>' +
        '<button class="toolbar-cancel-btn">Cancel</button>';

      toolbar.querySelector('.toolbar-split-btn').addEventListener('click', openSplitDialog);
      toolbar.querySelector('.toolbar-delete-btn').addEventListener('click', openDeleteDialog);
      toolbar.querySelector('.toolbar-cancel-btn').addEventListener('click', clearSelection);
    }

    document.body.appendChild(toolbar);
  }

  function updateToolbar() {
    if (!toolbar) return;
    var count = getSelectedCount();
    if (count > 0) {
      toolbar.style.display = '';
      var label = isPostPage ? ' photo(s)' : ' post(s)';
      toolbar.querySelector('.toolbar-count').textContent = count + label + ' selected';
    } else {
      toolbar.style.display = 'none';
    }
  }

  function clearSelection() {
    selected = {};
    var checked = document.querySelectorAll('.photo-checkbox.checked');
    for (var i = 0; i < checked.length; i++) {
      checked[i].classList.remove('checked');
    }
    updateSelectionMode();
  }

  // --- 5. Merge Dialog ---

  function openMergeDialog() {
    var slugs = Object.keys(selected);
    if (slugs.length < 2) {
      alert('Select at least 2 posts to merge.');
      return;
    }

    // Find earliest date
    var earliest = '';
    for (var i = 0; i < slugs.length; i++) {
      var d = parseDateFromSlug(slugs[i]);
      if (!earliest || d < earliest) earliest = d;
    }

    // Gather excerpts from grid items
    var excerpts = [];
    for (var j = 0; j < slugs.length; j++) {
      var item = document.querySelector('.grid-item[data-slug="' + slugs[j] + '"]');
      if (item) {
        var excerpt = item.getAttribute('data-excerpt') || '';
        if (excerpt) excerpts.push(excerpt);
      }
    }
    var prefilled = excerpts.join('\n\n---\n\n');

    var overlay = document.createElement('div');
    overlay.className = 'editor-dialog-overlay';
    overlay.innerHTML =
      '<div class="editor-dialog">' +
        '<h3>Merge ' + slugs.length + ' posts</h3>' +
        '<label>Date:<br><input type="date" class="merge-date" value="' + escapeHTML(earliest) + '"></label><br>' +
        '<label>Slug:<br><input type="text" class="merge-slug" placeholder="my_photo_title"></label><br>' +
        '<label>Caption:<br><textarea class="merge-caption" rows="6">' + escapeHTML(prefilled) + '</textarea></label><br>' +
        '<button class="dialog-confirm-btn">Merge</button>' +
        '<button class="dialog-cancel-btn">Cancel</button>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector('.dialog-cancel-btn').addEventListener('click', function() {
      closeDialogs();
    });

    overlay.querySelector('.dialog-confirm-btn').addEventListener('click', function() {
      var date = overlay.querySelector('.merge-date').value;
      var slugName = overlay.querySelector('.merge-slug').value;
      var caption = overlay.querySelector('.merge-caption').value;

      api('POST', '/api/merge', {
        slugs: slugs,
        date: date,
        slug_name: slugName,
        caption: caption
      }).then(function(res) {
        if (res.error) {
          alert('Error: ' + res.error);
        } else if (res.url) {
          window.location.href = res.url;
        } else {
          location.reload();
        }
      });
    });

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeDialogs();
    });
  }

  // --- 6. Split Dialog ---

  function openSplitDialog() {
    var postSlug = getPostSlug();
    var indices = selected[postSlug];
    if (!indices || indices.length === 0) {
      alert('Select at least 1 photo to split.');
      return;
    }

    var dateStr = parseDateFromSlug(postSlug);

    var overlay = document.createElement('div');
    overlay.className = 'editor-dialog-overlay';
    overlay.innerHTML =
      '<div class="editor-dialog">' +
        '<h3>Split ' + indices.length + ' photo(s) to new post</h3>' +
        '<label>Date:<br><input type="date" class="split-date" value="' + escapeHTML(dateStr) + '"></label><br>' +
        '<label>Slug:<br><input type="text" class="split-slug" placeholder="new_post_slug"></label><br>' +
        '<label>Caption:<br><textarea class="split-caption" rows="4"></textarea></label><br>' +
        '<button class="dialog-confirm-btn">Split</button>' +
        '<button class="dialog-cancel-btn">Cancel</button>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector('.dialog-cancel-btn').addEventListener('click', function() {
      closeDialogs();
    });

    overlay.querySelector('.dialog-confirm-btn').addEventListener('click', function() {
      var date = overlay.querySelector('.split-date').value;
      var slugName = overlay.querySelector('.split-slug').value;
      var caption = overlay.querySelector('.split-caption').value;

      api('POST', '/api/split', {
        source_slug: postSlug,
        photo_indices: indices.slice().sort(),
        date: date,
        slug_name: slugName,
        caption: caption
      }).then(function(res) {
        if (res.error) {
          alert('Error: ' + res.error);
        } else if (res.url) {
          window.location.href = res.url;
        } else {
          location.reload();
        }
      });
    });

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeDialogs();
    });
  }

  // --- 7. Delete Dialog ---

  function openDeleteDialog() {
    var count = getSelectedCount();
    var label = isPostPage ? 'photo(s)' : 'post(s)';

    var overlay = document.createElement('div');
    overlay.className = 'editor-dialog-overlay';
    overlay.innerHTML =
      '<div class="editor-dialog">' +
        '<h3>Delete ' + count + ' ' + label + '?</h3>' +
        '<p>They will be moved to trash.</p>' +
        '<button class="dialog-confirm-btn">Delete</button>' +
        '<button class="dialog-cancel-btn">Cancel</button>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector('.dialog-cancel-btn').addEventListener('click', function() {
      closeDialogs();
    });

    overlay.querySelector('.dialog-confirm-btn').addEventListener('click', function() {
      var payload = {};

      if (isPostPage) {
        var postSlug = getPostSlug();
        payload.slugs = [postSlug];
        payload.photo_indices = selected[postSlug] ? selected[postSlug].slice().sort() : [];
      } else {
        payload.slugs = Object.keys(selected);
      }

      api('POST', '/api/delete', payload).then(function(res) {
        if (res.error) {
          alert('Error: ' + res.error);
        } else {
          location.reload();
        }
      });
    });

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeDialogs();
    });
  }

  // --- 8. Trash Button + View ---

  function setupTrashUI() {
    var nav = document.querySelector('header nav');
    if (!nav) return;

    // "Show deleted" toggle
    var showDeletedBtn = document.createElement('button');
    showDeletedBtn.className = 'nav-show-deleted-btn';
    showDeletedBtn.textContent = 'Show deleted';
    var showingDeleted = false;

    showDeletedBtn.addEventListener('click', function() {
      showingDeleted = !showingDeleted;
      showDeletedBtn.textContent = showingDeleted ? 'Hide deleted' : 'Show deleted';
      var deletedItems = document.querySelectorAll('.grid-item.deleted, .feed-card.deleted');
      for (var i = 0; i < deletedItems.length; i++) {
        deletedItems[i].style.display = showingDeleted ? '' : 'none';
      }
    });

    // "Trash" button
    var trashBtn = document.createElement('button');
    trashBtn.className = 'nav-trash-btn';
    trashBtn.textContent = 'Trash';

    trashBtn.addEventListener('click', function() {
      openTrashDialog();
    });

    // "Merge" button — enabled when 2+ posts selected
    var mergeBtn = document.createElement('button');
    mergeBtn.className = 'nav-show-deleted-btn';
    mergeBtn.textContent = 'Merge';
    mergeBtn.title = 'Select 2+ posts then click to merge them';
    mergeBtn.addEventListener('click', function() {
      var count = getSelectedCount();
      if (count < 2) {
        alert('Select 2 or more posts first (click checkboxes on photos in the grid).');
        return;
      }
      openMergeDialog();
    });

    // "Delete" button — enabled when 1+ selected
    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'nav-show-deleted-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.title = 'Select posts then click to delete them';
    deleteBtn.addEventListener('click', function() {
      var count = getSelectedCount();
      if (count < 1) {
        alert('Select one or more posts first (click checkboxes on photos in the grid).');
        return;
      }
      if (isPostPage) {
        var indices = selected[postSlug] || [];
        openDeleteDialog(null, indices);
      } else {
        openDeleteDialog(Object.keys(selected), null);
      }
    });

    nav.appendChild(mergeBtn);
    nav.appendChild(deleteBtn);
    nav.appendChild(showDeletedBtn);
    nav.appendChild(trashBtn);
  }

  function openTrashDialog() {
    api('GET', '/api/trash').then(function(data) {
      var items = data.items || data.posts || data || [];
      if (!Array.isArray(items)) items = [];

      var overlay = document.createElement('div');
      overlay.className = 'editor-dialog-overlay';

      var html = '<div class="editor-dialog trash-dialog">' +
        '<h3>Trash</h3>' +
        '<div class="trash-grid">';

      if (items.length === 0) {
        html += '<p>Trash is empty.</p>';
      }

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var thumbSrc = item.thumbnail || item.thumb || '';
        var title = item.title || item.slug || '';
        html += '<div class="trash-item" data-slug="' + escapeHTML(item.slug || '') + '">' +
          (thumbSrc ? '<img src="' + escapeHTML(thumbSrc) + '" alt="' + escapeHTML(title) + '">' : '') +
          '<div class="trash-item-title">' + escapeHTML(title) + '</div>' +
          '<button class="trash-restore-btn">Restore</button>' +
          '<button class="trash-purge-btn">Permanently delete</button>' +
        '</div>';
      }

      html += '</div>' +
        '<button class="dialog-cancel-btn">Close</button>' +
        '</div>';

      overlay.innerHTML = html;
      document.body.appendChild(overlay);

      // Restore buttons
      var restoreBtns = overlay.querySelectorAll('.trash-restore-btn');
      for (var r = 0; r < restoreBtns.length; r++) {
        restoreBtns[r].addEventListener('click', function() {
          var trashItem = this.closest('.trash-item');
          var slug = trashItem.getAttribute('data-slug');
          api('POST', '/api/restore', { slugs: [slug] }).then(function(res) {
            if (res.error) {
              alert('Error: ' + res.error);
            } else {
              trashItem.parentNode.removeChild(trashItem);
            }
          });
        });
      }

      // Purge buttons
      var purgeBtns = overlay.querySelectorAll('.trash-purge-btn');
      for (var p = 0; p < purgeBtns.length; p++) {
        purgeBtns[p].addEventListener('click', function() {
          var trashItem = this.closest('.trash-item');
          var slug = trashItem.getAttribute('data-slug');
          if (confirm('Permanently delete "' + slug + '"? This cannot be undone.')) {
            api('POST', '/api/purge', { slugs: [slug] }).then(function(res) {
              if (res.error) {
                alert('Error: ' + res.error);
              } else {
                trashItem.parentNode.removeChild(trashItem);
              }
            });
          }
        });
      }

      overlay.querySelector('.dialog-cancel-btn').addEventListener('click', function() {
        closeDialogs();
      });

      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeDialogs();
      });
    });
  }

  // --- 9. Hide deleted items by default ---

  function hideDeletedItems() {
    var deletedItems = document.querySelectorAll('.grid-item.deleted, .feed-card.deleted');
    for (var i = 0; i < deletedItems.length; i++) {
      deletedItems[i].style.display = 'none';
    }
  }

  // --- 9. Add Post ---

  function setupAddButton() {
    var nav = document.querySelector('header nav');
    if (!nav) return;

    var addBtn = document.createElement('button');
    addBtn.className = 'nav-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add new post';
    addBtn.addEventListener('click', openAddDialog);

    // Insert before Show deleted button
    var showDelBtn = nav.querySelector('.nav-show-deleted-btn');
    if (showDelBtn) {
      nav.insertBefore(addBtn, showDelBtn);
    } else {
      nav.appendChild(addBtn);
    }
  }

  function openAddDialog() {
    var today = new Date().toISOString().slice(0, 10);
    var overlay = document.createElement('div');
    overlay.className = 'editor-dialog-overlay open';

    overlay.innerHTML =
      '<div class="editor-dialog add-dialog">' +
      '<h3>Add new post</h3>' +
      '<label>Photos</label>' +
      '<div class="add-dropzone" id="add-dropzone">' +
      '<input type="file" id="add-files" multiple accept="image/*" style="display:none">' +
      '<p class="dropzone-text">Click to choose photos or drag and drop</p>' +
      '<div class="add-previews" id="add-previews"></div>' +
      '</div>' +
      '<label>Date</label>' +
      '<input type="date" id="add-date" value="' + today + '">' +
      '<label>Slug (lowercase letters, numbers, underscores)</label>' +
      '<input type="text" id="add-slug" placeholder="my_photo">' +
      '<label>Title</label>' +
      '<input type="text" id="add-title" placeholder="' + today + '" value="' + today + '">' +
      '<label>Caption</label>' +
      '<textarea id="add-caption" placeholder="Optional caption..."></textarea>' +
      '<label>Tags (comma-separated)</label>' +
      '<input type="text" id="add-tags" value="photoblog">' +
      '<div class="dialog-actions">' +
      '<button class="btn-cancel">Cancel</button>' +
      '<button class="btn-primary" id="add-submit">Add post</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    var fileInput = overlay.querySelector('#add-files');
    var dropzone = overlay.querySelector('#add-dropzone');
    var previews = overlay.querySelector('#add-previews');
    var selectedFiles = [];

    // Click dropzone to open file picker
    dropzone.addEventListener('click', function(e) {
      if (e.target === fileInput) return;
      fileInput.click();
    });

    // Drag and drop
    dropzone.addEventListener('dragover', function(e) {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', function() {
      dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', function(e) {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      addFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', function() {
      addFiles(fileInput.files);
    });

    function addFiles(fileList) {
      for (var i = 0; i < fileList.length; i++) {
        var f = fileList[i];
        if (!f.type.startsWith('image/')) continue;
        selectedFiles.push(f);
        var reader = new FileReader();
        (function(file) {
          reader.onload = function(ev) {
            var thumb = document.createElement('div');
            thumb.className = 'add-preview-thumb';
            thumb.innerHTML = '<img src="' + ev.target.result + '">' +
              '<span class="add-preview-name">' + escapeHTML(file.name) + '</span>' +
              '<button class="add-preview-remove" title="Remove">&times;</button>';
            thumb.querySelector('.add-preview-remove').addEventListener('click', function(e) {
              e.stopPropagation();
              var idx = selectedFiles.indexOf(file);
              if (idx >= 0) selectedFiles.splice(idx, 1);
              thumb.parentNode.removeChild(thumb);
              updateDropzoneText();
            });
            previews.appendChild(thumb);
            updateDropzoneText();
          };
          reader.readAsDataURL(file);
        })(f);
      }
    }

    function updateDropzoneText() {
      var text = dropzone.querySelector('.dropzone-text');
      if (selectedFiles.length > 0) {
        text.textContent = selectedFiles.length + ' photo(s) selected. Click to add more.';
      } else {
        text.textContent = 'Click to choose photos or drag and drop';
      }
    }

    // Cancel
    overlay.querySelector('.btn-cancel').addEventListener('click', function() {
      document.body.removeChild(overlay);
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) document.body.removeChild(overlay);
    });

    // Submit
    overlay.querySelector('#add-submit').addEventListener('click', function() {
      var date = overlay.querySelector('#add-date').value;
      var slugName = overlay.querySelector('#add-slug').value.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
      var title = overlay.querySelector('#add-title').value || date;
      var caption = overlay.querySelector('#add-caption').value;
      var tags = overlay.querySelector('#add-tags').value;

      if (!date || !slugName) {
        alert('Date and slug are required.');
        return;
      }
      if (selectedFiles.length === 0) {
        alert('Please select at least one photo.');
        return;
      }

      // Read all files as base64
      var submitBtn = overlay.querySelector('#add-submit');
      submitBtn.textContent = 'Uploading...';
      submitBtn.disabled = true;

      var fileData = [];
      var loaded = 0;

      for (var i = 0; i < selectedFiles.length; i++) {
        (function(file, idx) {
          var reader = new FileReader();
          reader.onload = function(ev) {
            // ev.target.result is "data:image/jpeg;base64,XXXX"
            var b64 = ev.target.result.split(',')[1];
            fileData[idx] = { name: file.name, data: b64 };
            loaded++;
            if (loaded === selectedFiles.length) {
              // All files read, send to API
              api('POST', '/api/add', {
                date: date,
                slug_name: slugName,
                title: title,
                caption: caption,
                tags: tags,
                files: fileData
              }).then(function(res) {
                if (res.error) {
                  alert('Error: ' + res.error);
                  submitBtn.textContent = 'Add post';
                  submitBtn.disabled = false;
                } else {
                  document.body.removeChild(overlay);
                  window.location.href = res.url || '/';
                }
              });
            }
          };
          reader.readAsDataURL(file);
        })(selectedFiles[i], i);
      }
    });
  }

  // --- Initialization ---

  function init() {
    hideDeletedItems();
    setupTrashUI();
    setupAddButton();
    createToolbar();

    if (isPostPage) {
      setupCaptionEditing();
      setupPostSelection();
    }

    if (isGridPage) {
      setupGridSelection();
    }
  }

  init();

})();
