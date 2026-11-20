/* Shared tournament rules: used by the page and validated again on the server. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LipaBracket = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const limits = { primera: 7, segunda: 6, tercera: 5 };
  function build(players, stored = {}, category = 'tercera') {
    const capacity=players.length;
    if (capacity<2) throw new Error('Se necesitan al menos dos jugadores.');

    const matches = [], clean = {};
    function match(id, a, b, readyA=true, readyB=true) {
      a = a == null ? null : String(a); b = b == null ? null : String(b);
      const old = Object.prototype.hasOwnProperty.call(stored, id) ? stored[id] : null;
      const valid = old && old.a === a && old.b === b && a && b;
      const score = valid && Array.isArray(old.score) ? old.score.map(n => Number.isInteger(n) && n >= 0 && n <= limits[category] ? n : null) : [null, null];
      if (score.length !== 2) score.splice(0, score.length, null, null);
      let winner = null, loser = null, resolved = false;
      if (a && b && score.every(n => n !== null) && score[0] !== score[1]) {
        winner = score[0] > score[1] ? a : b; loser = winner === a ? b : a; resolved=true;
      }
      const woA=readyA && !a, woB=readyB && !b;
      const bye=readyA && readyB && (!a || !b);
      if(bye){winner=a||b;resolved=true;}
      if (a && b && score.some(n => n !== null)) clean[id] = { a, b, score };
      const result = { id, a, b, score, winner, loser, resolved, bye, woA, woB };
      matches.push(result); return result;
    }
    // Stable power-of-two winners tree; original draw positions never move.
    const size=2**Math.ceil(Math.log2(capacity));
    const source=(m,outcome='winner')=>({id:m[outcome],ready:m.resolved,matchId:m.id,outcome});
    const seed=i=>({id:players[i]?.id??null,ready:true,position:i+1});
    function linked(id,a,b,label){
      const m=match(id,a.id,b.id,a.ready,b.ready);m.sources=[a,b];m.label=label;return m;
    }
    const main=[Array.from({length:size/2},(_,i)=>linked('de-w0-'+i,seed(i*2),seed(i*2+1),'Ganadores · Ronda 1 · Partido '+(i+1)))];
    if(size>2)main.push(Array.from({length:size/4},(_,i)=>linked('de-w1-'+i,source(main[0][i*2]),source(main[0][i*2+1]),'Ganadores · Ronda 2 · Partido '+(i+1))));
    const rep=[];
    if(size>2){
      rep.push(Array.from({length:size/4},(_,i)=>linked('de-l0-'+i,source(main[0][i*2],'loser'),source(main[0][i*2+1],'loser'),'Perdedores · Ronda 1 · Partido '+(i+1))));
      rep.push(rep[0].map((m,i)=>linked('de-l1-'+i,source(m),source(main[1][rep[0].length>1?(i^1):i],'loser'),'Perdedores · Ronda 2 · Partido '+(i+1))));
    }
    const qualifiers=main.at(-1),count=qualifiers.length;
    // Pair undefeated players with recovered players from distant draw branches.
    const grouped=size===64;
    const mapping=[[14,13],[8,7],[12,11],[10,9],[2,1],[6,5],[15,16],[4,3]];
    const groups=grouped?mapping.map((p,i)=>({number:i+1,initial:main[0].slice(i*4,i*4+4),winners:main[1].slice(i*2,i*2+2),losers:rep[0].slice(i*2,i*2+2),recovery:rep[1].slice(i*2,i*2+2),codes:{g:[(i*2+1)+'G',(i*2+2)+'G'],p:p.map(n=>n+'P')}})):[];
    groups.forEach(g=>{for(const [key,label] of [['initial','Inicial'],['winners','Ganadores'],['losers','Perdedores'],['recovery','Clasificación']])g[key].forEach((m,i)=>{m.label='Grupo '+g.number+' · '+label+' '+(i+1);});});
    const recovered=new Map();groups.forEach(g=>g.recovery.forEach((m,i)=>recovered.set(Number(g.codes.p[i].slice(0,-1)),m)));
    const order=grouped?[1,3,5,7,9,11,13,15,2,4,6,8,10,12,14,16]:qualifiers.map((_,i)=>i+1);
    const prefix=grouped?'gx-k':'mx-k';
    const knockout=[order.map((number,i)=>{
      const m=qualifiers[number-1];
      const a=source(m),b=rep.length?source(grouped?recovered.get(number):rep[1][count>=4?(i+count/2)%count:i]):source(m,'loser');
      if(grouped){a.code=number+'G';b.code=number+'P';}
      const result=linked(prefix+'0-'+i,a,b,'Eliminación directa · Ronda 1 · Partido '+(i+1));
      if(grouped)result.qualifierNumber=number;
      return result;
    })];
    for(let r=1;knockout[r-1].length>1;r++)knockout.push(Array.from({length:knockout[r-1].length/2},(_,i)=>linked(prefix+r+'-'+i,source(knockout[r-1][i*2]),source(knockout[r-1][i*2+1]),'Eliminación directa · Ronda '+(r+1)+' · Partido '+(i+1))));
    const final=knockout.at(-1)[0];final.label='Final · Partido único';
    return {format:grouped?'eight-groups-v1':'mixed-two-rounds-v1',groups,main,rep,knockout,final,matches,clean,capacity,bracketSize:size,champion:final.winner};
  }

  function invalidated(before, after, editedId) {
    return Object.keys(before.clean).filter(id => id !== editedId && !Object.prototype.hasOwnProperty.call(after.clean, id));
  }
  return { build, invalidated, limits };
});
