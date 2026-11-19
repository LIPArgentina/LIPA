const bracket=require('../../../frontend/torneos/grilla-engine');
const tables=require('../../../frontend/torneos/mesas');

module.exports=function mountGridResets(router,{pool,route,requireTorneoOrganizador,readGrid,occupiedTables}){
  const fail=(status,message)=>Object.assign(new Error(message),{status});
  const scope="organizador_id=$1 AND categoria=$2 AND sorteo_revision=$3";
  async function archive(client,keys,matchIds){
    await client.query(`UPDATE torneo_llamados SET estado_grilla='archivado'
      WHERE ${scope} AND estado_grilla<>'archivado' AND ($4::text[] IS NULL OR match_id=ANY($4))`,[...keys,matchIds]);
  }
  async function resetMatch(client,grid,keys,matchId){
    const before=bracket.build(grid.jugadores,grid.resultados,keys[1]);
    if(!before.matches.some(m=>m.id===matchId))throw fail(400,'El partido no pertenece a esta grilla.');
    const results={...grid.resultados};delete results[matchId];
    const after=bracket.build(grid.jugadores,results,keys[1]);
    const previous=new Map(before.matches.map(m=>[m.id,m]));
    const affected=after.matches.filter(m=>m.id===matchId || m.a!==previous.get(m.id).a || m.b!==previous.get(m.id).b).map(m=>m.id);
    const locations={...grid.mesas};
    for(const id of affected){delete results[id];delete locations[id];}
    await archive(client,keys,affected);
    await client.query(`UPDATE torneo_grillas SET resultados=$4::jsonb,mesas=$5::jsonb,revision=revision+1,updated_at=NOW()
      WHERE torneo_organizador_id=$1 AND categoria=$2 AND sorteo_revision=$3`,[...keys,JSON.stringify(results),JSON.stringify(locations)]);
  }
  async function resetAll(client,grid,keys){
    const {rows}=await client.query(`SELECT DISTINCT ON(match_id) id::text AS "callId" FROM torneo_llamados
      WHERE ${scope} AND estado_grilla<>'archivado' ORDER BY match_id,torneo_llamados.id DESC`,keys);
    if(!rows.length && !Object.keys(grid.resultados).length && !Object.keys(grid.mesas||{}).length){
      throw fail(400,'Esta categoría ya está en blanco.');
    }
    const copy={fecha:new Date().toISOString(),resultados:grid.resultados,mesas:grid.mesas||{},llamados:rows.map(r=>r.callId)};
    await archive(client,keys,null);
    await client.query(`UPDATE torneo_grillas SET respaldo_reset=$4::jsonb,resultados='{}',mesas='{}',
      publicada_at=NULL,revision=revision+1,updated_at=NOW() WHERE torneo_organizador_id=$1 AND categoria=$2 AND sorteo_revision=$3`,
      [...keys,JSON.stringify(copy)]);
  }
  async function restore(client,grid,keys){
    const copy=grid.respaldo_reset;
    if(!copy)throw fail(404,'Todavía no hay una copia para este sorteo.');
    const locations=tables.active(copy.mesas,bracket.build(grid.jugadores,copy.resultados,keys[1]));
    const occupied=await occupiedTables(client,keys[0]);
    for(const location of Object.values(locations)){
      const conflict=occupied.find(t=>t.category!==keys[1] && t.mesa===location.mesa && t.piso===location.piso);
      if(conflict)throw fail(409,`La mesa ${location.mesa} de ${location.piso} está ocupada en ${conflict.category}. Liberala antes de recuperar esta copia.`);
    }
    await archive(client,keys,null);
    await client.query(`UPDATE torneo_llamados SET estado_grilla='recuperado' WHERE ${scope} AND id=ANY($4::bigint[])`,[...keys,copy.llamados]);
    await client.query(`UPDATE torneo_grillas SET resultados=$4::jsonb,mesas=$5::jsonb,publicada_at=NULL,
      revision=revision+1,updated_at=NOW() WHERE torneo_organizador_id=$1 AND categoria=$2 AND sorteo_revision=$3`,
      [...keys,JSON.stringify(copy.resultados),JSON.stringify(locations)]);
  }
  router.post('/torneo-organizador/grilla/:categoria/control/:accion',requireTorneoOrganizador,route(async(req,res)=>{
    const {categoria,accion}=req.params,id=req.user.torneoOrganizadorId,body=req.body || {};
    if(!['partido','resetear','recuperar'].includes(accion) || body.confirmar!==true)throw fail(400,'Confirmá la operación sobre la grilla.');
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT id FROM torneo_organizadores WHERE id=$1 FOR UPDATE',[id]);
      const grid=await readGrid(id,categoria,client);
      if(grid.sorteo_revision!==body.drawRevision || grid.revision!==body.revision || grid.control_revision!==body.controlRevision){
        throw fail(409,'La grilla cambió desde que la abriste. Recargala antes de continuar.');
      }
      const keys=[id,categoria,grid.sorteo_revision];
      if(accion==='partido')await resetMatch(client,grid,keys,body.matchId);
      if(accion==='resetear')await resetAll(client,grid,keys);
      if(accion==='recuperar')await restore(client,grid,keys);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    res.json({ok:true});
  }));
};
