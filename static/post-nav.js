// Keyboard arrow keys + touch swipe for post navigation
(function () {
  var prev = document.querySelector('.post-nav-prev');
  var next = document.querySelector('.post-nav-next');
  if (!prev && !next) return;

  // Arrow keys
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft' && prev) window.location.href = prev.href;
    if (e.key === 'ArrowRight' && next) window.location.href = next.href;
  });

  // Touch swipe (deep swipe = >100px, fast = <300ms)
  var startX, startT;
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startT = Date.now();
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    if (startX == null) return;
    var dx = e.changedTouches[0].clientX - startX;
    var dt = Date.now() - startT;
    startX = null;
    if (dt > 600 || Math.abs(dx) < 100) return;
    if (dx > 0 && next) window.location.href = next.href;
    if (dx < 0 && prev) window.location.href = prev.href;
  }, { passive: true });
})();
