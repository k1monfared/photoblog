// Infinite scroll pagination + off-screen image memory management
(function () {
  var GRID_PAGE = 30;  // 10 rows of 3
  var FEED_PAGE = 10;

  document.addEventListener('DOMContentLoaded', function () {
    var grid = document.getElementById('gallery-grid');
    var feed = document.getElementById('gallery-feed');
    var sentinel = document.getElementById('scroll-sentinel');
    if (!sentinel) return;
    if (!grid && !feed) return;

    var gridItems = grid ? grid.querySelectorAll('.grid-item') : [];
    var feedItems = feed ? feed.querySelectorAll('.feed-card') : [];
    var gridShown = GRID_PAGE;
    var feedShown = FEED_PAGE;

    function showMore() {
      var gridEnd = Math.min(gridShown + GRID_PAGE, gridItems.length);
      for (var i = gridShown; i < gridEnd; i++) {
        gridItems[i].removeAttribute('hidden');
      }
      gridShown = gridEnd;

      var feedEnd = Math.min(feedShown + FEED_PAGE, feedItems.length);
      for (var j = feedShown; j < feedEnd; j++) {
        feedItems[j].removeAttribute('hidden');
      }
      feedShown = feedEnd;

      if (gridShown >= gridItems.length && feedShown >= feedItems.length && paginationObserver) {
        paginationObserver.disconnect();
      }
    }

    var paginationObserver = null;
    if ('IntersectionObserver' in window) {
      paginationObserver = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) showMore();
      }, { rootMargin: '400px' });
      paginationObserver.observe(sentinel);
    } else {
      gridItems.forEach(function (el) { el.removeAttribute('hidden'); });
      feedItems.forEach(function (el) { el.removeAttribute('hidden'); });
    }

    // Expose showAll for timeline scrolling
    window.photoblogShowAll = function () {
      gridItems.forEach(function (el) { el.removeAttribute('hidden'); });
      feedItems.forEach(function (el) { el.removeAttribute('hidden'); });
      gridShown = gridItems.length;
      feedShown = feedItems.length;
      if (paginationObserver) paginationObserver.disconnect();
    };

    // --- Off-screen image memory management ---
    // Null out src for images far off-screen (>3 viewports away)
    // Restore src when they come back near viewport (within 2 viewports)
    if ('IntersectionObserver' in window) {
      var allImages = document.querySelectorAll('.grid-item img, .feed-card .feed-photo');

      // Store original src in data attribute
      allImages.forEach(function (img) {
        if (img.src) img.dataset.src = img.getAttribute('src');
      });

      var memoryObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var img = entry.target;
          if (entry.isIntersecting) {
            // Restore src when coming into extended viewport
            if (!img.getAttribute('src') && img.dataset.src) {
              img.src = img.dataset.src;
            }
          } else {
            // Null out src when far off-screen to free decoded image memory
            if (img.getAttribute('src')) {
              img.removeAttribute('src');
            }
          }
        });
      }, {
        rootMargin: '500% 0px'  // 5 viewports buffer in each direction
      });

      allImages.forEach(function (img) {
        memoryObserver.observe(img);
      });
    }
  });
})();
