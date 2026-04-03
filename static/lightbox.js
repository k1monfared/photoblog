// Lightbox for post page images + carousel modal for grid items
(function () {
  // --- Lightbox for post detail page ---
  var overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = '<img class="lightbox-img"><button class="lightbox-close">&times;</button>';
  document.body.appendChild(overlay);

  var lbImg = overlay.querySelector('.lightbox-img');
  var lbClose = overlay.querySelector('.lightbox-close');

  function lbOpen(src) {
    lbImg.src = src;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    history.pushState({ modal: 'lightbox' }, '');
  }

  function lbCloseFn() {
    if (!overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('.post-body img').forEach(function (el) {
    el.style.cursor = 'zoom-in';
    el.addEventListener('click', function () { lbOpen(el.src); });
  });

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay || e.target === lbClose) lbCloseFn();
  });
  lbClose.addEventListener('click', lbCloseFn);

  // --- Carousel modal for grid items ---
  var modal = document.getElementById('post-modal');
  if (!modal) return;

  var modalImg = modal.querySelector('.modal-img');
  var modalTitle = modal.querySelector('.modal-title');
  var modalDate = modal.querySelector('.modal-date');
  var modalPostCaption = modal.querySelector('#modal-post-caption');
  var modalPhotoCaption = modal.querySelector('#modal-photo-caption');
  var modalTags = modal.querySelector('.modal-tags');
  var modalLink = modal.querySelector('.modal-link');
  var modalClose = modal.querySelector('.modal-close');
  var prevBtn = modal.querySelector('.carousel-prev');
  var nextBtn = modal.querySelector('.carousel-next');
  var dotsContainer = modal.querySelector('#carousel-dots');
  var counter = modal.querySelector('#carousel-counter');

  var images = [];
  var captions = [];
  var currentIdx = 0;

  function updateCarousel() {
    if (images.length === 0) return;
    modalImg.src = images[currentIdx];
    // Update dots
    var dots = dotsContainer.querySelectorAll('.carousel-dot');
    dots.forEach(function (d, i) {
      d.classList.toggle('active', i === currentIdx);
    });
    // Update counter
    counter.textContent = (currentIdx + 1) + ' / ' + images.length;
    // Show/hide prev/next
    prevBtn.classList.toggle('visible', currentIdx > 0);
    nextBtn.classList.toggle('visible', currentIdx < images.length - 1);
    // Update per-photo caption (use child span to preserve edit buttons)
    var cap = captions[currentIdx] || '';
    var captionSpan = modalPhotoCaption.querySelector('.caption-text');
    if (captionSpan) {
      captionSpan.textContent = cap;
    } else {
      modalPhotoCaption.textContent = cap;
    }
    // In edit mode, always show the caption area (for the edit button)
    var inEditMode = document.body.classList.contains('edit-mode');
    modalPhotoCaption.style.display = (cap || inEditMode) ? '' : 'none';
  }

  function openModal(item) {
    // Parse images from data attribute
    try {
      images = JSON.parse(item.dataset.images || '[]');
    } catch (e) {
      images = [];
    }
    if (images.length === 0) {
      var img = item.querySelector('img');
      images = img && img.dataset.src ? [img.dataset.src] : (img ? [img.src] : []);
    }

    // Parse per-photo captions
    try {
      captions = JSON.parse(item.dataset.captions || '[]');
    } catch (e) {
      captions = [];
    }

    currentIdx = 0;

    modalTitle.textContent = item.dataset.title || '';
    modalDate.textContent = item.dataset.date || '';
    // Post caption (persistent across all photos)
    var postCap = item.dataset.postCaption || item.dataset.excerpt || '';
    modalPostCaption.textContent = postCap;
    modalPostCaption.style.display = postCap ? '' : 'none';
    modalTags.innerHTML = item.dataset.tags || '';
    modalLink.href = item.dataset.url || '';

    // Build dots
    dotsContainer.innerHTML = '';
    if (images.length > 1) {
      images.forEach(function (_, i) {
        var dot = document.createElement('button');
        dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', 'Image ' + (i + 1));
        dot.addEventListener('click', function () {
          currentIdx = i;
          updateCarousel();
        });
        dotsContainer.appendChild(dot);
      });
      dotsContainer.classList.add('visible');
      counter.classList.add('visible');
    } else {
      dotsContainer.classList.remove('visible');
      counter.classList.remove('visible');
    }

    updateCarousel();
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    history.pushState({ modal: 'carousel' }, '');
  }

  function closeModal() {
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
    prevBtn.classList.remove('visible');
    nextBtn.classList.remove('visible');
    dotsContainer.classList.remove('visible');
    counter.classList.remove('visible');
  }

  // Click grid items to open modal
  document.querySelectorAll('.grid-item').forEach(function (item) {
    item.addEventListener('click', function () { openModal(item); });
  });

  // Carousel navigation
  prevBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (currentIdx > 0) { currentIdx--; updateCarousel(); }
  });

  nextBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (currentIdx < images.length - 1) { currentIdx++; updateCarousel(); }
  });

  // Close modal
  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  // Keyboard: left/right arrows for carousel, escape to close
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      lbCloseFn();
      if (modal.classList.contains('open')) closeModal();
    }
    if (!modal.classList.contains('open')) return;
    if (e.key === 'ArrowLeft' && currentIdx > 0) {
      currentIdx--;
      updateCarousel();
    }
    if (e.key === 'ArrowRight' && currentIdx < images.length - 1) {
      currentIdx++;
      updateCarousel();
    }
  });

  // Touch swipe in modal for carousel
  var startX = null, startT = null;
  modal.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1 || images.length <= 1) return;
    startX = e.touches[0].clientX;
    startT = Date.now();
  }, { passive: true });

  modal.addEventListener('touchend', function (e) {
    if (startX == null) return;
    var dx = e.changedTouches[0].clientX - startX;
    var dt = Date.now() - startT;
    startX = null;
    if (dt > 600 || Math.abs(dx) < 50) return;
    if (dx < 0 && currentIdx < images.length - 1) { currentIdx++; updateCarousel(); }
    if (dx > 0 && currentIdx > 0) { currentIdx--; updateCarousel(); }
  }, { passive: true });

  // Back button closes modals
  window.addEventListener('popstate', function (e) {
    if (overlay.classList.contains('open')) { lbCloseFn(); return; }
    if (modal && modal.classList.contains('open')) { closeModal(); return; }
  });
})();
