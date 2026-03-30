// View toggle: grid vs feed
(function () {
  var KEY = 'photoblog-view';

  function applyView(mode) {
    var grid = document.getElementById('gallery-grid');
    var feed = document.getElementById('gallery-feed');
    var gridBtn = document.getElementById('view-grid');
    var feedBtn = document.getElementById('view-feed');
    if (!grid || !feed) return;

    if (mode === 'feed') {
      grid.style.display = 'none';
      feed.style.display = '';
      if (gridBtn) gridBtn.classList.remove('active');
      if (feedBtn) feedBtn.classList.add('active');
    } else {
      grid.style.display = '';
      feed.style.display = 'none';
      if (gridBtn) gridBtn.classList.add('active');
      if (feedBtn) feedBtn.classList.remove('active');
    }
    try { localStorage.setItem(KEY, mode); } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', function () {
    var saved = 'grid';
    try { saved = localStorage.getItem(KEY) || 'grid'; } catch (e) {}
    applyView(saved);

    var gridBtn = document.getElementById('view-grid');
    var feedBtn = document.getElementById('view-feed');
    if (gridBtn) gridBtn.addEventListener('click', function () { applyView('grid'); });
    if (feedBtn) feedBtn.addEventListener('click', function () { applyView('feed'); });
  });
})();
