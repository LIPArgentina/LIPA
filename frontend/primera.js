(() => {
  'use strict';

  const API_BASE = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const statusBox = document.getElementById('rankingStatus');
  const tableWrap = document.getElementById('rankingTableWrap');
  const rowsBox = document.getElementById('rankingRows');
  const metaBox = document.getElementById('rankingMeta');
  const profileModal = document.getElementById('playerProfileModal');
  const profileFrame = document.getElementById('playerProfileFrame');
  const profileTitle = document.getElementById('playerProfileTitle');
  const closeProfileButton = document.getElementById('btnCloseProfile');

  function apiUrl(path) {
    return API_BASE + path;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function photoUrl(item) {
    return item?.fotoUrl ? apiUrl(item.fotoUrl) : './logo_liga.png';
  }

  function renderRanking(data) {
    const players = (Array.isArray(data?.ranking) ? data.ranking : [])
      .filter((item) => Number(item?.played || 0) > 0);

    if (!players.length) {
      statusBox.textContent = 'Todavía no hay partidos de Primera validados para armar el ranking.';
      statusBox.classList.remove('error');
      tableWrap.hidden = true;
      return;
    }

    rowsBox.innerHTML = players.map((item, index) => {
      const name = String(item.name || 'Jugador');
      const team = String(item.teamName || 'Sin equipo');
      const diff = Number(item.diff || 0);
      const diffClass = diff > 0 ? 'positive' : (diff < 0 ? 'negative' : '');
      const playerAttributes = `data-player-name="${escapeHtml(name)}" data-open-player="1"`;
      return `
        <tr>
          <td class="rank-position">#${index + 1}</td>
          <td>
            <button class="player-avatar-button" type="button" ${playerAttributes} aria-label="Abrir ficha de ${escapeHtml(name)}">
              <img src="${escapeHtml(photoUrl(item))}" alt="Foto de ${escapeHtml(name)}" loading="lazy">
            </button>
          </td>
          <td><button class="player-name-button" type="button" ${playerAttributes}>${escapeHtml(name)}</button></td>
          <td class="team-name">${escapeHtml(team)}</td>
          <td class="num">${Number(item.played || 0)}</td>
          <td class="num rad-score">${Number(item.rad || 0).toFixed(1)}</td>
          <td class="num">${Number(item.effectiveness || 0).toFixed(1)}%</td>
          <td class="num positive">${Number(item.wins || 0)}</td>
          <td class="num negative">${Number(item.losses || 0)}</td>
          <td class="num ${diffClass}">${diff > 0 ? '+' : ''}${diff}</td>
          <td class="num">${Number(item.triangulosFavor || 0)}</td>
          <td class="num">${Number(item.triangulosContra || 0)}</td>
        </tr>`;
    }).join('');

    rowsBox.querySelectorAll('img').forEach((image) => {
      image.addEventListener('error', () => {
        image.src = './logo_liga.png';
      }, { once: true });
    });

    const total = Number(data?.totalActivePlayers || players.length);
    metaBox.textContent = `${total} ${total === 1 ? 'jugador con al menos un partido disputado' : 'jugadores con al menos un partido disputado'}.`;
    statusBox.hidden = true;
    tableWrap.hidden = false;
  }

  async function loadRanking() {
    statusBox.hidden = false;
    statusBox.classList.remove('error');
    statusBox.textContent = 'Cargando ranking…';
    tableWrap.hidden = true;

    try {
      const params = new URLSearchParams({
        category: 'primera',
        edition: 'total',
        limit: '500',
        sort: 'rad',
        order: 'desc',
        currentCategoryOnly: '1'
      });
      const response = await fetch(apiUrl(`/api/cruces/player-ranking?${params.toString()}`), {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || 'No se pudo cargar el ranking.');
      renderRanking(data);
    } catch (error) {
      statusBox.hidden = false;
      statusBox.classList.add('error');
      statusBox.textContent = error?.message || 'No se pudo cargar el ranking.';
    }
  }

  function openPlayerProfile(name) {
    const playerName = String(name || '').trim();
    if (!playerName || !profileModal || !profileFrame) return;
    const params = new URLSearchParams({
      mode: 'individual',
      category: 'primera',
      player: playerName,
      auto: '1',
      edition: 'total'
    });
    profileTitle.textContent = `Ficha de ${playerName}`;
    profileFrame.src = `./consultas/consultas.html?${params.toString()}`;
    profileModal.hidden = false;
    document.body.classList.add('profile-open');
    window.requestAnimationFrame(() => closeProfileButton?.focus());
  }

  function closePlayerProfile() {
    if (!profileModal || !profileFrame) return;
    profileModal.hidden = true;
    profileFrame.src = 'about:blank';
    document.body.classList.remove('profile-open');
  }

  rowsBox?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-player]');
    if (button) openPlayerProfile(button.dataset.playerName);
  });
  closeProfileButton?.addEventListener('click', closePlayerProfile);
  profileModal?.addEventListener('click', (event) => {
    if (event.target?.matches('[data-close-profile]')) closePlayerProfile();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !profileModal?.hidden) closePlayerProfile();
  });

  loadRanking();
})();
