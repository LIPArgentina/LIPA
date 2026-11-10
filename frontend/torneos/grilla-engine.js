/* Shared tournament rules: used by the page and validated again on the server. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LipaBracket = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const limits = { primera: 7, segunda: 6, tercera: 5 };
  function build(players, stored = {}, category = 'tercera') {
    if (players.length !== 30) throw new Error('Este formato requiere 30 jugadores sorteados.');
    const matches = [], clean = {}, byId = Object.fromEntries(players.map(p => [String(p.id), p]));
    function match(id, a, b, extra = {}) {
      a = a == null ? null : String(a); b = b == null ? null : String(b);
      const old = Object.prototype.hasOwnProperty.call(stored, id) ? stored[id] : null;
      const valid = old && old.a === a && old.b === b && a && b;
      const score = valid && Array.isArray(old.score) ? old.score.map(n => Number.isInteger(n) && n >= 0 && n <= limits[category] ? n : null) : [null, null];
      if (score.length !== 2) score.splice(0, score.length, null, null);
      let winner = null, loser = null;
      if (a && b && score.every(n => n !== null) && score[0] !== score[1]) {
        winner = score[0] > score[1] ? a : b; loser = winner === a ? b : a;
      }
      if (extra.bye && a && !b) winner = a;
      if (a && b && score.some(n => n !== null)) clean[id] = { a, b, score };
      const result = { id, a, b, score, winner, loser, ...extra };
      matches.push(result); return result;
    }
    const first = Array.from({ length: 15 }, (_, i) => match(`p-${i}`, players[i * 2].id, players[i * 2 + 1].id));
    const firstComplete = first.every(m => m.winner);
    let bye = null, rankingFallback = false;
    const losers = firstComplete ? first.map((m, index) => {
      const slot = m.loser === m.a ? 0 : 1;
      return { id: m.loser, points: m.score[slot], diff: m.score[slot] - m.score[1-slot], rank: byId[m.loser].ranking || Infinity, index };
    }) : [];
    if (firstComplete) {
      const priority = [...losers].sort((a,b) => b.points-a.points || b.diff-a.diff || a.rank-b.rank || a.index-b.index);
      bye = priority[0];
      rankingFallback = priority.length > 1 && bye.points === priority[1].points && bye.diff === priority[1].diff && bye.rank === priority[1].rank;
    }
    const remaining = losers.filter(p => p.id !== bye?.id);
    const rep = [Array.from({ length: 7 }, (_, i) => match(`r0-${i}`, remaining[i*2]?.id, remaining[i*2+1]?.id))];
    rep[0].push(match('r0-7', bye?.id, null, { bye: true }));
    for (let round = 1; round < 4; round++) rep.push(Array.from({ length: rep[round-1].length/2 }, (_, i) => match(`r${round}-${i}`, rep[round-1][i*2].winner, rep[round-1][i*2+1].winner)));
    const qualifier = rep[3][0].winner;
    const entry = match('qualifier', qualifier, null, { bye: true });
    const main = [[...first, entry]];
    for (let round = 1; round < 5; round++) main.push(Array.from({ length: main[round-1].length/2 }, (_, i) => match(`m${round}-${i}`, main[round-1][i*2].winner, main[round-1][i*2+1].winner)));
    return { main, rep, matches, clean, bye, firstComplete, qualifier, champion: main[4][0].winner, rankingFallback };
  }
  function invalidated(before, after, editedId) {
    return Object.keys(before.clean).filter(id => id !== editedId && !Object.prototype.hasOwnProperty.call(after.clean, id));
  }
  return { build, invalidated, limits };
});
