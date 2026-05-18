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



  const aiForm = $('#aiAskForm');
  const aiQuestion = $('#aiQuestion');
  const aiAnswer = $('#aiAnswer');

  function apiBase() {
    return String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  }

  function showAiAnswer(text, type = '', citations = []) {
    if (!aiAnswer) return;
    aiAnswer.hidden = false;
    aiAnswer.className = 'ai-answer' + (type ? ' ' + type : '');
    aiAnswer.textContent = text;

    if (Array.isArray(citations) && citations.length) {
      const refs = document.createElement('div');
      refs.className = 'ai-citations';
      refs.innerHTML = '<strong>Fuentes:</strong> ' + citations
        .slice(0, 4)
        .map((item) => {
          const page = Number(item.page || item.pagina || 0);
          if (!page) return '';
          return `<a href="#page-${page}">Página ${page}</a>`;
        })
        .filter(Boolean)
        .join(' · ');
      aiAnswer.appendChild(refs);
    }
  }

  aiForm?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const question = String(aiQuestion?.value || '').trim();
    if (question.length < 4) {
      showAiAnswer('Escribí una pregunta un poco más completa.', 'error');
      return;
    }

    const btn = aiForm.querySelector('button');
    if (btn) btn.disabled = true;
    showAiAnswer('Consultando el reglamento…', 'loading');

    try {
      const res = await fetch(apiBase() + '/api/reglamento/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'No se pudo consultar la IA.');
      showAiAnswer(data.answer || 'No encontré una respuesta clara en el reglamento.', '', data.citations || []);
    } catch (err) {
      showAiAnswer(err.message || 'No se pudo consultar la IA.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  setActive();
})();
