// FIXED VERSION - evita 429
const API_BASE = (window.APP_CONFIG?.API_BASE_URL || 'https://liga-backend-tt82.onrender.com').replace(/\/+\$/, '');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, options){
  const response = await fetch(url, options);
  let data = null;
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) {
    const message = data?.error || data?.message || ('HTTP ' + response.status + ' @ ' + url);
    throw new Error(message);
  }
  return data;
}

async function reload(){
  try {
    await sleep(150);
    const enabled = await fetchJson(API_BASE + '/api/cruces/status');

    if (!enabled) return;

    await sleep(150);
    const crucesRaw = await fetchJson(API_BASE + '/api/cruces');

    await sleep(150);
    const planillas = await fetchJson(API_BASE + '/api/admin/planillas');

    console.log("OK", crucesRaw, planillas);

  } catch (e) {
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', reload);
