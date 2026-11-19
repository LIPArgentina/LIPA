window.LipaCallSound=(()=>{
  const button=document.querySelector('#testSound');
  const status=document.querySelector('#soundStatus');
  const Audio=window.AudioContext || window.webkitAudioContext;
  let context;
  function label(){
    button.textContent=context?.state==='running'?'PROBAR SONIDO':'ACTIVAR SONIDO';
  }
  async function activate(){
    if(!context){context=new Audio();context.onstatechange=label;}
    if(context.state!=='running')await context.resume();
    label();
  }
  function ring(){
    if(document.hidden || context?.state!=='running')return;
    const start=context.currentTime+0.025;
    [740,988,740,988].forEach((frequency,i)=>{
      const tone=context.createOscillator(),volume=context.createGain();
      const at=start+i*0.29;
      tone.frequency.value=frequency;tone.type='triangle';
      volume.gain.setValueAtTime(0,at);
      volume.gain.linearRampToValueAtTime(0.32,at+0.018);
      volume.gain.exponentialRampToValueAtTime(0.001,at+0.22);
      tone.connect(volume);volume.connect(context.destination);
      tone.onended=()=>{tone.disconnect();volume.disconnect();};
      tone.start(at);tone.stop(at+0.23);
    });
  }
  if(Audio){
    const unlock=()=>{if(context?.state!=='running')activate().catch(()=>{});};
    document.addEventListener('click',unlock);
    document.addEventListener('keydown',unlock);
    button.onclick=async()=>{
      try{await activate();ring();status.textContent='Sonido de llamados activado.';}
      catch{status.textContent='No se pudo activar el sonido. Volvé a tocar Activar sonido.';}
    };
  }else{button.hidden=true;status.textContent='Este visor solo admite el aviso en pantalla.';}
  return {ring};
})();
