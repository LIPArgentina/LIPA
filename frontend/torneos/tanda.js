(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LipaBatch=factory();})(typeof window==='undefined'?globalThis:window,()=>{
  function phone(value){let raw=String(value||'').trim();if(!/^\+?[\d\s().-]+$/.test(raw))return '';let n=raw.replace(/\D/g,'');const international=raw.startsWith('+')||n.startsWith('00');if(n.startsWith('00'))n=n.slice(2);if(!international&&n.length===10)n='549'+n;if(n.startsWith('54')&&n.length===12)n='549'+n.slice(2);return /^[1-9]\d{9,14}$/.test(n)?n:'';}
  function collect(rows){const contacts=[],seen=new Set();let missing=0,invalid=0,duplicates=0;for(const row of rows){if(!String(row.whatsapp||'').trim()){missing++;continue;}const n=phone(row.whatsapp);if(!n){invalid++;continue;}if(seen.has(n)){duplicates++;continue;}seen.add(n);contacts.push({name:row.nombre_oficial||row.nombre_ingresado||'Jugador',phone:n});}return {contacts,missing,invalid,duplicates};}
  return {phone,collect};
});
