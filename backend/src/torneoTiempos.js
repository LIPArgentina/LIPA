const bracket=require('../../frontend/torneos/grilla-engine');
const identity=m=>[m.id,m.a,m.b].join('|');
// Pure event projection. Corrections keep the first start/end for the same pairing.
function evolve(previous,players,results,category,event={},now=new Date().toISOString()){
 const entries=JSON.parse(JSON.stringify(previous||[])),state=bracket.build(players,results,category);
 const valid=new Set(state.matches.filter(m=>m.a&&m.b&&!m.bye).map(identity));
 for(const e of entries)if(!e.archived&&(!valid.has(e.key)||event.reset?.includes(e.matchId)))e.archived=now;
 const names=new Map(players.map(p=>[String(p.id),p.nombre]));
 for(const m of state.matches){
  if(!m.a||!m.b||m.bye)continue;
  const key=identity(m);let e=entries.find(e=>e.key===key&&!e.archived);
  if(!e){e={key,matchId:m.id,a:m.a,b:m.b,nameA:names.get(m.a),nameB:names.get(m.b),label:m.label,readyAt:now,assignedAt:null,startedAt:null,endedAt:null,durationSeconds:null,legacy:!event.score&&Boolean(m.winner)};entries.push(e);}
  e.score=m.score;e.winner=m.winner;
  if(event.matchId===m.id&&event.table){e.assignedAt=e.assignedAt||now;e.table=event.table;}
  if(event.matchId===m.id&&event.release&&!e.startedAt){e.assignedAt=null;e.table=null;}
  if(event.matchId===m.id&&event.call)e.startedAt=e.startedAt||now;
  if(m.winner&&!e.endedAt&&!e.legacy){e.endedAt=now;e.durationSeconds=e.startedAt?Math.max(0,Math.floor((Date.parse(now)-Date.parse(e.startedAt))/1000)):null;}
  e.status=m.winner?'finished':e.startedAt&&!e.endedAt?'playing':'waiting';
 }
 return entries;
}
function current(entries){return Object.fromEntries((entries||[]).filter(e=>!e.archived).map(e=>[e.matchId,e]));}
async function read(db,id,category,revision){const {rows}=await db.query('SELECT entries FROM torneo_partidos_tiempos WHERE organizador_id=$1 AND categoria=$2 AND sorteo_revision=$3',[id,category,revision]);return rows[0]?.entries||[];}
async function sync(db,id,category,saved,event={}){
 const prior=await read(db,id,category,saved.sorteo_revision);
 const entries=evolve(prior,saved.jugadores,saved.resultados,category,event);
 if(JSON.stringify(entries)!==JSON.stringify(prior))await db.query(`INSERT INTO torneo_partidos_tiempos(organizador_id,categoria,sorteo_revision,entries) VALUES($1,$2,$3,$4::jsonb)
 ON CONFLICT(organizador_id,categoria,sorteo_revision) DO UPDATE SET entries=EXCLUDED.entries`,[id,category,saved.sorteo_revision,JSON.stringify(entries)]);
 return current(entries);
}
function waitingList(history,arrivals){
 const present=new Map(arrivals.filter(p=>p.en_sala&&p.llegada_at).map(p=>[String(p.id),new Date(p.llegada_at).toISOString()]));
 return history.filter(e=>e.current&&e.status==='waiting').flatMap(e=>{
  if(!e.matchId.startsWith('de-w0-'))return [e];
  if(!present.has(e.a)||!present.has(e.b))return [];
  return [{...e,readyAt:[present.get(e.a),present.get(e.b)].sort().at(-1)}];
 }).sort((a,b)=>a.readyAt.localeCompare(b.readyAt)||a.category.localeCompare(b.category)||a.matchId.localeCompare(b.matchId));
}
module.exports={evolve,current,read,sync,waitingList};
