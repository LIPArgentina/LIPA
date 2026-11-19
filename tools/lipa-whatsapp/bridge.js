'use strict';
document.documentElement.dataset.lipaBatchExtension = '2';
window.addEventListener('lipa-prepare-batch', async event => {
  try {
    const capabilities=await chrome.runtime.sendMessage({type:'capabilities'});
    if(!capabilities?.sharedMedia)throw Error('Recargá la extensión y LIPA antes de preparar una tanda con el mensaje guardado.');
    const result = await chrome.runtime.sendMessage({type:'prepare', batch:event.detail});
    window.dispatchEvent(new CustomEvent('lipa-batch-result', {detail:result}));
  } catch (_) { window.dispatchEvent(new CustomEvent('lipa-batch-result', {detail:{error:'Recargá la página después de instalar o actualizar la extensión.'}})); }
});
