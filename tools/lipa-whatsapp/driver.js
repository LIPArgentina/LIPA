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
    if(header && [...header.querySelectorAll('span[title], span[dir], a[href^="tel:"]')].some(el=>visible(el)&&numberMatches(el.textContent)))return true;
    // Existing chat message IDs include the remote JID on compatible versions.
    if([...main.querySelectorAll('[data-id]')].some(el=>{
      const match=el.dataset.id.match(/^(?:true|false)_(\d+)@(?:c\.us|s\.whatsapp\.net)_/);
      return match && match[1]===expected.phone;
    }))return true;
    // Newer accounts may use opaque LIDs. Verify the displayed contact info instead.
    const headings=[...document.querySelectorAll('h1,h2,header span,header div')].filter(el=>visible(el)&&/^(Información del contacto|Info\. del contacto|Contact info)$/i.test(el.textContent.trim()));
    if(!headings.length)return false;
    return [...document.querySelectorAll('span[dir],a[href^="tel:"]')].some(el=>visible(el)&&!el.closest('#main,#pane-side,nav')&&numberMatches(el.textContent));
  }
  function inspect() {
    const main=document.querySelector('#main');
    if(!main)return {error:'Esperando el chat. Si aparece un QR, vinculá WhatsApp Web.'};
    const inputs=[...main.querySelectorAll('footer [contenteditable="true"][role="textbox"]')].filter(visible);
    if(inputs.length!==1)return {error:'No se pudo identificar un único cuadro de mensaje.'};
    const input=inputs[0];
    if(text(input)!==normalize(expected.message))return {error:'El mensaje cargado no coincide exactamente con el revisado. Se detuvo para evitar un envío incorrecto.'};
    if(!rightPhone(main))return {error:'No se pudo comprobar el número del chat. No se envió nada.',needPhone:true,main};
    const sends=[...main.querySelectorAll('footer [data-icon="send"],footer [data-icon="wds-ic-send-filled"]')].filter(visible).map(el=>el.closest('button,[role="button"]')).filter(Boolean);
    if(sends.length!==1)return {error:'No se pudo identificar con seguridad el botón Enviar.'};
    return {main,input,send:sends[0]};
  }
  if(location.origin!=='https://web.whatsapp.com')return {error:'La pestaña no es WhatsApp Web.'};
  if(action==='prepare') {
    let last,openedInfo=false;
    for(let i=0;i<90;i++) {
      last=inspect();
      if(!last.error)return {ready:true};
      if(last.needPhone&&!openedInfo) {
        const header=last.main.querySelector('header');
        const info=header?.querySelector('[data-testid="conversation-info-header"], [role="button"]');
        if(info){info.click();openedInfo=true;}
      }
      await sleep(500);
    }
    return {error:last?.error||'WhatsApp no terminó de cargar.'};
  }
  if(action!=='send')return {error:'Acción desconocida.'};
  const current=inspect();
  if(current.error)return {error:current.error,clicked:false};
  const ids=new Set([...current.main.querySelectorAll('[data-id]')].map(el=>el.dataset.id));
  current.send.click();
  for(let i=0;i<40;i++) {
    const main=document.querySelector('#main');
    if(!main || !rightPhone(main))return {error:'El chat cambió después del clic. Revisá el envío manualmente.',clicked:true};
    const added=[...main.querySelectorAll('.message-out [data-id], [data-id].message-out, [data-id]')].filter(el=>!ids.has(el.dataset.id)&&(el.matches('.message-out')||el.querySelector('.message-out')||el.closest('.message-out')||el.dataset.id.startsWith('true_')));
    if(added.some(el=>[...el.querySelectorAll('.selectable-text')].some(part=>[normalize(expected.message),renderedMessage].includes(text(part)))))return {sent:true,clicked:true};
    await sleep(500);
  }
  return {error:'Se hizo clic en Enviar, pero no se confirmó el resultado. Revisá ese chat; no se reintentará.',clicked:true};
}
