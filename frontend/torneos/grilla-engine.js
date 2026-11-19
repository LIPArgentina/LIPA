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
    for(let r=1;main[r-1].length>1;r++)main.push(Array.from({length:main[r-1].length/2},(_,i)=>linked('de-w'+r+'-'+i,source(main[r-1][i*2]),source(main[r-1][i*2+1]),'Ganadores · Ronda '+(r+1)+' · Partido '+(i+1))));
    const rep=[];
    if(size>2){
      rep.push(Array.from({length:size/4},(_,i)=>linked('de-l0-'+i,source(main[0][i*2],'loser'),source(main[0][i*2+1],'loser'),'Perdedores · Ronda 1 · Partido '+(i+1))));
      for(let w=1;w<main.length;w++){
        const previous=rep.at(-1),r=rep.length;
        // Cross opposite neighbouring branches to avoid an immediate rematch.
        rep.push(previous.map((m,i)=>linked('de-l'+r+'-'+i,source(m),source(main[w][previous.length>1?(i^1):i],'loser'),'Perdedores · Ronda '+(r+1)+' · Partido '+(i+1))));
        if(w<main.length-1){const previous=rep.at(-1),r=rep.length;rep.push(Array.from({length:previous.length/2},(_,i)=>linked('de-l'+r+'-'+i,source(previous[i*2]),source(previous[i*2+1]),'Perdedores · Ronda '+(r+1)+' · Partido '+(i+1))));}
      }
    }
    const upper=main.at(-1)[0],lower=rep.length?source(rep.at(-1)[0]):source(upper,'loser');
    const final=linked('de-final',source(upper),lower,'Gran final · Partido único');
    return {format:'double-elimination-v1',main,rep,final,matches,clean,capacity,bracketSize:size,champion:final.winner};
  }

  function invalidated(before, after, editedId) {
    return Object.keys(before.clean).filter(id => id !== editedId && !Object.prototype.hasOwnProperty.call(after.clean, id));
  }
  return { build, invalidated, limits };
});
