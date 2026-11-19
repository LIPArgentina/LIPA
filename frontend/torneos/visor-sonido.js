window.LipaCallSound=(()=>{
  const button=document.querySelector('#testSound'),status=document.querySelector('#soundStatus');
  const Audio=window.AudioContext || window.webkitAudioContext;
  let context,pattern,alarm,preview,pending=false;

  function alarmPattern(){
    const rate=context.sampleRate,buffer=context.createBuffer(1,Math.ceil(1.6*rate),rate);
    const samples=buffer.getChannelData(0);
    [880,1175,880,1175].forEach((frequency,index)=>{
      const offset=Math.round(index*0.27*rate);
      for(let n=0;n<Math.floor(0.22*rate);n++){
        const t=n/rate,phase=2*Math.PI*frequency*t;
        const envelope=Math.min(1,t/0.012,(0.22-t)/0.035);
        samples[offset+n]=envelope*(0.52*Math.sin(phase)+0.12*Math.sin(3*phase));
      }
    });
    return buffer;
  }
  function play(loop){
    pattern ||= alarmPattern();
    const source=context.createBufferSource();
    source.buffer=pattern;source.loop=loop;source.connect(context.destination);
    source.onended=()=>{source.disconnect();if(source===preview)preview=null;};
    source.start();return source;
  }
  function sync(){
    if(!pending && alarm){alarm.stop();alarm=null;}
    if(pending && !alarm && context?.state==='running'){
      if(preview){preview.stop();preview=null;}
      alarm=play(true);
    }
    button.textContent=context?.state==='running'?'PROBAR SONIDO':'ACTIVAR SONIDO';
  }
  async function activate(){
    if(!context){context=new Audio();context.onstatechange=sync;}
    if(context.state!=='running')await context.resume();
    sync();
  }
  if(Audio){
    const unlock=()=>{if(context?.state!=='running')activate().catch(()=>{});};
    document.addEventListener('click',unlock);
    document.addEventListener('keydown',unlock);
    button.onclick=async()=>{
      try{
        await activate();
        if(!pending){if(preview)preview.stop();preview=play(false);}
        status.textContent='Sonido de llamados activado.';
      }catch{status.textContent='Volvé a tocar Activar sonido para habilitar la alarma.';}
    };
  }else{button.hidden=true;status.textContent='Este visor solo admite el aviso en pantalla.';}
  return {setPending(value){
    pending=value;
    if(value && Audio && !context)activate().catch(()=>{});
    sync();
  }};
})();
