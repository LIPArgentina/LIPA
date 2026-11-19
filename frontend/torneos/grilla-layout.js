(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LipaBracketLayout=api;})(typeof globalThis==='object'?globalThis:this,function(){
 function build(rounds,dual){
  if(rounds[0]?.[0]?.id.startsWith('de-l')){
    const positions=new Map(),height=Math.max(420,Math.max(...rounds.map(r=>r.length))*120+100);
    rounds.forEach((round,r)=>round.forEach((m,i)=>{const center=60+(i+.5)*(height-100)/round.length;positions.set(m.id,{x:r*234,y:center-44,center,width:206});}));
    return {positions,width:rounds.length*234+224,height};
  }
  const W=206,G=28,TOP=45,STEP=110,depth=rounds.length-1,positions=new Map();
  const rootCount=rounds[depth].length,span=2**depth,half=Math.max(1,span/2);
  let offset=TOP;
  for(let root=0;root<rootCount;root++){
   const start=root*span,end=Math.min(start+span,rounds[0].length);
   const leftCount=Math.min(half,end-start),rightCount=Math.max(0,end-start-half);
   for(let i=start;i<end;i++){
    const local=i-start,right=dual&&local>=half;
    const x=right?depth*2*(W+G):0;
    const center=offset+44+(dual?(right?local-half:local):local)*STEP;
    positions.set(rounds[0][i].id,{x,y:center-44,width:W,center});
   }
   offset+=Math.max(dual?Math.max(leftCount,rightCount):end-start,3)*STEP+100;
  }
  for(let r=1;r<=depth;r++)rounds[r].forEach((match,i)=>{
   const a=positions.get(rounds[r-1][i*2].id),b=rounds[r-1][i*2+1]&&positions.get(rounds[r-1][i*2+1].id);
   const center=b?(a.center+b.center)/2:a.center;
   const groupSpan=2**(depth-r),right=dual&&r<depth&&(i%groupSpan)>=groupSpan/2;
   const x=dual?(r===depth?depth:right?depth*2-r:r)*(W+G):r*(W+G);
   positions.set(match.id,{x,y:center-(r===depth?56:44),width:W,center});
  });
  return {positions,width:dual?(depth*2+1)*W+depth*2*G:(depth+2)*W+(depth+1)*G,height:offset+70};
 }
 return {build};
});