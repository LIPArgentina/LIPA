/* Public Firebase web configuration only; never include service-account credentials. */
self.addEventListener('notificationclick',event=>{
  const key=event.notification.tag.match(/^lipa-llamado-([a-f0-9-]{36})$/i)?.[1];
  if(!key)return;
  event.stopImmediatePropagation();event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL('./visor.html',self.location.href);
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const visor=windows.find(client=>new URL(client.url).pathname===url.pathname);
    url.hash='aviso='+key;
    if(!visor){await self.clients.openWindow(url.href);return;}
    await visor.focus();
    const received=await new Promise(resolve=>{
      const channel=new MessageChannel();
      const timer=setTimeout(()=>{channel.port1.close();resolve(false);},800);
      channel.port1.onmessage=()=>{clearTimeout(timer);channel.port1.close();resolve(true);};
      visor.postMessage({type:'lipa-abrir-aviso',key},[channel.port2]);
    });
    if(!received)await visor.navigate(url.href);
  })());
});
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');
const config=JSON.parse(new URL(self.location.href).searchParams.get('config')||'{}');
firebase.initializeApp(config);
firebase.messaging();
