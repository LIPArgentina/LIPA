'use strict';
document.documentElement.dataset.lipaBatchExtension = '1';
window.addEventListener('lipa-prepare-batch', async event => {
  try {
    const result = await chrome.runtime.sendMessage({type:'prepare', batch:event.detail});
    window.dispatchEvent(new CustomEvent('lipa-batch-result', {detail:result}));
  } catch (_) { window.dispatchEvent(new CustomEvent('lipa-batch-result', {detail:{error:'Recargá la página después de instalar o actualizar la extensión.'}})); }
});
