(function(){
  'use strict';

  const API_BASE = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const sessionKey = 'lpi.session';

  const $ = (s) => document.querySelector(s);

  function readSession(){
    try { return JSON.parse(localStorage.getItem(sessionKey) || sessionStorage.getItem(sessionKey) || '{}'); }
    catch { return {}; }
  }

  function getParams(){ return new URLSearchParams(location.search); }

  function getSalaSlug(){
    const p = getParams();
    return p.get('sala') || readSession().slug || '';
  }

  function getSalaId(){
    const p = getParams();
    return p.get('salaId') || readSession().salaId || null;
  }

  function getToken(){
    const p = getParams();
    return p.get('token') || readSession().token || '';
  }

  function authHeaders(){
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function apiUrl(path){ return `${API_BASE}${path}`; }

  function setSalaName(){
    const sess = readSession();
    const label = sess.displayName || getSalaSlug() || 'Sala';
    const el = $('#salaName');
    if (el) el.textContent = label;
  }

  function setMessage(type, text){
    const err = $('#passError');
    const ok = $('#passSuccess');
    if (err) err.hidden = true;
    if (ok) ok.hidden = true;
    const el = type === 'ok' ? ok : err;
    if (el) {
      el.textContent = text;
      el.hidden = false;
    }
  }

  function resetPassForm(){
    $('#oldPass').value = '';
    $('#newPass').value = '';
    $('#newPass2').value = '';
    $('#passError').hidden = true;
    $('#passSuccess').hidden = true;
  }

  function openPassModal(){
    resetPassForm();
    const dlg = $('#passModal');
    if (dlg?.showModal) dlg.showModal();
  }

  async function submitPassword(ev){
    ev.preventDefault();
    const oldPassword = $('#oldPass').value;
    const newPassword = $('#newPass').value;
    const newPassword2 = $('#newPass2').value;

    if (!oldPassword || !newPassword || newPassword !== newPassword2) {
      setMessage('error', 'Revisá los campos');
      return;
    }

    try {
      const resp = await fetch(apiUrl('/api/sala/change-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify({
          slug: getSalaSlug(),
          salaId: getSalaId(),
          oldPassword,
          newPassword
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.msg || data.error || `HTTP ${resp.status}`);
      setMessage('ok', '¡Contraseña actualizada!');
      setTimeout(() => $('#passModal')?.close(), 800);
    } catch (err) {
      setMessage('error', err?.message || 'No se pudo actualizar.');
    }
  }

  function wirePasswordToggles(){
    document.querySelectorAll('input[data-toggle]').forEach((chk) => {
      const target = document.querySelector(chk.getAttribute('data-toggle'));
      if (!target) return;
      chk.addEventListener('change', () => { target.type = chk.checked ? 'text' : 'password'; });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setSalaName();
    wirePasswordToggles();
    $('#btnChangePassword')?.addEventListener('click', openPassModal);
    $('#btnCancelPass')?.addEventListener('click', () => $('#passModal')?.close());
    $('#passForm')?.addEventListener('submit', submitPassword);
  });
})();
