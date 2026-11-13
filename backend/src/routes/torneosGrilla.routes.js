const bracket = require('../../../frontend/torneos/grilla-engine');
const categories = require('../../../frontend/torneos/categorias');
const slots = require('../../../frontend/torneos/cupos');

module.exports = function mountGrillaRoutes(router, { pool, ensureSchema, requireTorneoOrganizador, getTournamentRanking }) {
  const divisions = Object.keys(bracket.limits);
  const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
  async function context(client, organizer, category) {
    const { rows: draws } = await client.query('SELECT orden, revision FROM torneo_sorteos WHERE torneo_organizador_id=$1 AND categoria=$2', [organizer, category]);
    const draw = draws[0];
    if (!draw) throw fail(422, 'Primero guardá el sorteo de esta categoría.');
    const { rows } = await client.query(`SELECT i.id::text AS id, i.jugador_id, i.nombre_oficial AS nombre, COALESCE(j.foto_path,'') AS foto_path
      FROM torneo_inscripciones i LEFT JOIN jugadores j ON j.id=i.jugador_id
      WHERE i.torneo_organizador_id=$1 AND i.categoria = ANY($2::text[]) AND i.corroborado=true`, [organizer, categories.valuesFor(category)]);
    const ids = draw.orden.map(id=>id===null?null:String(id)), players = new Map(rows.map(p => [p.id,p]));
    const capacity=slots.capacity(category);
    if (ids.length !== capacity || (slots.enabled(category) ? rows.length<2 || rows.length>capacity : rows.length!==30)) throw fail(422, slots.enabled(category)?`Esta grilla admite de 2 a ${capacity} jugadores; guardá un nuevo sorteo para aplicar este formato.`:'Este formato requiere exactamente 30 jugadores confirmados y sorteados en la categoría.');
    if (!slots.validOrder(ids, [...players.keys()], category)) throw fail(409, 'Cambiaron los participantes o los WO. Revisá las inscripciones y repetí el sorteo.');
    return { draw, players: ids.map(id => id===null?{id:null,nombre:'WO',wo:true,foto_path:''}:players.get(id)) };
  }
  async function lock(client, organizer) {
    await client.query('BEGIN');
    await client.query('LOCK TABLE torneo_inscripciones IN SHARE MODE');
    await client.query('SELECT id FROM torneo_organizadores WHERE id=$1 FOR UPDATE', [organizer]);
  }
  router.get('/torneo-organizador/grilla/:categoria', requireTorneoOrganizador, async (req,res) => {
    const category = req.params.categoria, organizer = req.user.torneoOrganizadorId;
    if (!divisions.includes(category)) return res.status(400).json({error:'Categoría inválida.'});
    let client;
    try {
      await ensureSchema();
      const initial = await context(pool, organizer, category);
      const { rows: prior } = await pool.query('SELECT sorteo_revision FROM torneo_grillas WHERE torneo_organizador_id=$1 AND categoria=$2', [organizer, category]);
      // Freeze the published Total/RAD order when a new bracket is first opened.
      let positions = new Map();
      if (!prior.length || prior[0].sorteo_revision !== initial.draw.revision) {
        const ranking = await getTournamentRanking(category);
        ranking.forEach((p,i) => { const id = String(p.id || p.playerId || ''); if (id && !positions.has(id)) positions.set(id,i+1); });
      }
      client = await pool.connect();
      await lock(client, organizer);
      const current = await context(client, organizer, category);
      if (current.draw.revision !== initial.draw.revision) throw fail(409,'El sorteo cambió. Recargá la página.');
      const snapshot = current.players.map((p,i) => ({...p, position:i+1, ranking:positions.get(String(p.jugador_id)) || null}));
      await client.query(`INSERT INTO torneo_grillas (torneo_organizador_id,categoria,sorteo_revision,jugadores)
        VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (torneo_organizador_id,categoria) DO NOTHING`, [organizer,category,current.draw.revision,JSON.stringify(snapshot)]);
      const {rows} = await client.query('SELECT * FROM torneo_grillas WHERE torneo_organizador_id=$1 AND categoria=$2', [organizer,category]);
      const saved = rows[0];
      if (saved.sorteo_revision !== current.draw.revision) throw fail(409,'La grilla corresponde a otro sorteo. Repetí el sorteo para reiniciarla.');
      const currentPlayers = new Map(current.players.map(p=>[p.id,p]));
      const players = saved.jugadores.map(p=>({...p,
        nombre:currentPlayers.get(p.id).nombre, foto_path:currentPlayers.get(p.id).foto_path
      }));
      await client.query('COMMIT');
      res.set('Cache-Control','no-store');
      res.json({players, results:saved.resultados, revision:saved.revision, drawRevision:saved.sorteo_revision});
    } catch(error) {
      if(client) await client.query('ROLLBACK').catch(()=>{});
      if(!error.status) console.error('GET torneo grilla',error);
      res.status(error.status || 500).json({error:error.status ? error.message : 'No se pudo cargar la grilla y el ranking LIPA. Reintentá.'});
    } finally { client?.release(); }
  });
  router.patch('/torneo-organizador/grilla/:categoria', requireTorneoOrganizador, async(req,res)=>{
    const category=req.params.categoria, organizer=req.user.torneoOrganizadorId;
    const {matchId, score, revision, drawRevision, confirmCorrection}=req.body || {};
    if(!divisions.includes(category) || typeof matchId!=='string' || !Array.isArray(score) || score.length!==2
      || !score.every(n=>n===null || (Number.isInteger(n)&&n>=0&&n<=bracket.limits[category]))
      || !Number.isSafeInteger(revision) || revision<0 || !Number.isSafeInteger(drawRevision)) {
      return res.status(400).json({error:'Resultado inválido.'});
    }
    let client;
    try {
      await ensureSchema(); client=await pool.connect(); await lock(client,organizer);
      const current=await context(client,organizer,category);
      const {rows}=await client.query('SELECT * FROM torneo_grillas WHERE torneo_organizador_id=$1 AND categoria=$2',[organizer,category]);
      const saved=rows[0];
      if(!saved || saved.revision!==revision || saved.sorteo_revision!==drawRevision || current.draw.revision!==drawRevision) throw fail(409,'La grilla cambió en otra ventana. Recargá antes de continuar.','STALE');
      const before=bracket.build(saved.jugadores,saved.resultados,category);
      const match=before.matches.find(m=>m.id===matchId);
      if(!match || !match.a || !match.b || match.bye) throw fail(400,'Este partido todavía no tiene ambos jugadores.');
      const after=bracket.build(saved.jugadores,{...before.clean,[matchId]:{a:match.a,b:match.b,score}},category);
      const cleared=bracket.invalidated(before,after,matchId);
      if(cleared.length && confirmCorrection!==true) throw fail(409,'La corrección borra resultados posteriores afectados. Confirmá para continuar.','CONFIRM_CORRECTION');
      const {rows: updated}=await client.query(`UPDATE torneo_grillas SET resultados=$1::jsonb, revision=revision+1,updated_at=NOW()
        WHERE torneo_organizador_id=$2 AND categoria=$3 RETURNING revision`,[JSON.stringify(after.clean),organizer,category]);
      await client.query('COMMIT');
      res.json({results:after.clean,revision:updated[0].revision,cleared});
    } catch(error) {
      if(client) await client.query('ROLLBACK').catch(()=>{});
      if(!error.status) console.error('PATCH torneo grilla',error);
      res.status(error.status || 500).json({code:error.code,error:error.status ? error.message : 'No se pudo guardar. Reintentá sin cerrar la página.'});
    } finally { client?.release(); }
  });
};
