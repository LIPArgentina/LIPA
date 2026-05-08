(() => {
  'use strict';

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');

  const $category = document.getElementById('categorySelect');
  const $team = document.getElementById('teamSelect');
  const $form = document.getElementById('salaForm');
  const $status = document.getElementById('statusBox');
  const $result = document.getElementById('resultBox');
  const $teamName = document.getElementById('teamName');
  const $roomName = document.getElementById('roomName');
  const $locationText = document.getElementById('locationText');
  const $mapLink = document.getElementById('mapLink');
  const $mapFrame = document.getElementById('mapFrame');
  const $mapEmpty = document.getElementById('mapEmpty');

  let currentTeams = [];

  function apiUrl(path){
    return API_BASE + path;
  }

  function setStatus(text, type = 'info'){
    if (!$status) return;
    if (!text) {
      $status.hidden = true;
      $status.textContent = '';
      $status.className = 'status-box';
      return;
    }
    $status.hidden = false;
    $status.textContent = text;
    $status.className = 'status-box ' + type;
  }

  function escapeHtml(value){
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function slugify(s=''){
    return String(s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/[^a-z0-9]+/g,'');
  }

  async function fetchJson(url){
    const response = await fetch(url, { cache:'no-store', credentials:'same-origin' });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      throw new Error(data?.error || data?.message || 'No se pudo consultar.');
    }
    return data;
  }

  function normalizeTeam(item){
    const name = item?.username || item?.name || item?.team || item?.teamName || item?.equipo || item?.nombre || '';
    const sala = item?.sala || item?.room || item?.email || '';
    const ubicacion = item?.ubicacion || item?.location || item?.maps || item?.phone || '';
    const slug = item?.slug || slugify(name);
    return {
      id: item?.id || null,
      name: String(name || '').trim(),
      slug,
      sala: String(sala || '').trim(),
      ubicacion: String(ubicacion || '').trim()
    };
  }

  async function loadTeams(){
    const category = String($category?.value || '').trim();
    if (!$team || !category) return;

    setStatus('Cargando equipos…', 'info');
    $team.innerHTML = '<option value="">Cargando equipos...</option>';
    $team.disabled = true;

    try{
      const data = await fetchJson(apiUrl('/api/teams?division=' + encodeURIComponent(category)));
      const raw =
        Array.isArray(data) ? data :
        Array.isArray(data?.teams) ? data.teams :
        Array.isArray(data?.users) ? data.users :
        [];

      currentTeams = raw
        .filter(item => item && (item.role === 'team' || item.username || item.name || item.team || item.equipo))
        .map(normalizeTeam)
        .filter(item => item.name)
        .sort((a,b) => a.name.localeCompare(b.name, 'es'));

      $team.innerHTML = '<option value="">Seleccionar equipo...</option>';
      currentTeams.forEach((team) => {
        const option = document.createElement('option');
        option.value = team.slug || team.name;
        option.textContent = team.name;
        $team.appendChild(option);
      });

      $team.disabled = false;

      if (!currentTeams.length) {
        setStatus('No hay equipos cargados para esta categoría.', 'error');
        hideResult();
        return;
      }

      setStatus('', 'info');
      hideResult();
    }catch(err){
      console.error(err);
      currentTeams = [];
      $team.innerHTML = '<option value="">No se pudieron cargar equipos</option>';
      $team.disabled = true;
      hideResult();
      setStatus(err?.message || 'No se pudieron cargar los equipos.', 'error');
    }
  }

  function findSelectedTeam(){
    const value = String($team?.value || '').trim();
    if (!value) return null;
    return currentTeams.find(t => String(t.slug) === value || String(t.name) === value) || null;
  }

  function extractCoords(value){
    const text = String(value || '').trim();

    let match = text.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (match) return { lat: match[1], lng: match[2] };

    match = text.match(/[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (match) return { lat: match[1], lng: match[2] };

    match = text.match(/[?&]ll=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (match) return { lat: match[1], lng: match[2] };

    match = text.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
    if (match) return { lat: match[1], lng: match[2] };

    return null;
  }

  function isLikelyUrl(value){
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  function buildMapData(rawLocation){
    const location = String(rawLocation || '').trim();
    if (!location) return null;

    const coords = extractCoords(location);

    if (coords) {
      const q = `${coords.lat},${coords.lng}`;
      return {
        label: q,
        openUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
        embedUrl: `https://www.google.com/maps?q=${encodeURIComponent(q)}&z=16&output=embed`
      };
    }

    if (isLikelyUrl(location)) {
      return {
        label: location,
        openUrl: location,
        embedUrl: `https://www.google.com/maps?q=${encodeURIComponent(location)}&z=16&output=embed`
      };
    }

    return {
      label: location,
      openUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`,
      embedUrl: `https://www.google.com/maps?q=${encodeURIComponent(location)}&z=16&output=embed`
    };
  }

  function hideResult(){
    if ($result) $result.hidden = true;
    if ($mapFrame) {
      $mapFrame.hidden = true;
      $mapFrame.style.display = 'none';
      $mapFrame.removeAttribute('src');
    }
    if ($mapEmpty) {
      $mapEmpty.hidden = false;
      $mapEmpty.style.display = 'flex';
      $mapEmpty.textContent = 'Seleccioná un equipo para ver el mapa.';
    }
    if ($mapLink) {
      $mapLink.hidden = true;
      $mapLink.removeAttribute('href');
    }
  }

  function renderTeam(team){
    if (!team) {
      hideResult();
      setStatus('Seleccioná un equipo.', 'error');
      return;
    }

    const sala = team.sala || 'Sin sala cargada';
    const ubicacion = team.ubicacion || '';
    const mapData = buildMapData(ubicacion);

    if ($result) $result.hidden = false;
    if ($teamName) $teamName.textContent = team.name || 'Equipo';
    if ($roomName) $roomName.textContent = sala;
    if ($locationText) $locationText.textContent = ubicacion || 'Sin ubicación cargada';

    if (mapData) {
      if ($mapLink) {
        $mapLink.href = mapData.openUrl;
        $mapLink.hidden = false;
      }
      if ($mapFrame) {
        $mapFrame.src = mapData.embedUrl;
        $mapFrame.hidden = false;
        $mapFrame.style.display = 'block';
      }
      if ($mapEmpty) {
        $mapEmpty.hidden = true;
        $mapEmpty.style.display = 'none';
      }
      setStatus('', 'info');
      return;
    }

    if ($mapLink) {
      $mapLink.hidden = true;
      $mapLink.removeAttribute('href');
    }
    if ($mapFrame) {
      $mapFrame.hidden = true;
      $mapFrame.style.display = 'none';
      $mapFrame.removeAttribute('src');
    }
    if ($mapEmpty) {
      $mapEmpty.hidden = false;
      $mapEmpty.style.display = 'flex';
      $mapEmpty.textContent = 'Este equipo todavía no tiene ubicación cargada.';
    }
    setStatus('Este equipo no tiene ubicación cargada.', 'error');
  }

  $category?.addEventListener('change', loadTeams);
  $team?.addEventListener('change', () => renderTeam(findSelectedTeam()));
  $form?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    renderTeam(findSelectedTeam());
  });

  document.addEventListener('DOMContentLoaded', loadTeams);
})();
