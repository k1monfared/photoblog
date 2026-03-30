// --- Tag sidebar ---
const toggle = document.getElementById('tag-sidebar-toggle');
const sidebar = document.getElementById('tag-sidebar');
if (toggle && sidebar) {
  const KEY = 'tag-sidebar-state';
  const sortBtn = document.getElementById('tag-sort');

  function getName(el) {
    const link = el.tagName === 'A' ? el : el.querySelector('summary a, summary .tag-sidebar-label');
    return link ? link.textContent.replace(/\d+\s*$/, '').trim() : '';
  }

  function getCount(el) {
    const span = el.querySelector('.tag-count');
    return span ? parseInt(span.textContent) : 0;
  }

  const byAlpha = (a, b) => getName(a).localeCompare(getName(b));
  const byCount = (a, b) => getCount(b) - getCount(a) || getName(a).localeCompare(getName(b));

  function sortLevel(parent, cmp) {
    const items = Array.from(parent.children).filter(el =>
      el.tagName === 'DETAILS' || (el.tagName === 'A' && el.classList.contains('tag-sidebar-link'))
    );
    const otherIdx = items.findIndex(el => {
      const label = el.querySelector && el.querySelector('summary .tag-sidebar-label');
      return label && label.textContent.trim().startsWith('Other');
    });
    let other = null;
    if (otherIdx >= 0) other = items.splice(otherIdx, 1)[0];
    items.sort(cmp);
    if (other) items.push(other);
    items.forEach(el => parent.appendChild(el));
    items.filter(el => el.tagName === 'DETAILS').forEach(d => sortLevel(d, cmp));
  }

  function applySort(mode) {
    sortLevel(sidebar, mode === 'alpha' ? byAlpha : byCount);
    if (sortBtn) {
      sortBtn.textContent = mode === 'alpha' ? '#' : 'A-Z';
      sortBtn.title = mode === 'alpha' ? 'Sort by count' : 'Sort alphabetically';
    }
  }

  function saveState() {
    const state = {
      open: sidebar.classList.contains('open'),
      details: Array.from(sidebar.querySelectorAll('details')).map(d => d.open),
      sort: sortBtn && sortBtn.textContent === '#' ? 'alpha' : 'count'
    };
    sessionStorage.setItem(KEY, JSON.stringify(state));
  }

  let initialSort = 'count';
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY));
    if (saved) {
      if (saved.open) sidebar.classList.add('open');
      if (saved.sort) initialSort = saved.sort;
      const details = sidebar.querySelectorAll('details');
      saved.details.forEach((isOpen, i) => {
        if (details[i]) details[i].open = isOpen;
      });
    }
  } catch (e) {}

  if (initialSort === 'alpha') applySort('alpha');

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.toggle('open');
    saveState();
  });

  document.addEventListener('click', (e) => {
    if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== toggle) {
      sidebar.classList.remove('open');
      saveState();
    }
  });

  sidebar.querySelectorAll('details').forEach(d => {
    d.addEventListener('toggle', saveState);
  });

  sidebar.querySelectorAll('summary a').forEach(a => {
    a.addEventListener('click', e => e.stopPropagation());
  });

  if (sortBtn) {
    sortBtn.addEventListener('click', () => {
      const newMode = sortBtn.textContent === 'A-Z' ? 'alpha' : 'count';
      applySort(newMode);
      saveState();
    });
  }
}

// --- Timeline sidebar (slider style) ---
const tlToggle = document.getElementById('timeline-sidebar-toggle');
const tlSidebar = document.getElementById('timeline-sidebar');
if (tlToggle && tlSidebar) {
  const TL_KEY = 'timeline-sidebar-state';

  function tlSave() {
    sessionStorage.setItem(TL_KEY, JSON.stringify({
      open: tlSidebar.classList.contains('open')
    }));
  }

  try {
    const saved = JSON.parse(sessionStorage.getItem(TL_KEY));
    if (saved && saved.open) tlSidebar.classList.add('open');
  } catch (e) {}

  tlToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    tlSidebar.classList.toggle('open');
    if (sidebar && tlSidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      if (typeof saveState === 'function') saveState();
    }
    tlSave();
  });

  if (toggle) {
    toggle.addEventListener('click', () => {
      if (tlSidebar.classList.contains('open')) {
        tlSidebar.classList.remove('open');
        tlSave();
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (tlSidebar.classList.contains('open') && !tlSidebar.contains(e.target) && e.target !== tlToggle) {
      tlSidebar.classList.remove('open');
      tlSave();
    }
  });

  // Click year or month to scroll to that section in grid/feed
  function scrollToDate(target) {
    var isMonth = target.split('-').length === 3;
    var attr = isMonth ? 'data-month' : 'data-year';

    // Show all items first (pagination may be hiding them)
    if (window.photoblogShowAll) window.photoblogShowAll();

    // Find first matching element in whichever view is visible
    var el = document.querySelector('.grid-item[' + attr + '="' + target + '"]') ||
             document.querySelector('.feed-card[' + attr + '="' + target + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  tlSidebar.querySelectorAll('.tl-year-label').forEach(function (label) {
    var year = label.closest('.tl-year');
    if (year) {
      label.addEventListener('click', function () {
        scrollToDate(year.dataset.scroll);
      });
    }
  });

  tlSidebar.querySelectorAll('.tl-month').forEach(function (month) {
    month.addEventListener('click', function () {
      scrollToDate(month.dataset.scroll);
    });
  });
}
