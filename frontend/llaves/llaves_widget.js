
(function(){
  const mount = document.getElementById('llavesPublicMount');
  if (!mount || !(window.LLAVES_SHARED && window.APP_CONFIG)) return;
  const category = mount.dataset.category;
  const { api, renderDiagram } = window.LLAVES_SHARED;

  async function init(){
    try{
      const res = await fetch(api(`/llaves?category=${encodeURIComponent(category)}`), { credentials:'same-origin', cache:'no-store' });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'No se pudo cargar');
      renderDiagram(mount, data, { admin:false });
      mount.classList.add('llaves-public-shell');
    }catch(err){
      mount.innerHTML = `<div class="small-note">No se pudieron cargar las llaves: ${String(err.message || err)}</div>`;
      mount.classList.add('llaves-public-shell');
    }
  }
  init();
})();
