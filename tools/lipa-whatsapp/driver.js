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
      const match=el.dataset.id.match(/^(?:true|false)_(\d+)@(?:c\.us|s\.whatsapp\.net)_/);
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
    if(text(input)!==normalize(expected.message))return {error:'El mensaje cargado no coincide exactamente con el revisado. Se detuvo para evitar un envío incorrecto.'};
    if(rightPhone(main))remember(main);
    if(!remembered(main))return {error:'No se pudo comprobar el número del chat. No se envió nada.',needPhone:true,main};
    const sends=[...new Set([...main.querySelectorAll('footer button[aria-label="Enviar"],footer button[aria-label="Send"],footer [data-icon="send"],footer [data-icon="wds-ic-send-filled"]')].filter(visible).map(el=>el.closest('button,[role="button"]')).filter(Boolean))];
    if(sends.length!==1)return {error:'No se pudo identificar con seguridad el botón Enviar.'};
    return {main,input,send:sends[0]};
  }
  if(location.origin!=='https://web.whatsapp.com')return {error:'La pestaña no es WhatsApp Web.'};
  if(action==='prepare') {
    const current=inspect();
    if(current.needPhone) {
      const info=current.main.querySelector('[data-testid="conversation-info-header-button"],header button[aria-label="Información de contacto"],header button[aria-label="Contact info"]');
      const target=point(info);
      return target?{interaction:'contact',target}:{error:current.error};
    }
    if(current.error)return {error:current.error};
    const target=point(current.send);
    if(target)return {ready:true};
    const infoHeader=document.querySelector('[data-testid="contact-info-header"]');
    const header=infoHeader?.closest('header')||infoHeader?.parentElement;
    const close=header?.querySelector('button[aria-label="Cerrar"],button[aria-label="Close"],[role="button"][aria-label="Cerrar"],[role="button"][aria-label="Close"]');
    const closePoint=point(close);
    return closePoint?{interaction:'closeContact',target:closePoint}:{error:'El botón Enviar está tapado por otra ventana o extensión.'};
  }
  if(action==='send') {
    const current=inspect();
    if(current.error)return {error:current.error,clicked:false};
    const target=point(current.send);
    if(!target)return {error:'El botón Enviar está tapado.',clicked:false};
    globalThis.__lipaArmed={phone:expected.phone,message:expected.message,main:current.main,at:Date.now(),ids:new Set([...current.main.querySelectorAll('[data-id]')].map(el=>el.dataset.id))};
    return {armed:true,target};
  }
  if(action!=='confirm')return {error:'Acción desconocida.'};
  const armed=globalThis.__lipaArmed;
  if(!armed||armed.phone!==expected.phone||armed.message!==expected.message||Date.now()-armed.at>30000)return {error:'No hay un envío preparado para comprobar.',clicked:true};
  for(let i=0;i<40;i++) {
    const main=document.querySelector('#main');
    if(main!==armed.main||!(rightPhone(main)||remembered(main)))return {error:'El chat cambió. Revisá el envío manualmente.',clicked:true};
    const added=[...main.querySelectorAll('[data-id]')].filter(el=>!armed.ids.has(el.dataset.id)&&(el.matches('.message-out')||el.querySelector('.message-out')||el.closest('.message-out')||el.dataset.id.startsWith('true_')));
    if(added.some(el=>[...el.querySelectorAll('.selectable-text')].some(part=>[normalize(expected.message),renderedMessage].includes(text(part))))){delete globalThis.__lipaArmed;return {sent:true,clicked:true};}
    await sleep(500);
  }
  return {error:'Se hizo clic en Enviar, pero no se confirmó el resultado. Revisá ese chat; no se reintentará.',clicked:true};
}
