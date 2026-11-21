(function(root){
 function select(state,category,data){
  const assigned=m=>Boolean(data.timings?.[m.id]?.assignedAt||data.assignments?.[m.id]);
  const groups=state.groups.filter(g=>{const matches=[...g.initial,...g.winners,...g.losers,...g.recovery];return !matches.every(m=>m.resolved)&&(category==='tercera'||matches.some(assigned));});
  return {groups,knockout:state.knockout.flat().some(assigned)};
 }
 if(typeof module==='object'&&module.exports)module.exports=select;else root.LipaTVSelect=select;
})(typeof window==='object'?window:globalThis);
