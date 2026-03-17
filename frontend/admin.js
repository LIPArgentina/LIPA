// ====== Config ======
const SLOTS = 20;
const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let teamsInDiv = [];
let _activeDiv = 'primera';

// ====== Utils ======
function slugify(str='') {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]/g,'');
}

function toast(msg){
  console.log(msg);
}

// ====== Render tabla ======
function renderRows(users){
  const tbody = $('#teamsTable');
  if (!tbody) return;

  tbody.innerHTML = '';

  users.forEach(u=>{
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${u.username}</td>
      <td>${u.slug}</td>
    `;

    tbody.appendChild(tr);
  });
}

// ====== Select equipos ======
function fillTeamSelect(){
  const sel = $('#teamSelect');
  if (!sel) return;

  sel.innerHTML = '';

  teamsInDiv.forEach(t=>{
    const opt = document.createElement('option');
    opt.value = t.slug;
    opt.textContent = t.name;
    sel.appendChild(opt);
  });
}

// ====== LOAD DESDE POSTGRES ======
async function loadDivision(div){
  _activeDiv = div;

  $$('.sw').forEach(btn=>{
    const on = btn.dataset.div === div;
    btn.classList.toggle('active', on);
  });

  try{
    const r = await fetch(`${API_BASE}/api/teams?division=${encodeURIComponent(div)}`);
    const data = await r.json();

    if (!data.ok) throw new Error();

    const users = data.teams;

    renderRows(users);

    teamsInDiv = users.map(u=>({
      name: u.username,
      slug: u.slug
    }));

    fillTeamSelect();

  }catch(err){
    console.error(err);
    toast('Error cargando equipos');
  }
}

// ====== GUARDAR EQUIPOS ======
async function saveTeams(){
  try{
    const rows = $$('#teamsTable tr');

    const teams = Array.from(rows).map(tr=>{
      const name = tr.children[0].textContent.trim();
      return { username: name };
    });

    const r = await fetch(`${API_BASE}/api/save-teams`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        division: _activeDiv,
        teams
      })
    });

    const data = await r.json();

    if (!data.ok) throw new Error();

    toast('Equipos guardados');

    // 🔥 recargar desde DB
    await loadDivision(_activeDiv);

  }catch(err){
    console.error(err);
    toast('Error guardando equipos');
  }
}

// ====== INIT ======
document.addEventListener('DOMContentLoaded', ()=>{

  // botones división
  $$('.sw').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      loadDivision(btn.dataset.div);
    });
  });

  // botón guardar
  const btnSave = $('#btnSaveTeams');
  if (btnSave) {
    btnSave.addEventListener('click', saveTeams);
  }

  // primera carga
  loadDivision('primera');
});