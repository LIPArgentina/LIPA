(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const sidebar = $('#sidebar');
  const menuBtn = $('#menuBtn');
  const search = $('#searchInput');
  const noResults = $('#noResults');
  const toTop = $('#toTop');
  const cards = $$('.page-card');
  const tocLinks = $$('.toc-link');

  function setActive() {
    let current = null;
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      if (r.top < 140) current = card;
    }
    if (!current) return;
    const page = current.dataset.page;
    tocLinks.forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  }

  window.addEventListener('scroll', () => {
    setActive();
    toTop.classList.toggle('show', window.scrollY > 500);
  });

  menuBtn?.addEventListener('click', () => {
    const open = sidebar.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  tocLinks.forEach((a) => a.addEventListener('click', () => {
    sidebar.classList.remove('open');
    menuBtn?.setAttribute('aria-expanded', 'false');
  }));

  toTop?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function clearMarks(el) {
    el.querySelectorAll('mark.mark').forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
    el.normalize();
  }

  function markText(el, q) {
    if (!q) return;
    const re = new RegExp(escapeRegExp(q), 'gi');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        return n.parentElement.closest('mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      if (!re.test(n.nodeValue)) continue;
      re.lastIndex = 0;
      const span = document.createElement('span');
      span.innerHTML = n.nodeValue.replace(re, (m) => `<mark class="mark">${m}</mark>`);
      n.replaceWith(span);
    }
  }

  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let count = 0;
    cards.forEach((card) => {
      clearMarks(card);
      const hit = !q || card.textContent.toLowerCase().includes(q);
      card.hidden = !hit;
      card.classList.toggle('is-match', !!q && hit);
      if (hit) {
        count++;
        if (q) markText(card, q);
      }
    });
    noResults.hidden = count !== 0;
  });

  setActive();
})();
