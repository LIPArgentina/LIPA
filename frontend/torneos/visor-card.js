(() => {
  const grid=document.getElementById('torneosGrid');
  const card=document.createElement('article');card.id='rodryViewerCard';card.className='torneo-card rodry-access';
  card.innerHTML=`<div class="torneo-card__media rodry-flyer"><img src="../assets/rodry-flyer-vivo.png" alt="Flyer del EVENTO FIN DE AÑO LIPA"></div><div class="torneo-card__body"><strong>EVENTO FIN DE AÑO LIPA</strong><form id="viewerLogin"><label for="viewerDni">Ingresá tu DNI</label><input id="viewerDni" name="dni" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="DNI sin puntos" required><button class="btn-ver-ubicacion" type="submit">ACCEDER</button></form><div id="viewerReturning" hidden><p id="viewerGreeting"></p><a href="./visor.html" class="btn-ver-ubicacion">ACCEDER</a><button id="viewerLogout" type="button" class="viewer-logout">Cerrar sesión</button></div><p id="viewerError" role="status"></p></div>`;
  function pin(){if(grid.firstElementChild!==card)grid.prepend(card);}
  new MutationObserver(pin).observe(grid,{childList:true});pin();
  const form=card.querySelector('form'), returning=card.querySelector('#viewerReturning'), error=card.querySelector('#viewerError');
  const session=window.LipaViewer;
  function showSession(nombre){form.hidden=true;returning.hidden=false;card.querySelector('#viewerGreeting').textContent=`Hola, ${nombre}`;}
  const gridUrl=user=>user.categoria?'./visor.html?categoria='+encodeURIComponent(user.categoria):'./visor.html';
  if(session.read())session.api('session').then(user=>{
    if(user.categoria && !new URLSearchParams(location.search).has('listado')){location.replace(gridUrl(user));return;}
    returning.querySelector('a').href=gridUrl(user);showSession(user.nombre);
  }).catch(e=>{if(e.status!==401)error.textContent=e.message;});
  card.querySelector('#viewerLogout').onclick=async()=>{try{await session.logout();}catch(e){error.textContent=e.message;}};
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('button');button.disabled=true;error.textContent='Verificando DNI…';
    try{
      let installationId='';try{installationId=window.AndroidBridge?.getInstallationId?.()||'';}catch(_){}
      const user=await session.api('login',{dni:form.dni.value,installationId});session.save(user);error.textContent='';
      location.assign(gridUrl(user));
    }catch(e){error.textContent=e.message;}finally{button.disabled=false;}
  });
})();
