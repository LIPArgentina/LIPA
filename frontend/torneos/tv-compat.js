/* DOM compatibility for older Samsung WebKit/Chromium browsers (ES5). */
(function () {
  function append() { for (var i=0;i<arguments.length;i++) this.appendChild(typeof arguments[i]==='string'?document.createTextNode(arguments[i]):arguments[i]); }
  if (!Element.prototype.append) Element.prototype.append=append;
  if (!Element.prototype.replaceChildren) Element.prototype.replaceChildren=function(){while(this.firstChild)this.removeChild(this.firstChild);append.apply(this,arguments);};
  if (!Element.prototype.remove) Element.prototype.remove=function(){if(this.parentNode)this.parentNode.removeChild(this);};
  if(typeof window.CustomEvent!=='function') { window.CustomEvent=function(name,options){var e=document.createEvent('CustomEvent');options=options||{};e.initCustomEvent(name,!!options.bubbles,!!options.cancelable,options.detail);return e;}; }
  window.LipaTVSignal=function(ms){if(!window.AbortController)return undefined;var c=new AbortController();setTimeout(function(){c.abort();},ms);return c.signal;};
  window.addEventListener('error',function(){var s=document.getElementById('screenStatus');if(s)s.textContent='No se pudo cargar la pantalla. Actualizá el navegador del TV o conectá una computadora por HDMI.';});
  setTimeout(function(){var s=document.getElementById('screenStatus');if(s&&s.textContent==='Cargando…')s.textContent='La carga está demorando. Revisá la conexión a Internet del TV.';},25000);
}());
