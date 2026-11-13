/* Shared tournament rules: used by the page and validated again on the server. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LipaBracket = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const limits = { primera: 7, segunda: 6, tercera: 5 };
  function build(players, stored = {}, category = 'tercera') {
    const capacity=category==='tercera'?60:30, qualifierCount=category==='tercera'?2:1;
    if (players.length !== capacity) throw new Error(`Este formato requiere ${capacity} posiciones sorteadas.`);
    if (category === 'primera' && players.some(p=>p.id===null)) throw new Error('Primera no admite WO.');
    const matches = [], clean = {}, byId = Object.fromEntries(players.filter(p=>p.id!==null).map(p => [String(p.id), p]));
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
    function nextRound(previous,prefix){
      return Array.from({length:previous.length/2},(_,i)=>{
        const a=previous[i*2],b=previous[i*2+1];return match(`${prefix}-${i}`,a.winner,b.winner,a.resolved,b.resolved);
      });
    }
    const first = Array.from({ length: capacity/2 }, (_, i) => match(`p-${i}`, players[i * 2].id, players[i * 2 + 1].id));
    const firstComplete = first.every(m => m.resolved);
    let bye = null, byes=[], rankingFallback = false;
    const losers = firstComplete ? first.filter(m=>m.loser).map((m, index) => {
      const slot = m.loser === m.a ? 0 : 1;
      return { id: m.loser, points: m.score[slot], diff: m.score[slot] - m.score[1-slot], rank: byId[m.loser].ranking || Infinity, index };
    }) : [];
    const repSize=firstComplete?Math.max(qualifierCount*2,2**Math.ceil(Math.log2(Math.max(1,losers.length)))):qualifierCount*16;
    if (firstComplete && losers.length) {
      const priority = [...losers].sort((a,b) => b.points-a.points || b.diff-a.diff || a.rank-b.rank || a.index-b.index);
      byes=priority.slice(0,repSize-losers.length);bye=byes[0] || null;
      const last=byes.at(-1),next=priority[byes.length];
      rankingFallback=Boolean(last && next && last.points===next.points && last.diff===next.diff && last.rank===next.rank);
    }
    const byeIds=new Set(byes.map(p=>p.id));
    const remaining=losers.filter(p=>!byeIds.has(p.id));
    const repPairs=[];
    for(let i=0;i<remaining.length;i+=2)repPairs.push([remaining[i].id,remaining[i+1]?.id]);
    byes.forEach(p=>repPairs.push([p.id,null]));
    const rep=[Array.from({length:repSize/2},(_,i)=>match(`r0-${i}`,repPairs[i]?.[0],repPairs[i]?.[1],firstComplete,firstComplete))];
    for(let round=1;rep[round-1].length>qualifierCount;round++)rep.push(nextRound(rep[round-1],`r${round}`));
    const qualifiers=rep.at(-1).map(m=>m.winner),qualifier=qualifiers[0];
    const entries=rep.at(-1).map((m,i)=>match(qualifierCount===1?'qualifier':`qualifier-${i+1}`,m.winner,null,m.resolved,true));
    const seeded=qualifierCount===1?[...first,entries[0]]:[...first.slice(0,15),entries[0],...first.slice(15),entries[1]];
    const main = [seeded];
    for (let round = 1; main[round-1].length>1; round++) main.push(nextRound(main[round-1],`m${round}`));
    return { main, rep, matches, clean, bye, byes, firstComplete, qualifier, qualifiers, capacity, champion: main.at(-1)[0].winner, rankingFallback, loserCount:losers.length };
  }
  function invalidated(before, after, editedId) {
    return Object.keys(before.clean).filter(id => id !== editedId && !Object.prototype.hasOwnProperty.call(after.clean, id));
  }
  return { build, invalidated, limits };
});
