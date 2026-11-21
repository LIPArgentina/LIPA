'use strict';
// Only the selected WhatsApp tab is attached. No credentials or chat history
// are read through CDP; it is used solely to deliver browser mouse input.
function lipaBrowserControl(api) {
  let attached=null;
  async function release() {
    const tabId=attached;attached=null;
    if(tabId!==null)try{await api.debugger.detach({tabId});}catch(_){}
  }
  async function verify(tabId) {
    const tab=await api.tabs.get(tabId);
    if(!tab.active||new URL(tab.url).origin!=='https://web.whatsapp.com')throw Error('La pestaña de WhatsApp debe estar visible.');
  }
  async function connect(tabId) {
    await verify(tabId);
    if(attached===tabId)return;
    if(!await api.permissions.contains({permissions:['debugger']}))throw Error('Recargá la extensión en chrome://extensions y aceptá el nuevo permiso si Chrome lo solicita.');
    await release();await api.debugger.attach({tabId},'1.3');attached=tabId;
  }
  async function click(tabId,point,cancelled=()=>false) {
    await verify(tabId);
    if(attached!==tabId)throw Error('El control de WhatsApp se desconectó.');
    if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0)throw Error('No se pudo ubicar el control.');
    if(cancelled())throw Error('Tanda detenida.');
    await api.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
    if(cancelled())throw Error('Tanda detenida.');
    await api.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',buttons:1,clickCount:1});
    // Never retry a partial click: the caller records uncertainty before sending.
    if(cancelled()){await release();throw Error('Tanda detenida. Revisá el último chat.');}
    await api.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',buttons:0,clickCount:1});
  }
  api.debugger?.onDetach?.addListener(source=>{if(source.tabId===attached)attached=null;});
  async function fillCaption(tabId,point,value,cancelled=()=>false){
    await click(tabId,point,cancelled);
    async function command(method,params){await verify(tabId);if(attached!==tabId||cancelled())throw Error('Tanda detenida.');await api.debugger.sendCommand({tabId},method,params);}
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
    const lines=String(value).replace(/\r\n/g,'\n').split('\n');
    // Shift+Enter goes through WhatsApp's editor and never invokes plain Enter/send.
    for(let i=0;i<lines.length;i++){
      if(i){await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,modifiers:8});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,modifiers:8});}
      if(lines[i])await command('Input.insertText',{text:lines[i]});
    }
  }

  async function navigate(tabId,action,cancelled=()=>false){
    await connect(tabId);
    let failure=null,pending=Promise.resolve();
    const listener=(source,method,params)=>{
      if(source.tabId!==tabId||method!=='Page.javascriptDialogOpening'||params.type!=='beforeunload')return;
      pending=api.debugger.sendCommand({tabId},'Page.handleJavaScriptDialog',{accept:!cancelled()}).catch(error=>{failure=error;});
    };
    api.debugger.onEvent.addListener(listener);
    try{
      await api.debugger.sendCommand({tabId},'Page.enable',{});
      if(cancelled())throw Error('Tanda detenida.');
      await action();await pending;if(failure)throw failure;
    }finally{
      api.debugger.onEvent.removeListener(listener);
      try{await api.debugger.sendCommand({tabId},'Page.disable',{});}catch(_){}
    }
  }
  async function activateResult(tabId,contact,cancelled=()=>false){
    await verify(tabId);if(attached!==tabId||cancelled())throw Error('Tanda detenida.');
    const result=await api.scripting.executeScript({target:{tabId},func:lipaOpenChat,args:[contact,'focusResult']});
    if(!result[0]?.result?.focused)return false;
    if(cancelled())return false;
    await api.debugger.sendCommand({tabId},'Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await api.debugger.sendCommand({tabId},'Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    return true;
  }
  return {connect,click,fillCaption,release,navigate,activateResult};
}
if(typeof module==='object')module.exports=lipaBrowserControl;
