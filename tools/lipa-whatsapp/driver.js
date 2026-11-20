// Runs in the isolated world of the dedicated WhatsApp Web tab.
async function lipaWhatsAppStep(expected, action) {
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const visible=el=>Boolean(el && el.getClientRects().length);
  const normalize=s=>String(s||'').replace(/\r\n/g,'\n').replace(/\u00a0/g,' ').replace(/[\u200b\u200e\u200f\ufeff]/g,'').trim();
  function text(el) {
    if(!el)return '';
    // Lexical uses paragraphs (including <p><br></p> for empty lines).
    // textContent concatenates them; inserting breaks only for divs loses them.
    const block=node=>/^(P|DIV|LI)$/.test(node.nodeName);
    function read(node) {
      if(node.nodeType===3)return node.nodeValue||'';
      if(node.nodeName==='IMG')return node.getAttribute('alt')||'';
      if(node.nodeName==='BR')return '\n';
      const children=[...node.childNodes];
      if(block(node)&&children.length===1&&children[0].nodeName==='BR')return '';
      return children.map((child,i)=>
        (i>0&&(block(child)||block(children[i-1]))?'\n':'')+read(child)
      ).join('');
    }
    return normalize(read(el));
  }
  const renderedMessage=normalize(expected.message.replace(/(\*{1,3}|_{1,3}|~{1,2}|`{1,3})([^\n]+?)\1/g,'$2'));
  const digits=s=>String(s||'').replace(/\D/g,'');
  function rightPhone(main) {
    // Header may show a number for unsaved contacts.
    const header=main.querySelector('header');
    const numberMatches=s=>digits(s)===expected.phone;
    // WhatsApp exposes the active recipient in the composer's accessible name,
    // even when the header displays a saved contact name and messages use LIDs.
    if([...main.querySelectorAll('footer [contenteditable="true"][role="textbox"]')].some(el=>{
      const label=el.getAttribute('aria-label')||'';
      const match=label.match(/^(?:Escribir un mensaje para|Type a message to)\s+(\+[\d\s().-]+)$/i);
      return visible(el)&&match&&numberMatches(match[1]);
    }))return true;
    if(header && [...header.querySelectorAll('span[title], span[dir], a[href^="tel:"]')].some(el=>visible(el)&&numberMatches(el.textContent)))return true;
    // Existing chat message IDs include the remote JID on compatible versions.
    if([...main.querySelectorAll('[data-id]')].some(el=>{
      const match=String(el.dataset.id||'').match(/^(?:true|false)_(\d+)@(?:c\.us|s\.whatsapp\.net)_/);
      return match && match[1]===expected.phone;
    }))return true;
    // Newer accounts may use opaque LIDs. Verify the displayed contact info instead.
    const headings=[...document.querySelectorAll('h1,h2,header span,header div')].filter(el=>visible(el)&&/^(Información de(?:l)? contacto|Info\. de(?:l)? contacto|Contact info)$/i.test(el.textContent.trim()));
    if(!headings.length)return false;
    return [...document.querySelectorAll('span[dir],a[href^="tel:"]')].some(el=>visible(el)&&!el.closest('#main,#pane-side,nav')&&numberMatches(el.textContent));
  }
  function headerIdentity(main) {
    return main.querySelector('[data-testid="conversation-info-header-button"]')||main.querySelector('header');
  }
  function remember(main) {
    const header=headerIdentity(main);
    globalThis.__lipaRecipient={main,header,label:header?.textContent,phone:expected.phone,at:Date.now()};
  }
  function remembered(main) {
    const proof=globalThis.__lipaRecipient,header=headerIdentity(main);
    return proof&&Date.now()-proof.at<45000&&proof.main===main&&proof.header===header&&proof.label===header?.textContent&&proof.phone===expected.phone;
  }
  function point(el) {
    if(!visible(el))return null;
    const rect=el.getBoundingClientRect();
    // Floating extensions can cover only the centre of a button. Select an
    // exposed interior point; never click through an unrelated overlay.
    for(const [fx,fy] of [[.5,.5],[.2,.5],[.8,.5],[.5,.2],[.5,.8],[.2,.2],[.8,.2],[.2,.8],[.8,.8]]) {
      const x=rect.x+rect.width*fx,y=rect.y+rect.height*fy;
      const hit=document.elementFromPoint(x,y);
      if(hit&&(hit===el||el.contains(hit)))return {x,y};
    }
    return null;
  }
  function inspect() {
    const main=document.querySelector('#main');
    if(!main)return {error:'Esperando el chat. Si aparece un QR, vinculá WhatsApp Web.'};
    const inputs=[...main.querySelectorAll('footer [contenteditable="true"][role="textbox"]')].filter(visible);
    if(inputs.length!==1)return {error:'No se pudo identificar un único cuadro de mensaje.'};
    const input=inputs[0];
    if(text(input)!==normalize(expected.media?'':expected.message))return {error:'El mensaje cargado no coincide exactamente con el revisado. Se detuvo para evitar un envío incorrecto.'};
    if(rightPhone(main))remember(main);
    if(!remembered(main))return {error:'No se pudo comprobar el número del chat. No se envió nada.',needPhone:true,main};
    if(expected.media||expected.prepareOnly)return {main,input,send:null};
    const sends=[...new Set([...main.querySelectorAll('footer button[aria-label="Enviar"],footer button[aria-label="Send"],footer [data-icon="send"],footer [data-icon="wds-ic-send-filled"]')].filter(visible).map(el=>el.closest('button,[role="button"]')).filter(Boolean))];
    if(sends.length!==1)return {error:'No se pudo identificar con seguridad el botón Enviar.'};
    return {main,input,send:sends[0]};
  }
  if(location.origin!=='https://web.whatsapp.com')return {error:'La pestaña no es WhatsApp Web.'};
  if(action==='composer'){const current=inspect();if(current.error)return {error:current.error};return {target:point(current.input)};}
  if(action==='prepare') {
    const current=inspect();
    if(current.needPhone) {
      const info=current.main.querySelector('[data-testid="conversation-info-header-button"],header button[aria-label="Información de contacto"],header button[aria-label="Contact info"]');
      const target=point(info);
      return target?{interaction:'contact',target}:{error:current.error};
    }
    if(current.error)return {error:current.error};
    if(expected.media||expected.prepareOnly)return {ready:true};
    const target=point(current.send);
    if(target)return {ready:true};
    const infoHeader=document.querySelector('[data-testid="contact-info-header"]');
    const header=infoHeader?.closest('header')||infoHeader?.parentElement;
    const close=header?.querySelector('button[aria-label="Cerrar"],button[aria-label="Close"],[role="button"][aria-label="Cerrar"],[role="button"][aria-label="Close"]');
    const closePoint=point(close);
    return closePoint?{interaction:'closeContact',target:closePoint}:{error:'El botón Enviar está tapado por otra ventana o extensión.'};
  }
  function outgoingNodes(main){
    const selfChat=/env[ií]a mensajes a este mismo n[uú]mero|message yourself|messages? to yourself/i.test(main.querySelector('header')?.innerText||main.querySelector('header')?.textContent||'');
    const nodes=[...main.querySelectorAll('[data-id],[data-message-id],.message-out,[data-testid="msg-container"]')].filter(el=>selfChat||el.matches('.message-out')||el.querySelector('.message-out')||el.closest('.message-out')||String(el.dataset.id||el.getAttribute?.('data-message-id')||'').startsWith('true_')||el.querySelector('[data-icon="tail-out"],[data-testid="tail-out"],[data-icon="msg-check"],[data-icon="msg-dblcheck"]'));
    return nodes.filter(el=>!nodes.some(other=>other!==el&&other.contains(el)));
  }
  const messageKey=el=>el.dataset.id||el.getAttribute?.('data-message-id')||'';
  const messageSignature=el=>normalize(el.innerText||el.textContent)+'|'+[...el.querySelectorAll('img,video')].map(n=>n.currentSrc||n.src||'').join('|');
  function snapshot(main){const nodes=outgoingNodes(main);return {ids:new Set(nodes.map(messageKey).filter(Boolean)),nodes:new Set(nodes),signatures:new Set(nodes.map(messageSignature))};}
  function mediaProof(){
    const proof=globalThis.__lipaMedia,main=document.querySelector('#main');
    return proof&&proof.hash===expected.media?.hash&&proof.phone===expected.phone&&proof.main===main&&proof.header===headerIdentity(main)&&proof.label===headerIdentity(main)?.textContent&&Date.now()-proof.at<180000?proof:null;
  }
  function mediaEditor(){
    const editors=[...document.querySelectorAll('[contenteditable="true"]')].filter(el=>visible(el)&&el!==globalThis.__lipaMedia?.composer&&!el.closest('#pane-side,header,[data-id]'));
    const candidates=[];
    for(const editor of editors){
      let root=editor.parentElement,found=null;
      while(root&&root!==document.body){
        const sendMarkers=[...root.querySelectorAll('[aria-label="Enviar"],[aria-label="Enviar 1 seleccionado"],[aria-label="Send 1 selected"],[aria-label="Send"],[title="Enviar"],[title="Send"],[data-testid="send"],[data-icon="send"],[data-icon="send-filled"],[data-icon="wds-ic-send-filled"]')].filter(visible);
        const controls=[...new Set(sendMarkers.map(el=>el.closest('button,[role="button"],[tabindex="0"]')||el.closest('[aria-label="Enviar"],[aria-label="Send"],[title="Enviar"],[title="Send"]')).filter(Boolean))];
        // Nested icon/label wrappers describe the same control. Occluded chat
        // buttons behind the media editor must not count as another Send button.
        const sends=controls.filter(el=>!controls.some(other=>other!==el&&other.contains(el))).filter(el=>point(el));
        const media=[...root.querySelectorAll(expected.media.type.startsWith('video/')?'video':'img')].filter(el=>visible(el)&&['blob:','data:image/','data:video/'].some(prefix=>(el.currentSrc||el.src||'').startsWith(prefix))&&!el.closest?.('[data-id],header,#pane-side'));
        if(media.length>=1){found={editor,send:sends.length===1?sends[0]:null,media:media[0]};if(found.send)break;}root=root.parentElement;
      }
      if(found)candidates.push(found);
    }
    return candidates.length===1?candidates[0]:null;
  }
  if(action==='attach'){
    if(!expected.media||!expected.mediaData)return {error:'Falta el archivo adjunto.'};
    if(mediaProof())return {attached:true};
    const current=inspect();if(current.error)return {error:current.error};
    const data=expected.mediaData.split(',')[1],bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==expected.media.hash||bytes.length!==expected.media.size)return {error:'El archivo no coincide con el revisado en la tanda.'};
    if(!remembered(current.main))return {error:'Se perdió la comprobación del contacto.'};
    const file=new File([bytes],expected.media.name,{type:expected.media.type}),transfer=new DataTransfer();transfer.items.add(file);
    current.input.focus();
    globalThis.__lipaMedia={main:current.main,header:headerIdentity(current.main),label:headerIdentity(current.main)?.textContent,phone:expected.phone,hash,at:Date.now(),captionSet:false,composer:current.input};
    // Use WhatsApp's paste handler on the verified composer, not an unrelated hidden file input.
    current.input.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));return {attached:true};
  }
  if(action==='mediaPrepare'||action==='send'&&expected.media){
    const proof=mediaProof();if(!proof)return {fatal:true,error:'Cambió el chat o venció la comprobación del adjunto. No se envió nada.'};
    const preview=mediaEditor();if(!preview)return {error:'Esperando la vista previa del adjunto.'};
    if(!proof.captionSet){
      if(action==='send')return {error:'La descripción del archivo todavía no fue comprobada.'};
      const target=point(preview.editor);if(!target)return {error:'El campo de descripción está tapado.'};
      proof.captionSet=true;return {interaction:'caption',target,error:'Cargando descripción con sus saltos de línea.'};
    }
    if(text(preview.editor)!==normalize(expected.message)&&normalize(preview.editor.innerText)!==normalize(expected.message))return {fatal:true,error:'La descripción del archivo no coincide con el mensaje revisado.'};
    if(!preview.send)return {error:'La imagen y la descripción están listas; no se pudo identificar un único botón Enviar del adjunto.'};
    if(preview.send.getAttribute('aria-disabled')==='true'||preview.send.disabled)return {error:'Esperando a que WhatsApp prepare el archivo.'};
    const target=point(preview.send);if(!target)return {error:'El botón de envío del archivo está tapado.'};
    if(action==='mediaPrepare')return {ready:true};
    globalThis.__lipaArmed={phone:expected.phone,message:expected.message,mediaHash:expected.media.hash,main:proof.main,at:Date.now(),...snapshot(proof.main)};
    return {armed:true,target};
  }
  if(action==='send') {
    const current=inspect();
    if(current.error)return {error:current.error,clicked:false};
    const target=point(current.send);
    if(!target)return {error:'El botón Enviar está tapado.',clicked:false};
    globalThis.__lipaArmed={phone:expected.phone,message:expected.message,main:current.main,at:Date.now(),...snapshot(current.main)};
    return {armed:true,target};
  }
  if(action!=='confirm'&&action!=='audit')return {error:'Acción desconocida.'};
  const armed=globalThis.__lipaArmed;
  if(!armed||armed.phone!==expected.phone||armed.message!==expected.message||armed.mediaHash!==(expected.media?.hash)||(action==='confirm'&&Date.now()-armed.at>30000))return {error:'No hay un envío preparado para comprobar.',clicked:true};
  for(let i=0;i<(expected.media?60:40);i++) {
    const main=document.querySelector('#main');
    if(main!==armed.main||!(rightPhone(main)||remembered(main)||expected.media&&mediaProof()))return {error:'El chat cambió. Revisá el envío manualmente.',clicked:true};
    const added=outgoingNodes(main).filter(el=>messageKey(el)?!armed.ids.has(messageKey(el)):!armed.nodes.has(el)&&!armed.signatures.has(messageSignature(el)));
    const compact=value=>normalize(value).replace(/\s+/g,' ');
    const expectedTexts=[expected.message,renderedMessage].map(compact);
    for(const el of added){
      // WhatsApp may collapse a long caption. Expand only a read-more control
      // inside this newly observed outgoing message, never another chat control.
      armed.expanded ||= new WeakSet();
      for(const button of el.querySelectorAll('button,[role="button"]')){
        if(/^(Leer m[aá]s|Ver m[aá]s|Read more|See more)$/i.test(normalize(button.textContent))&&!armed.expanded.has(button)){
          armed.expanded.add(button);button.click();
        }
      }
      const caption=[...el.querySelectorAll('.selectable-text,[data-testid="selectable-text"]')].some(part=>[text(part),part.innerText].filter(v=>typeof v==='string').some(value=>expectedTexts.includes(compact(value))));
      const media=!expected.media||(expected.media.type.startsWith('video/')?el.querySelector('video,[data-icon="video-play"],[data-icon="media-play"],[data-icon="play"]'):el.querySelector('img[src^="blob:"],img[src^="data:image/"],img[data-testid="media-url-provider"],img[alt="Imagen"],img[alt="Image"]'));
      if(caption&&media&&!el.querySelector('[role="progressbar"],[data-icon="msg-error"]')){
        if(action!=='audit')delete globalThis.__lipaArmed;return {sent:true,clicked:true};
      }
    }
    if(action==='audit')return {error:'No se pudo confirmar el mensaje en este chat. No se reenvió nada.'};
    await sleep(250);
  }
  return {error:'Se hizo clic en Enviar, pero no se confirmó el resultado. Revisá ese chat; no se reintentará.',clicked:true};
}
// Read-only diagnosis: no clicks, typing, navigation, or delivery-state changes.
function lipaInspectSent(expected){
 if(location.origin!=='https://web.whatsapp.com')return {error:'Abrí el chat en WhatsApp Web.'};
 const main=document.querySelector('#main');if(!main)return {error:'No hay un chat abierto.'};
 const norm=v=>String(v||'').replace(/[\u200b\u200e\u200f\ufeff]/g,'').replace(/\s+/g,' ').trim();
 const raw=norm(expected.message),formatted=norm(expected.message.replace(/(\*{1,3}|_{1,3}|~{1,2}|`{1,3})([^\n]+?)\1/g,'$2'));
 const all=[...main.querySelectorAll('[data-id],[data-message-id],.message-out,[data-testid="msg-container"]')];
 const selfChat=/env[ií]a mensajes a este mismo n[uú]mero|message yourself|messages? to yourself/i.test(main.querySelector('header')?.innerText||main.querySelector('header')?.textContent||'');
 const outgoing=all.filter(el=>selfChat||el.matches('.message-out')||el.querySelector('.message-out')||el.closest('.message-out')||String(el.dataset.id||el.getAttribute?.('data-message-id')||'').startsWith('true_')||el.querySelector('[data-icon="tail-out"],[data-testid="tail-out"],[data-icon="msg-check"],[data-icon="msg-dblcheck"]'));
 const candidates=all.filter(el=>!all.some(other=>other!==el&&other.contains(el))).slice(-5).map(el=>{
 const parts=[...el.querySelectorAll('.selectable-text,[data-testid="selectable-text"]')];
 const caption=parts.some(p=>[p.innerText,p.textContent].some(v=>[raw,formatted].includes(norm(v))));
 return {recognizedOutgoing:outgoing.includes(el),tag:el.tagName,classes:String(el.className||''),idKind:el.dataset.id?.startsWith('true_')?'true':el.dataset.id?.startsWith('false_')?'false':el.dataset.id?'other':'none',captionMatch:caption,captionNodes:parts.length,captionLengths:parts.map(p=>norm(p.innerText||p.textContent).length),expectedLength:raw.length,bodyContainsCaption:[raw,formatted].some(v=>norm(el.innerText||el.textContent).includes(v)),images:[...el.querySelectorAll('img')].map(img=>({sourceKind:(img.currentSrc||img.src||'').split(':')[0],width:img.naturalWidth||img.width,height:img.naturalHeight||img.height})),videos:el.querySelectorAll('video').length,canvases:el.querySelectorAll('canvas').length,icons:[...el.querySelectorAll('[data-icon]')].map(n=>n.getAttribute('data-icon')),testIds:[...el.querySelectorAll('[data-testid]')].map(n=>n.getAttribute('data-testid'))};
 });
 return {selfChat,outgoingCount:outgoing.length,messageIdNodes:all.length,candidates};
}
