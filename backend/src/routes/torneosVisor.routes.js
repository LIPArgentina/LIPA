const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const bracket = require('../../../frontend/torneos/grilla-engine');
const categories = require('../../../frontend/torneos/categorias');
const slots = require('../../../frontend/torneos/cupos');
const mesas = require('../../../frontend/torneos/mesas');
const firebase = require('../../firebase');
const webApp = require('../torneoFirebaseWeb.json');
const { photoUrl } = require('../torneoFoto');

module.exports = function mountViewer(router, { pool, ensureSchema, requireTorneoOrganizador }) {
  let ready;
  const hash = token => crypto.createHash('sha256').update(token).digest('hex');
  const validCategory = value => Object.hasOwn(bracket.limits, value);
  const fail = (status, message) => Object.assign(new Error(message), { status });
  async function schema() {
    await ensureSchema();
    if (!ready) ready = pool.query(`
      CREATE TABLE IF NOT EXISTS torneo_visor_sesiones (
        token_hash TEXT PRIMARY KEY, jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL, installation_id TEXT, fcm_token TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS torneo_llamados (
        id BIGSERIAL PRIMARY KEY, organizador_id INTEGER NOT NULL REFERENCES torneo_organizadores(id),
        categoria TEXT NOT NULL, sorteo_revision INTEGER NOT NULL, match_id TEXT NOT NULL,
        a TEXT NOT NULL, b TEXT NOT NULL, mesa INTEGER NOT NULL CHECK(mesa BETWEEN 1 AND 19),
        piso TEXT NOT NULL CHECK(piso IN ('arriba','abajo')), mensaje TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS torneo_avisos (
        id BIGSERIAL PRIMARY KEY, llamado_id BIGINT NOT NULL REFERENCES torneo_llamados(id) ON DELETE CASCADE,
        jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE, mensaje TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE INDEX IF NOT EXISTS torneo_avisos_jugador_idx ON torneo_avisos(jugador_id,id);
      ALTER TABLE torneo_avisos ADD COLUMN IF NOT EXISTS clave_pendiente UUID;
      ALTER TABLE torneo_avisos ADD COLUMN IF NOT EXISTS inscripcion_id TEXT,
        ADD COLUMN IF NOT EXISTS confirmado_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS torneo_avisos_llamado_idx ON torneo_avisos(llamado_id);
      CREATE INDEX IF NOT EXISTS torneo_llamados_grilla_idx ON torneo_llamados(organizador_id,categoria,sorteo_revision,id DESC);
      ALTER TABLE torneo_llamados ADD COLUMN IF NOT EXISTS estado_grilla TEXT NOT NULL DEFAULT 'activo';
      ALTER TABLE torneo_grillas ADD COLUMN IF NOT EXISTS respaldo_reset JSONB,
        ADD COLUMN IF NOT EXISTS control_revision INTEGER NOT NULL DEFAULT 0;
      UPDATE torneo_grillas g SET mesas=COALESCE((SELECT jsonb_object_agg(m.match_id,jsonb_build_object('a',m.a,'b',m.b,'piso',m.piso,'mesa',m.mesa))
        FROM (SELECT DISTINCT ON(match_id) match_id,a,b,piso,mesa FROM torneo_llamados
          WHERE organizador_id=g.torneo_organizador_id AND categoria=g.categoria AND sorteo_revision=g.sorteo_revision
          ORDER BY match_id,id DESC) m),'{}'::jsonb) WHERE g.mesas IS NULL;
    `).catch(error => { ready = null; throw error; });
    return ready;
  }
  const route = fn => async (req,res) => {
    try { await schema(); res.set('Cache-Control','no-store'); await fn(req,res); }
    catch(error) { if (!error.status) console.error('Torneo visor:',error.message); res.status(error.status || 500).json({error:error.status ? error.message : 'No se pudo completar la operación. Reintentá.'}); }
  };
  async function organizer() {
    const configured = Number(process.env.TORNEO_VISOR_ORGANIZADOR_ID);
    const {rows} = await pool.query(configured ? 'SELECT id FROM torneo_organizadores WHERE id=$1 AND activo=true' :
      `SELECT id FROM torneo_organizadores WHERE activo=true AND slug='rodry-baygo-torneos'`, configured ? [configured] : []);
    return rows.length===1 ? rows[0].id : null;
  }
  async function session(req) {
    const token = String(req.headers.authorization || '').replace(/^Bearer /,'');
    if (!/^[a-f0-9]{64}$/.test(token)) throw fail(401,'Ingresá tu DNI para acceder.');
    const {rows} = await pool.query(`SELECT s.jugador_id,j.nombre FROM torneo_visor_sesiones s JOIN jugadores j ON j.id=s.jugador_id WHERE s.token_hash=$1 AND s.expires_at>NOW()`,[hash(token)]);
    if (!rows[0]) throw fail(401,'Tu sesión venció. Ingresá nuevamente.');
    return {...rows[0], tokenHash:hash(token)};
  }
  async function readGrid(id, category, db=pool) {
    if (!validCategory(category)) throw fail(400,'Categoría inválida.');
    const {rows} = await db.query(`SELECT g.* FROM torneo_grillas g JOIN torneo_sorteos s ON s.torneo_organizador_id=g.torneo_organizador_id AND s.categoria=g.categoria AND s.revision=g.sorteo_revision WHERE g.torneo_organizador_id=$1 AND g.categoria=$2`,[id,category]);
    if (!rows[0]) throw fail(404,'La grilla de esta categoría todavía no fue publicada.');
    return rows[0];
  }
  async function assignments(id, category, revision) {
    const {rows} = await pool.query(`SELECT DISTINCT ON(match_id) match_id,a,b,mesa,piso FROM torneo_llamados WHERE organizador_id=$1 AND categoria=$2 AND sorteo_revision=$3 AND estado_grilla<>'archivado' ORDER BY match_id,id DESC`,[id,category,revision]);
    return Object.fromEntries(rows.map(row=>[row.match_id,row]));
  }
  async function organizerAssignments(id,category,revision){
    const {rows}=await pool.query(`WITH ultimos AS (
      SELECT DISTINCT ON(match_id) id,match_id,a,b,mesa,piso,estado_grilla FROM torneo_llamados
      WHERE organizador_id=$1 AND categoria=$2 AND sorteo_revision=$3 AND estado_grilla<>'archivado' ORDER BY match_id,id DESC
    )
    SELECT u.match_id,u.a,u.b,u.mesa,u.piso,u.id::text AS "callId",u.estado_grilla='recuperado' AS recuperado,
      ARRAY(SELECT json_build_object('inscripcion',v.inscripcion_id,'pendiente',v.clave_pendiente IS NOT NULL,
        'confirmado',v.confirmado_at IS NOT NULL) FROM torneo_avisos v WHERE v.llamado_id=u.id ORDER BY v.id) AS avisos
    FROM ultimos u`,[id,category,revision]);
    return Object.fromEntries(rows.map(({avisos,...match})=>{
      const receipts={};
      const tracked=avisos.some(v=>v.pendiente || v.confirmado || v.inscripcion);
      avisos.forEach((v,index)=>{
        // Older calls always inserted the two recipients in bracket order.
        const player=v.inscripcion || (avisos.length===2 && [match.a,match.b][index]);
        if(player && tracked)receipts[player]=!v.pendiente;
      });
      return [match.match_id,{...match,receipts}];
    }));
  }
  async function playerDivision(playerId){
    const {rows}=await pool.query(`SELECT i.categoria FROM torneo_inscripciones i JOIN jugadores j ON j.id=$2
      WHERE i.torneo_organizador_id=$1 AND i.baja_at IS NULL AND (i.jugador_id=j.id OR
        (i.jugador_id IS NULL AND regexp_replace(i.dni,'[^0-9]','','g')=regexp_replace(j.dni::text,'[^0-9]','','g')))
      ORDER BY (i.jugador_id IS NOT NULL) DESC,i.id LIMIT 1`,[await organizer(),playerId]);
    return Object.keys(bracket.limits).find(category=>categories.includes(rows[0]?.categoria,category)) || null;
  }
  async function presentPlayers(id,category){
    const {rows}=await pool.query(`SELECT id::text FROM torneo_inscripciones WHERE torneo_organizador_id=$1
      AND en_sala AND baja_at IS NULL AND categoria=ANY($2::text[])`,[id,categories.valuesFor(category)]);
    return rows.map(p=>p.id);
  }
  async function occupiedTables(db,id){
    const {rows}=await db.query(`SELECT g.categoria,g.sorteo_revision,g.mesas,g.jugadores,g.resultados
      FROM torneo_grillas g JOIN torneo_sorteos s USING (torneo_organizador_id,categoria)
      WHERE g.torneo_organizador_id=$1 AND g.sorteo_revision=s.revision AND g.mesas<>'{}'::jsonb`,[id]);
    return rows.flatMap(g=>Object.entries(mesas.active(g.mesas,bracket.build(g.jugadores,g.resultados,g.categoria)))
      .map(([matchId,location])=>({...location,category:g.categoria,drawRevision:g.sorteo_revision,matchId})));
  }
  router.post('/torneo-visor/login', rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Demasiados intentos. Esperá unos minutos.'}}), route(async(req,res)=>{
    const raw = String(req.body?.dni || '').trim();
    if (!/^[\d.\s-]{6,16}$/.test(raw)) throw fail(400,'Ingresá un DNI válido.');
    const dni = raw.replace(/\D/g,'');
    if (!/^\d{6,9}$/.test(dni)) throw fail(400,'Ingresá un DNI válido.');
    const {rows} = await pool.query(`SELECT id,nombre FROM jugadores WHERE regexp_replace(dni::text,'[^0-9]','','g')=$1 ORDER BY id LIMIT 2`,[dni]);
    if (!rows.length) throw fail(403,'Tu DNI no figura en la base de datos.');
    if (rows.length>1) throw fail(409,'Este DNI tiene registros duplicados. Contactá a la Comisión.');
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(`INSERT INTO torneo_visor_sesiones(token_hash,jugador_id,expires_at,installation_id) VALUES($1,$2,NOW()+INTERVAL '180 days',$3)`,[hash(token),rows[0].id,String(req.body?.installationId || '').slice(0,160)]);
    res.json({token,nombre:rows[0].nombre,categoria:await playerDivision(rows[0].id)});
  }));
  router.get('/torneo-visor/session',route(async(req,res)=>{const user=await session(req);res.json({nombre:user.nombre,categoria:await playerDivision(user.jugador_id)});}));
  router.post('/torneo-visor/logout',route(async(req,res)=>{const user=await session(req);await pool.query('DELETE FROM torneo_visor_sesiones WHERE token_hash=$1',[user.tokenHash]);res.json({ok:true});}));
  async function currentGrid(id,category,db,includeDraft=false) {
    if (!validCategory(category)) throw fail(400,'Categoría inválida.');
    const {rows}=await db.query(`SELECT g.*, s.orden,
      ARRAY(SELECT i.id::text FROM torneo_inscripciones i
        WHERE i.torneo_organizador_id=g.torneo_organizador_id AND i.categoria=ANY($3::text[])
          AND i.baja_at IS NULL AND i.corroborado AND i.estado_pago IN ('sena','total','efectivo')) AS habilitados
      FROM torneo_grillas g JOIN torneo_sorteos s USING (torneo_organizador_id,categoria)
      WHERE g.torneo_organizador_id=$1 AND g.categoria=$2 AND ($4::boolean OR g.publicada_at IS NOT NULL) AND s.revision=g.sorteo_revision`,
      [id,category,categories.valuesFor(category),includeDraft]);
    const saved=rows[0];
    if (!saved || saved.habilitados.length<2 || !slots.validOrder(saved.orden,saved.habilitados,category,saved.orden.length)
        || saved.jugadores.length!==saved.orden.length || saved.jugadores.some((p,i)=>p.id!==saved.orden[i])) {
      throw fail(404,'Sorteo pendiente para esta categoría.');
    }
    return saved;
  }
  // Public TV projection of the current draw; no contact or payment details.
  router.get('/torneo-visor/tv/:categoria',route(async(req,res)=>{
    res.locals.lecturaVisor=true;
    const id=await organizer(),category=req.params.categoria;
    if(id===null)throw fail(503,'El visor del torneo todavía no está configurado.');
    const saved=await currentGrid(id,category,pool,true);
    const players=saved.jugadores.map(p=>({id:p.id,nombre:p.nombre,wo:p.wo,fotoUrl:photoUrl(p)}));
    const state=bracket.build(players,saved.resultados,category);
    res.json({players,results:state.clean,revision:saved.revision,drawRevision:saved.sorteo_revision});
  }));
  router.get('/torneo-visor/grilla/:categoria',route(async(req,res)=>{
    await session(req);
    res.locals.lecturaVisor=true;
    const id=await organizer(), category=req.params.categoria;
    if (id===null) throw fail(503,'El visor del torneo todavía no está configurado.');
    const saved=await currentGrid(id,category,pool);
    const players=saved.jugadores.map(player=>({
      id:player.id,nombre:player.nombre,position:player.position,ranking:player.ranking,wo:player.wo,fotoUrl:photoUrl(player)
    }));
    const state=bracket.build(players,saved.resultados,category);
    const registered=new Set(players.map(p=>p.id)),reservations=mesas.active(saved.mesas,state);
    const present=(await presentPlayers(id,category)).filter(entrant=>registered.has(entrant));
    res.json({players,results:state.clean,revision:saved.revision,drawRevision:saved.sorteo_revision,present,
      assignments:{...await assignments(id,category,saved.sorteo_revision),...reservations},reservations});
  }));
  router.get('/torneo-visor/avisos',route(async(req,res)=>{
    const user=await session(req), after=String(req.query.after || '0');
    if (!/^\d{1,20}$/.test(after)) throw fail(400,'Consulta inválida.');
    res.locals.lecturaVisor=true;
    const {rows}=await pool.query(`SELECT id::text,mensaje,created_at FROM torneo_avisos WHERE jugador_id=$1 AND id>$2::bigint AND created_at>NOW()-INTERVAL '12 hours'
      AND EXISTS(SELECT 1 FROM torneo_llamados l WHERE l.id=llamado_id AND l.estado_grilla='activo') ORDER BY torneo_avisos.id LIMIT 30`,[user.jugador_id,after]);
    res.json({avisos:rows,serverTime:Date.now()});
  }));
  router.get('/torneo-visor/llamados',route(async(req,res)=>{
    const user=await session(req);
    res.locals.lecturaVisor=true;
    const {rows}=await pool.query(`SELECT id::text,mensaje,clave_pendiente FROM torneo_avisos
      WHERE jugador_id=$1 AND clave_pendiente IS NOT NULL AND EXISTS(SELECT 1 FROM torneo_llamados l WHERE l.id=llamado_id AND l.estado_grilla='activo')
      ORDER BY torneo_avisos.id DESC`,[user.jugador_id]);
    res.json({avisos:rows});
  }));
  router.post('/torneo-visor/avisos/:id/confirmar',route(async(req,res)=>{
    const user=await session(req), id=req.params.id;
    if(!/^[1-9]\d{0,18}$/.test(id) || BigInt(id)>9223372036854775807n)throw fail(400,'Aviso inválido.');
    const result=await pool.query(`UPDATE torneo_avisos SET confirmado_at=CASE WHEN clave_pendiente IS NOT NULL THEN NOW() ELSE confirmado_at END,
      clave_pendiente=NULL WHERE jugador_id=$1 AND id=$2 AND EXISTS(SELECT 1 FROM torneo_llamados l
        WHERE l.id=llamado_id AND l.estado_grilla='activo') RETURNING id`,[user.jugador_id,id]);
    if(!result.rowCount)throw fail(404,'Aviso inexistente.');
    res.json({ok:true});
  }));
  // Web FCM is separate from the native APK, whose current bridge exposes no FCM token.
  router.get('/torneo-visor/push-config',route(async(_req,res)=>{
    let config=webApp.config;
    if (process.env.FIREBASE_WEB_CONFIG) {
      try { config=JSON.parse(process.env.FIREBASE_WEB_CONFIG) || {}; } catch(_) { config={}; }
    }
    const vapidKey=process.env.FIREBASE_WEB_VAPID_KEY || (config.appId===webApp.config.appId ? webApp.vapidKey : '');
    const publicConfig=Object.fromEntries(['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId'].filter(key=>typeof config[key]==='string').map(key=>[key,config[key]]));
    const serverProject=firebase?.app().options.credential.projectId;
    res.json({enabled:Boolean(serverProject && serverProject===publicConfig.projectId && publicConfig.apiKey && publicConfig.messagingSenderId && publicConfig.appId && vapidKey),config:publicConfig,vapidKey});
  }));
  router.post('/torneo-visor/push',route(async(req,res)=>{
    const user=await session(req), token=String(req.body?.token || '');
    if (!token || token.length>4096) throw fail(400,'Dispositivo inválido.');
    await pool.query('UPDATE torneo_visor_sesiones SET fcm_token=NULL WHERE fcm_token=$1',[token]);
    await pool.query('UPDATE torneo_visor_sesiones SET fcm_token=$1 WHERE token_hash=$2',[token,user.tokenHash]);res.json({ok:true});
  }));
  const allTables=Object.entries(mesas.pisos).flatMap(([floor,numbers])=>numbers.map(number=>floor+'-'+number));
  router.get('/torneo-organizador/sorteos/mesas',requireTorneoOrganizador,route(async(req,res)=>{
    const {rows:[settings]}=await pool.query('SELECT mesas_habilitadas,mesas_revision FROM torneo_organizadores WHERE id=$1',[req.user.torneoOrganizadorId]);
    if(!settings)throw fail(404,'No se encontró el organizador.');
    res.json({enabled:settings.mesas_habilitadas??allTables,revision:settings.mesas_revision});
  }));
  router.put('/torneo-organizador/sorteos/mesas',requireTorneoOrganizador,route(async(req,res)=>{
    const {enabled,revision}=req.body||{};
    if(!Number.isInteger(revision) || !Array.isArray(enabled) || enabled.length>allTables.length ||
       enabled.some(key=>!allTables.includes(key)) || new Set(enabled).size!==enabled.length)throw fail(400,'Revisá la selección de mesas.');
    const ordered=allTables.filter(key=>enabled.includes(key));
    const updated=await pool.query(`UPDATE torneo_organizadores SET mesas_habilitadas=$2,mesas_revision=mesas_revision+1
      WHERE id=$1 AND mesas_revision=$3`,[req.user.torneoOrganizadorId,ordered,revision]);
    if(!updated.rowCount)throw fail(409,'La selección cambió. Cerrá y volvé a abrir Administrar mesas.');
    res.json({enabled:ordered,revision:revision+1});
  }));
  router.get('/torneo-organizador/grilla/:categoria/llamados',requireTorneoOrganizador,route(async(req,res)=>{
    const id=req.user.torneoOrganizadorId,category=req.params.categoria;
    if(!validCategory(category))throw fail(400,'Categoría inválida.');
    const {rows:[saved]}=await pool.query(`SELECT g.sorteo_revision,g.publicada_at,g.control_revision,g.revision,o.mesas_habilitadas,g.respaldo_reset->>'fecha' AS respaldo_fecha FROM torneo_grillas g JOIN torneo_sorteos s
      ON s.torneo_organizador_id=g.torneo_organizador_id AND s.categoria=g.categoria AND s.revision=g.sorteo_revision
      JOIN torneo_organizadores o ON o.id=g.torneo_organizador_id
      WHERE g.torneo_organizador_id=$1 AND g.categoria=$2`,[id,category]);
    if(!saved)throw fail(404,'No hay grilla para esta categoría.');
    res.locals.lecturaVisor=true;
    const [owner,locations,present,occupied]=await Promise.all([organizer(),organizerAssignments(id,category,saved.sorteo_revision),presentPlayers(id,category),occupiedTables(pool,id)]);
    res.json({canPublish:id===owner,published:Boolean(saved.publicada_at),drawRevision:saved.sorteo_revision,revision:saved.revision,controlRevision:saved.control_revision,backupDate:saved.respaldo_fecha,assignments:locations,present,occupied,enabledTables:saved.mesas_habilitadas??allTables});
  }));
  require('./torneosReset.routes')(router,{pool,route,requireTorneoOrganizador,readGrid,occupiedTables});
  router.post('/torneo-organizador/grilla/:categoria/:accion(publicar|ocultar)',requireTorneoOrganizador,route(async(req,res)=>{
    const id=req.user.torneoOrganizadorId, category=req.params.categoria;
    const published=req.params.accion==='publicar';
    const {drawRevision,revision}=req.body || {};
    if (id!==await organizer()) throw fail(403,'Este organizador no administra el visor del evento.');
    if (!validCategory(category)) throw fail(400,'Categoría inválida.');
    if (!Number.isInteger(drawRevision) || !Number.isInteger(revision)) throw fail(400,'Falta la versión de la grilla.');
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE torneo_inscripciones IN SHARE MODE');
      await client.query('SELECT id FROM torneo_organizadores WHERE id=$1 FOR UPDATE',[id]);
      if (published) await currentGrid(id,category,client,true);
      const updated=await client.query(`UPDATE torneo_grillas SET publicada_at=CASE WHEN $5 THEN COALESCE(publicada_at,NOW()) ELSE NULL END
        WHERE torneo_organizador_id=$1 AND categoria=$2 AND sorteo_revision=$3 AND revision=$4`,[id,category,drawRevision,revision,published]);
      if (!updated.rowCount) throw fail(409,'La grilla cambió. Recargá la categoría.');
      await client.query('COMMIT');
    } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    res.json({published});
  }));
  async function matchContext(req, allowFinished=false, db=pool) {
    const category=req.params.categoria, saved=await readGrid(req.user.torneoOrganizadorId,category,db);
    if (req.body.drawRevision!==saved.sorteo_revision || req.body.revision!==saved.revision) throw fail(409,'La grilla cambió. Recargá antes de llamar.');
    const match=bracket.build(saved.jugadores,saved.resultados,category).matches.find(m=>m.id===req.body.matchId);
    if (!match?.a || !match?.b || match.bye || (!allowFinished && match.winner)) throw fail(400,'El partido debe tener ambos jugadores y estar pendiente.');
    const {rows}=await db.query(`SELECT i.id::text AS id,i.en_sala,i.nombre_oficial AS nombre,i.whatsapp,COALESCE(i.jugador_id,j.id) AS jugador_id FROM torneo_inscripciones i LEFT JOIN jugadores j ON i.jugador_id IS NULL AND regexp_replace(j.dni::text,'[^0-9]','','g')=regexp_replace(i.dni,'[^0-9]','','g') WHERE i.torneo_organizador_id=$1 AND i.id::text=ANY($2::text[]) AND i.baja_at IS NULL ${allowFinished?'':'FOR SHARE OF i'}`,[req.user.torneoOrganizadorId,[match.a,match.b]]);
    const a=rows.find(p=>p.id===match.a), b=rows.find(p=>p.id===match.b);
    if (!a || !b) throw fail(409,'Cambiaron los participantes. Recargá la grilla.');
    return {saved,match,a,b};
  }
  async function reserve(req,client,calling){
    const {mesa,piso}=req.body || {};
    const release=!calling && mesa===null && piso===null;
    if(!release && !mesas.valid(mesa,piso))throw fail(400,'Elegí una mesa disponible en ese piso.');
    const id=req.user.torneoOrganizadorId,category=req.params.categoria;
    const {rows:[settings]}=await client.query('SELECT mesas_habilitadas FROM torneo_organizadores WHERE id=$1 FOR UPDATE',[id]);
    const context=await matchContext(req,false,client);
    const {saved,match,a,b}=context;
    const old=saved.mesas?.[match.id];
    const previous=old?.a===match.a && old.b===match.b?old:null;
    const key=previous?previous.piso+'-'+previous.mesa:'';
    const selected=release?'':piso+'-'+mesa;
    if(req.body.previous!==undefined && req.body.previous!==key && selected!==key)throw fail(409,'La mesa de este partido cambió. Volvé a elegirla.');
    if(!release){
      if(selected!==key && settings.mesas_habilitadas && !settings.mesas_habilitadas.includes(selected))throw fail(409,'Esa mesa está deshabilitada para el evento. Elegí otra mesa.');
      const missing=[a,b].filter(p=>!p.en_sala);
      if(missing.length)throw fail(409,'Falta marcar en sala a '+missing.map(p=>p.nombre).join(' y ')+'.');
      const occupied=await occupiedTables(client,id);
      if(occupied.some(t=>t.mesa===mesa && t.piso===piso && (t.category!==category || t.matchId!==match.id)))throw fail(409,'Esa mesa ya está asignada a otro partido.');
      if(calling && ((req.body.requireReservation || previous) && key!==selected))throw fail(409,'La mesa de este partido cambió. Revisá la asignación antes de llamar.');
    }
    if(key!==selected){
      const locations={...saved.mesas};
      if(release)delete locations[match.id];else locations[match.id]={mesa,piso,a:match.a,b:match.b};
      await client.query('UPDATE torneo_grillas SET mesas=$1::jsonb,control_revision=control_revision+1 WHERE torneo_organizador_id=$2 AND categoria=$3',[JSON.stringify(locations),id,category]);
    }
    return context;
  }
  router.post('/torneo-organizador/grilla/:categoria/mesa',requireTorneoOrganizador,route(async(req,res)=>{
    const client=await pool.connect();
    try{
      await client.query('BEGIN');await reserve(req,client,false);
      const occupied=await occupiedTables(client,req.user.torneoOrganizadorId);
      await client.query('COMMIT');res.json({occupied});
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
  router.post('/torneo-organizador/grilla/:categoria/llamar',requireTorneoOrganizador,route(async(req,res)=>{
    const {mesa,piso}=req.body || {},client=await pool.connect(),destinations=new Map();
    let callId,mensaje,match;
    try {
      await client.query('BEGIN');
      const context=await reserve(req,client,true);
      const {saved,a,b}=context;match=context.match;
      if (!a.jugador_id || !b.jugador_id || a.jugador_id===b.jugador_id) throw fail(409,'Revisá la vinculación de ambos jugadores antes de llamarlos.');
      for(const player of [a,b])destinations.set(player.jugador_id,crypto.randomUUID());
      mensaje=`Llamado a mesa · ${req.params.categoria.toUpperCase()}\n${a.nombre} vs. ${b.nombre}\nMesa ${mesa} · Piso ${piso}. Presentate para jugar.`;
      const {rows}=await client.query(`INSERT INTO torneo_llamados(organizador_id,categoria,sorteo_revision,match_id,a,b,mesa,piso,mensaje) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[req.user.torneoOrganizadorId,req.params.categoria,saved.sorteo_revision,match.id,match.a,match.b,mesa,piso,mensaje]);
      callId=String(rows[0].id);
      for (const player of [a,b]) await client.query('INSERT INTO torneo_avisos(llamado_id,jugador_id,mensaje,clave_pendiente,inscripcion_id) VALUES($1,$2,$3,$4,$5)',[callId,player.jugador_id,mensaje,destinations.get(player.jugador_id),player.id]);
      await client.query('UPDATE torneo_grillas SET control_revision=control_revision+1 WHERE torneo_organizador_id=$1 AND categoria=$2',[req.user.torneoOrganizadorId,req.params.categoria]);
      await client.query('COMMIT');
    } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    if (firebase) {
      const {rows}=await pool.query('SELECT DISTINCT jugador_id,fcm_token FROM torneo_visor_sesiones WHERE jugador_id=ANY($1::int[]) AND expires_at>NOW() AND fcm_token IS NOT NULL',[[...destinations.keys()]]);
      const messages=rows.map(({jugador_id,fcm_token})=>{
        const key=destinations.get(jugador_id);
        const notification={title:'LIPA · Llamado a mesa',body:mensaje};
        return {token:fcm_token,notification,data:{type:'torneo',title:notification.title,body:notification.body,
          url:'https://lipa.ar/torneos/visor.html#aviso='+key},webpush:{headers:{Urgency:'high'},
          notification:{...notification,tag:'lipa-llamado-'+key,requireInteraction:true,silent:false,vibrate:[350,120,350,120,550]},
          fcmOptions:{link:'https://lipa.ar/torneos/visor.html#aviso='+key}}};
      });
      for(let i=0;i<messages.length;i+=500) {
        const batch=messages.slice(i,i+500);
        try {const sent=await firebase.messaging().sendEach(batch);
          for(let j=0;j<sent.responses.length;j++) if(['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(sent.responses[j].error?.code)) await pool.query('UPDATE torneo_visor_sesiones SET fcm_token=NULL WHERE fcm_token=$1',[batch[j].token]);
        } catch(error) {console.error('Push de llamado:',error.message);}
      }
    }
    res.json({ok:true,mensaje,assignment:{a:match.a,b:match.b,mesa,piso,callId,receipts:{[match.a]:false,[match.b]:false}}});
  }));
  router.post('/torneo-organizador/grilla/:categoria/contactar',requireTorneoOrganizador,route(async(req,res)=>{
    const {a,b}=await matchContext(req,true), player=[a,b].find(p=>p.id===String(req.body.playerId));
    if(!player) throw fail(400,'Jugador inválido.');
    let phone=String(player.whatsapp || '').replace(/\D/g,'');
    if(phone.length===10) phone='549'+phone;
    if(phone.length<10 || phone.length>15) throw fail(404,'Este jugador no tiene un WhatsApp válido cargado.');
    const {mesa,piso}=req.body;
    const ubicacion=Number.isInteger(mesa)&&mesa>=1&&mesa<=19&&['arriba','abajo'].includes(piso)?`\nMesa ${mesa} · Piso ${piso}.`:'';
    res.json({url:`https://wa.me/${phone}?text=${encodeURIComponent(`Hola ${player.nombre}, te esperamos para jugar.\n${req.params.categoria.toUpperCase()} · ${a.nombre} vs. ${b.nombre}${ubicacion}`)}`});
  }));
};
