window.LipaViewerCalls=()=>{
  const alerts=document.querySelector('#pendingCalls'),historyBox=document.querySelector('#personalCalls');
  const token=LipaViewer.read().token,prefix='lipa.aviso.tocado.'+token.slice(-16)+'.';
  const touched=new Set(),sending=new Set();
  let inbox=[],checking=false,lastRender,openedKey='';
  function marked(id){
    if(touched.has(id))return true;
    try{return localStorage.getItem(prefix+id)==='1';}catch{return false;}
  }
  function render(){
    const active=[],history=[];
    for(const item of inbox){
      if(item.clave_pendiente && !marked(item.id))active.push(item);
      else if(history.length<5)history.push(item);
    }
    LipaCallSound.setPending(active.length>0);
    const signature=JSON.stringify([active,history]);
    if(signature===lastRender)return;
    lastRender=signature;
    const focusId=document.activeElement?.dataset.aviso;
    alerts.replaceChildren(...active.map(item=>{
      const button=document.createElement('button');button.type='button';button.dataset.aviso=item.id;
      const message=document.createElement('strong');message.textContent=item.mensaje;
      const action=document.createElement('span');action.textContent='Tocá este mensaje para confirmar el llamado';
      button.append(message,action);button.onclick=()=>acknowledge(item);return button;
    }));
    alerts.hidden=!active.length;
    if(focusId && active.length)(Array.from(alerts.children).find(el=>el.dataset.aviso===focusId)||alerts.firstElementChild).focus({preventScroll:true});
    historyBox.replaceChildren(...history.map(item=>{const p=document.createElement('p');p.textContent=item.mensaje;return p;}));
    historyBox.hidden=!history.length;
  }
  async function send(id){
    if(sending.has(id) || LipaViewer.read()?.token!==token)return;
    sending.add(id);
    try{
      await LipaViewer.api('avisos/'+id+'/confirmar',{});
      try{localStorage.removeItem(prefix+id);}catch{}
    }catch(error){if(error.status===401)location.replace('./torneos.html');}
    finally{sending.delete(id);}
  }
  function acknowledge(item){
    touched.add(item.id);
    try{localStorage.setItem(prefix+item.id,'1');}catch{}
    render();send(item.id);
  }
  function applyNotificationTap(){
    if(!openedKey)return;
    const item=inbox.find(item=>item.clave_pendiente===openedKey);
    if(item){openedKey='';acknowledge(item);}
  }
  function readNotificationLink(){
    const key=location.hash.match(/^#aviso=([a-f0-9-]{36})$/i)?.[1];
    if(key){openedKey=key;window.history.replaceState(null,'',location.pathname+location.search);}
  }
  async function check(){
    if(LipaViewer.read()?.token!==token){LipaCallSound.setPending(false);location.replace('./torneos.html');return;}
    if(checking || (document.hidden && alerts.hidden && !openedKey))return;
    checking=true;
    try{
      const result=await LipaViewer.api('llamados');
      inbox=result.avisos;
      applyNotificationTap();
      for(const item of inbox)if(item.clave_pendiente && marked(item.id))send(item.id);
      render();
    }catch(error){if(error.status===401){LipaCallSound.setPending(false);location.replace('./torneos.html');}}
    finally{checking=false;}
  }
  window.addEventListener('storage',event=>{
    if(event.key?.startsWith(prefix) && event.newValue==='1'){touched.add(event.key.slice(prefix.length));render();}
    if(LipaViewer.read()?.token!==token)check();
  });
  navigator.serviceWorker?.addEventListener('message',event=>{
    if(event.data?.type==='lipa-abrir-aviso'){
      openedKey=event.data.key;applyNotificationTap();check();
      event.ports[0]?.postMessage('recibido');
    }
  });
  window.addEventListener('hashchange',()=>{readNotificationLink();applyNotificationTap();check();});
  window.addEventListener('pagehide',()=>LipaCallSound.setPending(false));
  window.addEventListener('pageshow',check);
  window.addEventListener('online',check);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
  setInterval(check,5000);readNotificationLink();check();
};
