// Lightbox: click any image in a post to view it fullscreen
(function () {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = '<img class="lightbox-img"><button class="lightbox-close">&times;</button>';
  document.body.appendChild(overlay);

  const img = overlay.querySelector('.lightbox-img');
  const closeBtn = overlay.querySelector('.lightbox-close');

  function open(src) {
    img.src = src;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Click on any image inside article
  document.querySelectorAll('article img').forEach(el => {
    el.style.cursor = 'zoom-in';
    el.addEventListener('click', () => open(el.src));
  });

  // Close on overlay click, close button, or Escape
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === closeBtn) close();
  });
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
})();
