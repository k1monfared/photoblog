(function () {
  var PAGE_SIZE = 10;
  document.addEventListener('DOMContentLoaded', function () {
    var list = document.querySelector('.post-list');
    if (!list) return;
    var items = list.querySelectorAll('li');
    var shown = PAGE_SIZE;
    if (items.length <= PAGE_SIZE) return;

    function showMore() {
      var end = Math.min(shown + PAGE_SIZE, items.length);
      for (var i = shown; i < end; i++) {
        items[i].removeAttribute('hidden');
      }
      shown = end;
      if (shown >= items.length && sentinel) {
        sentinel.remove();
        sentinel = null;
      }
    }

    // Sentinel element at end of list to trigger loading
    var sentinel = document.createElement('div');
    sentinel.className = 'scroll-sentinel';
    list.after(sentinel);

    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) showMore();
      }, { rootMargin: '200px' });
      observer.observe(sentinel);
    } else {
      // Fallback: show all
      for (var i = PAGE_SIZE; i < items.length; i++) {
        items[i].removeAttribute('hidden');
      }
    }
  });
})();
