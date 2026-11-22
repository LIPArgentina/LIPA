const bracket = require('../../../frontend/torneos/grilla-engine');
const categories = require('../../../frontend/torneos/categorias');
const timing = require('../torneoTiempos');

// A substitution is atomic: registration, draw and published snapshot change together.
module.exports = function mountReplacements(router, {pool, ensureSchema, requireTorneoOrganizador}) {
  router.post('/torneo-organizador/inscripciones/:id/reemplazar', requireTorneoOrganizador, async(req,res)=>{
    const organizer=req.user.torneoOrganizadorId, sourceId=String(req.params.id), targetId=String(req.body?.destinoId||'');
    const fail=message=>Object.assign(new Error(message),{status:409});
    let db;
    try {
      if(!/^\d+$/.test(sourceId)||!/^\d+$/.test(targetId)||sourceId===targetId)throw fail('Elegí dos inscripciones diferentes.');
      await ensureSchema(); db=await pool.connect(); await db.query('BEGIN');
      await db.query('LOCK TABLE torneo_inscripciones IN SHARE ROW EXCLUSIVE MODE');
      await db.query('SELECT id FROM torneo_organizadores WHERE id=$1 FOR UPDATE',[organizer]);
      const {rows}=await db.query('SELECT * FROM torneo_inscripciones WHERE torneo_organizador_id=$1 AND id::text=ANY($2::text[]) FOR UPDATE',[organizer,[sourceId,targetId]]);
      const source=rows.find(p=>String(p.id)===sourceId), target=rows.find(p=>String(p.id)===targetId);
      if(!source||!target||source.baja_at||target.baja_at||!source.corroborado||!target.corroborado)throw fail('Ambos jugadores deben tener una inscripción activa y confirmada.');
      const category=source.categoria;
      if(!['primera','segunda','tercera'].includes(category)||categories.includes(target.categoria,category))throw fail('El reemplazo requiere una sola categoría de origen y un destino que aún no participe en ella.');
      const combined=['primera','segunda','tercera'].filter(c=>c===category||categories.includes(target.categoria,c)).join('_');
      if(!categories.valid(combined))throw fail('La combinación de categorías no está disponible.');
      if(!['sena','total','efectivo'].includes(source.estado_pago)||!['sena','total','efectivo'].includes(target.estado_pago))throw fail('Ambas inscripciones deben tener pago registrado.');
      const {rows:draws}=await db.query('SELECT * FROM torneo_sorteos WHERE torneo_organizador_id=$1 AND categoria=$2 FOR UPDATE',[organizer,category]);
      const {rows:grids}=await db.query('SELECT * FROM torneo_grillas WHERE torneo_organizador_id=$1 AND categoria=$2 FOR UPDATE',[organizer,category]);
      const draw=draws[0], grid=grids[0];
      if(!draw||!grid||grid.sorteo_revision!==draw.revision||draw.orden.filter(id=>String(id)===sourceId).length!==1||draw.orden.some(id=>String(id)===targetId))throw fail('No se encontró un único lugar vigente para reemplazar.');
      const matches=bracket.build(grid.jugadores,grid.resultados,category).matches.filter(m=>m.a===sourceId||m.b===sourceId);
      const prior=await timing.read(db,organizer,category,grid.sorteo_revision);
      if(matches.some(m=>(m.score||[]).some(s=>s!==null&&s!==undefined))||prior.some(e=>!e.archived&&(e.a===sourceId||e.b===sourceId)&&(e.startedAt||e.endedAt)))throw fail('El jugador ya tiene un partido iniciado o un resultado. No se modificó la grilla.');
      const {rows:photos}=await db.query('SELECT foto_path FROM jugadores WHERE id=$1',[target.jugador_id]);
      const players=grid.jugadores.map(p=>String(p.id)===sourceId?{...p,id:targetId,jugador_id:target.jugador_id,nombre:target.nombre_oficial,foto_path:photos[0]?.foto_path||'',ranking:null}:p);
      const order=draw.orden.map(id=>String(id)===sourceId?targetId:id);
      const payments={};
      for(const c of ['primera','segunda','tercera'])if(categories.includes(target.categoria,c))payments[c]=target.pagos_categoria?.[c]||{estado_pago:target.estado_pago,monto_sena:target.monto_sena};
      payments[category]=source.pagos_categoria?.[category]||{estado_pago:source.estado_pago,monto_sena:source.monto_sena};
      await db.query(`INSERT INTO torneo_reemplazos(organizador_id,origen_id,destino_id,categoria,respaldo) VALUES($1,$2,$3,$4,$5::jsonb)`,[organizer,sourceId,targetId,category,JSON.stringify({source,target,draw,grid,timings:prior})]);
      await db.query('UPDATE torneo_inscripciones SET categoria=$1,pagos_categoria=$2::jsonb,updated_at=NOW() WHERE id=$3',[combined,JSON.stringify(payments),targetId]);
      await db.query('UPDATE torneo_inscripciones SET baja_at=NOW(),en_sala=false,updated_at=NOW() WHERE id=$1',[sourceId]);
      await db.query('UPDATE torneo_sorteos SET orden=$1::jsonb,updated_at=NOW() WHERE torneo_organizador_id=$2 AND categoria=$3',[JSON.stringify(order),organizer,category]);
      const tables=Object.fromEntries(Object.entries(grid.mesas||{}).filter(([,m])=>m.a!==sourceId&&m.b!==sourceId));
      await db.query('UPDATE torneo_grillas SET jugadores=$1::jsonb,mesas=$2::jsonb,revision=revision+1,control_revision=control_revision+1,updated_at=NOW() WHERE torneo_organizador_id=$3 AND categoria=$4',[JSON.stringify(players),JSON.stringify(tables),organizer,category]);
      await timing.sync(db,organizer,category,{...grid,jugadores:players});
      await db.query('COMMIT');
      res.json({ok:true,nombre:target.nombre_oficial,categoria:category,position:order.indexOf(targetId)+1});
    }catch(error){
      if(db)await db.query('ROLLBACK').catch(()=>{});
      if(!error.status)console.error('Reemplazo de inscripción',error);
      res.status(error.status||500).json({error:error.status?error.message:'No se pudo completar el reemplazo. No se aplicaron cambios.'});
    }finally{db?.release();}
  });
};
