window.LipaViewer = (() => {
  const key='lipa.rodry.viewer', API=String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/,'');
  function read(){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;}}
  function save(value){localStorage.setItem(key,JSON.stringify(value));}
  function clear(){localStorage.removeItem(key);}
  async function api(path,body,method){
    const response=await fetch(`${API}/api/torneo-visor/${path}`,{method:method||(body?'POST':'GET'),cache:'no-store',headers:{'Content-Type':'application/json',...(read()?.token?{Authorization:`Bearer ${read().token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok){if(response.status===401)clear();throw Object.assign(new Error(result.error||'No se pudo conectar. Reintentá.'),{status:response.status});}return result;
  }
  async function logout(){await api('logout',{});clear();location.replace('./torneos.html');}
  return {read,save,clear,api,logout};
})();
