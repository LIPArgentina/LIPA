(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('../torneos/grilla-engine'));
 else root.LipaEstadisticas=factory(root.LipaBracket);
})(typeof globalThis==='object'?globalThis:this,function(bracket){
 function calculate(data,category){
  const state=bracket.build(data.players,data.results,category);
  const rows=new Map(data.players.filter(p=>p.id&&!p.wo).map(p=>[String(p.id),{id:String(p.id),nombre:p.nombre,fotoUrl:p.fotoUrl,played:0,won:0,lost:0,for:0,against:0,diff:0,position:null,stage:'En competencia',seconds:0,timed:0}]));
  for(const m of state.matches){
   if(!m.resolved||m.bye||!m.a||!m.b)continue;
   [m.a,m.b].forEach((id,i)=>{const p=rows.get(id);if(!p)return;p.played++;p.won+=Number(m.winner===id);p.lost+=Number(m.loser===id);p.for+=m.score[i];p.against+=m.score[1-i];p.diff=p.for-p.against;
    const duration=data.timings?.[m.id]?.durationSeconds;if(Number.isFinite(duration)){p.seconds+=duration;p.timed++;}
   });
  }
  function eliminated(matches,position,stage){
   const eliminated=[];
   for(const m of matches)if(m.loser&&rows.has(m.loser)){
    const player=rows.get(m.loser),side=m.a===m.loser?0:1;
    Object.assign(player,{stage,roundFor:m.score[side],roundAgainst:m.score[1-side],roundDiff:m.score[side]-m.score[1-side]});
    eliminated.push(player);
   }
   eliminated.sort((a,b)=>b.roundDiff-a.roundDiff||b.diff-a.diff||a.nombre.localeCompare(b.nombre,'es'));
   eliminated.forEach((player,i)=>{const previous=eliminated[i-1];player.position=previous&&player.roundDiff===previous.roundDiff&&player.diff===previous.diff?previous.position:position+i;});
  }
  eliminated(state.rep[0]||[],state.bracketSize*3/4+1,'Grupos · primera eliminación');
  eliminated(state.rep[1]||[],state.bracketSize/2+1,'Grupos · clasificación');
  state.knockout.forEach(round=>eliminated(round,round.length+1,round.length===1?'Subcampeón':round.length===2?'Semifinal':round.length===4?'Cuartos de final':round.length===8?'Octavos de final':'Dieciseisavos de final'));
  if(state.champion){const side=state.final.a===state.champion?0:1;Object.assign(rows.get(state.champion),{position:1,stage:'Campeón',roundFor:state.final.score[side],roundAgainst:state.final.score[1-side],roundDiff:state.final.score[side]-state.final.score[1-side]});}
  return {finished:Boolean(state.champion),matches:state.matches.filter(m=>m.resolved&&!m.bye).length,rows:[...rows.values()].sort((a,b)=>(a.position??0)-(b.position??0)||a.nombre.localeCompare(b.nombre,'es'))};
 }
 return {calculate};
});
