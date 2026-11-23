(() => {
  const grid=document.getElementById('torneosGrid');
  const card=document.createElement('article');card.id='rodryViewerCard';card.className='torneo-card rodry-access';
  card.innerHTML=`<div class="torneo-card__media rodry-flyer"><img src="../assets/rodry-flyer-vivo.png" alt="Flyer del EVENTO FIN DE AÑO LIPA"></div><div class="torneo-card__body"><strong>EVENTO FIN DE AÑO LIPA</strong><div class="torneo-card__actions" aria-label="Accesos del evento"><a href="./visor.html" class="btn-ver-ubicacion">TORNEO EN VIVO</a><a href="../estadisticas/" class="btn-ver-ubicacion">ESTADÍSTICAS</a></div></div>`;
  function pin(){if(grid.firstElementChild!==card)grid.prepend(card);}
  new MutationObserver(pin).observe(grid,{childList:true});pin();
})();
