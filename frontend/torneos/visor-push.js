window.LipaViewerPush = async () => {
  if(window.AndroidBridge)throw new Error('En esta versión de la app los llamados aparecen mientras tengas abierto el visor.');
  if(!('Notification' in window) || !('serviceWorker' in navigator))throw new Error('Este navegador no admite notificaciones. Los llamados aparecen en el visor.');
  if(await Notification.requestPermission()!=='granted')throw new Error('No se habilitaron las notificaciones. Podés seguir usando el visor.');
  const settings=await LipaViewer.api('push-config');
  if(!settings.enabled)throw new Error('Las notificaciones del navegador todavía no están configuradas. Los llamados aparecen aquí con el visor abierto.');
  const [{initializeApp},{getMessaging,getToken,isSupported}]=await Promise.all([
    import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging.js')]);
  if(!await isSupported())throw new Error('Este navegador no admite notificaciones. Los llamados aparecen en el visor.');
  const registration=await navigator.serviceWorker.register(`./visor-sw.js?config=${encodeURIComponent(JSON.stringify(settings.config))}`,{scope:'./'});
  await navigator.serviceWorker.ready;
  const token=await getToken(getMessaging(initializeApp(settings.config,'lipa-viewer')),{vapidKey:settings.vapidKey,serviceWorkerRegistration:registration});
  if(!token)throw new Error('No se pudo registrar este dispositivo.');
  await LipaViewer.api('push',{token});
};
