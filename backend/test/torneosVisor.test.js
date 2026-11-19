// Run: node --test test/torneosVisor.test.js. No production database or pushes used.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const path=require('path');
const mount=require('../src/routes/torneosVisor.routes');
function fixture(){
  const sessions=new Map(),avisos=[],llamados=[];
  const players=Array.from({length:8},(_,i)=>({id:String(i+1),jugador_id:i+101,nombre:'Jugador de prueba '+(i+1),position:i+1,foto_path:'',dni:String(30000000+i)}));
  players.forEach(p=>{p.en_sala=true;p.categoria='primera';});
  const saved={jugadores:players,resultados:{},revision:0,sorteo_revision:1,control_revision:0,categoria:'primera',mesas:{}};
  const draw={visible:true,orden:players.map(p=>p.id),habilitados:players.map(p=>p.id)};
  const result=rows=>({rows});
  const pool={release(){},async connect(){return pool;},async query(sql,args=[]){
    if(sql.includes('CREATE TABLE')||sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return result([]);
    if(sql.includes('INSERT INTO torneo_visor_sesiones')){sessions.set(args[0],{jugador_id:args[1]});return result([]);}
    if(sql.includes('SELECT s.jugador_id')){const s=sessions.get(args[0]);return result(s?[{...s,nombre:players.find(p=>p.jugador_id===s.jugador_id).nombre}]:[]);}
    if(sql.includes('DELETE FROM torneo_visor_sesiones')){sessions.delete(args[0]);return result([]);}
    if(sql.includes('SELECT id,nombre FROM jugadores'))return result(players.filter(p=>p.dni===args[0]).map(p=>({id:p.jugador_id,nombre:p.nombre})));
    if(sql.includes('SELECT i.categoria FROM torneo_inscripciones'))return result(players.filter(p=>p.jugador_id===args[1]));
    if(sql.includes('AND en_sala AND baja_at'))return result(players.filter(p=>p.en_sala));
    if(sql.includes('SELECT g.categoria,g.sorteo_revision,g.mesas'))return result([saved]);
    if(sql.startsWith('UPDATE torneo_grillas SET mesas=')){saved.mesas=JSON.parse(args[0]);saved.control_revision++;return result([]);}
    if(sql.includes('SELECT id FROM torneo_organizadores'))return result([{id:1}]);
    if(sql.includes('SELECT g.* FROM torneo_grillas') || sql.includes('SELECT g.sorteo_revision,g.publicada_at'))return result(args[1]==='primera'?[saved]:[]);
    if(sql.startsWith('UPDATE torneo_grillas SET control_revision=')){saved.control_revision++;return result([]);}
    if(sql.includes('AS habilitados') && sql.includes('g.publicada_at IS NOT NULL') && sql.includes('s.revision=g.sorteo_revision'))return result((args[3] || draw.visible) && args[1]==='primera'?[{...saved,...draw}]:[]);
    if(sql.startsWith('LOCK TABLE'))return result([]);
    if(sql.startsWith('UPDATE torneo_grillas SET publicada_at')){draw.visible=true;return result([]);}
    if(sql.includes('DISTINCT ON(match_id)')){
      const latest=[...new Map(llamados.map(call=>[call.match_id,call])).values()];
      return result(latest.map(call=>sql.includes('WITH ultimos')?{...call,avisos:avisos.filter(v=>v.llamado_id===call.callId).map(v=>({
        inscripcion:v.inscripcion_id,pendiente:Boolean(v.clave_pendiente),confirmado:Boolean(v.confirmado_at)
      }))}:{match_id:call.match_id,a:call.a,b:call.b,mesa:call.mesa,piso:call.piso}));
    }
    if(sql.includes('FROM torneo_inscripciones i'))return result(players.filter(p=>args[1].includes(p.id)).map(p=>({...p,whatsapp:'1123456789'})));
    if(sql.includes('INSERT INTO torneo_llamados')){llamados.push({callId:String(llamados.length+1),match_id:args[3],a:args[4],b:args[5],mesa:args[6],piso:args[7]});return result([{id:llamados.length}]);}
    if(sql.includes('INSERT INTO torneo_avisos')){avisos.push({id:String(avisos.length+1),llamado_id:args[0],jugador_id:args[1],mensaje:args[2],clave_pendiente:args[3],inscripcion_id:args[4],created_at:new Date().toISOString()});return result([]);}
    if(sql.includes('SELECT id::text,mensaje,clave_pendiente FROM torneo_avisos'))return result(avisos.filter(a=>a.jugador_id===args[0] && a.clave_pendiente).reverse());
    if(sql.includes('UPDATE torneo_avisos')){
      const item=avisos.find(a=>a.jugador_id===args[0] && a.id===args[1]);
      if(item?.clave_pendiente){item.confirmado_at=new Date();item.clave_pendiente=null;}
      return {rowCount:item?1:0};
    }
    if(sql.includes('FROM torneo_avisos'))return result(avisos.filter(a=>a.jugador_id===args[0]&&BigInt(a.id)>BigInt(args[1])));
    if(sql.includes('UPDATE torneo_visor_sesiones'))return result([]);
    throw new Error('Unexpected query: '+sql);
  }};
  const app=express();app.use(express.json());
  const router=express.Router();
  mount(router,{pool,ensureSchema:async()=>{},requireTorneoOrganizador(req,res,next){if(req.headers['x-demo-organizer']==='yes'||process.env.VISOR_DEMO==='1'){req.user={torneoOrganizadorId:1};next();}else res.status(403).json({error:'Sin permisos'});}});
  app.use('/api',router);
  if(process.env.VISOR_DEMO==='1'){
    app.get('/config.js',(_req,res)=>res.type('js').send("window.APP_CONFIG={API_BASE_URL:location.origin};window.LPI_AUTH={readSession:()=>({role:'torneo'})};"));
    app.get('/api/torneos',(_req,res)=>res.json({torneos:[{sala:'Sala de prueba',categoria:'Segunda',fechaHora:'2026-12-01T20:00:00',mediaUrl:'/assets/lipa-rodry-grilla.png',valor:10000}]}));
    app.get('/api/torneo-organizador/grilla/:categoria',(_req,res)=>res.json({players,results:{},revision:0,drawRevision:1}));
    app.use(express.static(path.resolve(__dirname,'../../frontend')));
  }
  app.use((_req,res)=>res.status(404).json({error:'Not found'}));
  return {app,saved,avisos,draw};
}
if(process.env.VISOR_DEMO==='1'){
  const port=Number(process.env.VISOR_DEMO_PORT || 3097);
  fixture().app.listen(port,'127.0.0.1',()=>console.log('DEMO ONLY http://localhost:'+port+'/torneos/torneos.html · DNI 30000000'));
}
else test('DNI session, read-only API, private calls and organizer authorization',async()=>{
  const {app,saved,avisos,draw}=fixture();
  const http=require('http'),net=require('net');
  async function request(url,body,token,organizer=false,method){return new Promise((resolve,reject)=>{
    const req=new http.IncomingMessage(new net.Socket());req.url='/api/'+url;req.method=method||(body?'POST':'GET');req.body=body;req._body=true;req.headers={...(token?{authorization:'Bearer '+token}:{}),...(organizer?{'x-demo-organizer':'yes'}:{})};Object.defineProperty(req.socket,'remoteAddress',{value:'127.0.0.1'});
    const res=new http.ServerResponse(req);res.end=function(chunk){const value=chunk?.toString()||'{}';resolve({status:this.statusCode,json:async()=>JSON.parse(value)});};app.handle(req,res,reject);
  });}
  try{
    assert.equal((await request('torneo-visor/grilla/primera')).status,401);
    assert.equal((await request('torneo-visor/login',{dni:'99999999'})).status,403);
    assert.equal((await request('torneo-visor/login',{dni:'abc30000000'})).status,400);
    const login=await (await request('torneo-visor/login',{dni:'30.000.000'})).json();assert.match(login.token,/^[a-f0-9]{64}$/);
    draw.visible=false;
    const hidden=await request('torneo-visor/grilla/primera',null,login.token);
    assert.equal(hidden.status,404);assert.deepEqual(await hidden.json(),{error:'Sorteo pendiente para esta categoría.'});
    const publish={drawRevision:1,revision:0};
    const resetPath='torneo-organizador/grilla/primera/control/';
    const control={...publish,controlRevision:0,confirmar:true};
    assert.equal((await request(resetPath+'resetear',control,login.token)).status,403);
    assert.equal((await request(resetPath+'resetear',{...control,confirmar:false},null,true)).status,400);
    assert.equal((await request(resetPath+'recuperar',control,null,true)).status,404);
    assert.equal((await request(resetPath+'partido',{...control,matchId:'invalid'},null,true)).status,400);
    assert.equal((await request(resetPath+'resetear',{...control,controlRevision:2},null,true)).status,409);
    assert.equal((await request('torneo-organizador/grilla/primera/publicar',publish,login.token)).status,403);
    assert.equal((await request('torneo-organizador/grilla/primera/publicar',{...publish,drawRevision:2},null,true)).status,409);
    assert.equal(draw.visible,false);
    assert.equal((await request('torneo-organizador/grilla/primera/publicar',publish,null,true)).status,200);
    assert.equal(draw.visible,true);
    draw.habilitados.push('99');
    assert.equal((await request('torneo-visor/grilla/primera',null,login.token)).status,404);
    draw.habilitados.pop();
    saved.jugadores[0].foto_path='30000000_1720000000000.jpg';
    const view=await (await request('torneo-visor/grilla/primera',null,login.token)).json();
    assert.doesNotMatch(JSON.stringify(view),/30000000|foto_path/);
    const [,id,code]=view.players[0].fotoUrl.match(/^\/api\/torneo-foto\/(\d+)\/([a-f0-9]{64})$/);
    const {validPhoto}=require('../src/torneoFoto');
    assert.ok(validPhoto(id,code));
    assert.equal(validPhoto('2',code),false);
    assert.equal(view.players.length,8);assert.equal(view.players[0].dni,undefined);assert.equal(view.players[0].jugador_id,undefined);
    assert.equal((await request('torneo-visor/grilla/primera',{},login.token,false,'PATCH')).status,404);
    assert.equal((await request('torneo-organizador/grilla/primera/llamar',{},login.token)).status,403);
    const match=require('../../frontend/torneos/grilla-engine').build(saved.jugadores,{},'primera').matches.find(m=>m.a&&m.b&&!m.bye);
    const call={matchId:match.id,revision:0,drawRevision:1,mesa:19,piso:'arriba'};
    assert.equal(login.categoria,'primera');
    const reserve='torneo-organizador/grilla/primera/mesa',ring='torneo-organizador/grilla/primera/llamar';
    saved.jugadores[1].en_sala=false;
    assert.equal((await request(reserve,call,null,true)).status,409);
    assert.equal((await request(ring,call,null,true)).status,409);
    assert.equal(avisos.length,0);
    saved.jugadores[1].en_sala=true;
    assert.equal((await request(reserve,{...call,piso:'abajo'},null,true)).status,400);
    const table1={...call,mesa:1};
    assert.equal((await request(reserve,table1,null,true)).status,200);
    assert.equal((await request(reserve,{...table1,matchId:'de-w0-1'},null,true)).status,409);
    assert.equal((await request(ring,{...table1,matchId:'de-w0-1'},null,true)).status,409);
    assert.equal((await request(reserve,{...table1,matchId:'de-w0-1',piso:'abajo'},null,true)).status,200);
    assert.equal((await request(reserve,{...table1,mesa:null,piso:null},null,true)).status,200);
    assert.equal((await request(reserve,call,null,true)).status,200);
    assert.equal(avisos.length,0);
    draw.visible=false;
    assert.equal((await request('torneo-organizador/grilla/primera/llamar',{...call,mesa:20},null,true)).status,400);
    assert.equal((await request('torneo-organizador/grilla/primera/llamar',{...call,revision:9},null,true)).status,409);
    const later={...call,matchId:'de-w1-0'};
    assert.equal((await request('torneo-organizador/grilla/primera/llamar',later,null,true)).status,400);
    assert.equal(avisos.length,0);
    assert.equal((await request('torneo-organizador/grilla/primera/llamar',call,null,true)).status,200);
    assert.equal(avisos.length,2);assert.match(avisos[0].mensaje,/Mesa 19 · Piso arriba/);
    assert.equal((await request('torneo-visor/grilla/primera',null,login.token)).status,404);
    const inbox=await (await request('torneo-visor/avisos?after=0',null,login.token)).json();assert.equal(inbox.avisos.length,1);
    assert.ok(Date.parse(inbox.avisos[0].created_at)<=inbox.serverTime);
    saved.resultados={'de-w0-0':{a:'1',b:'2',score:[7,1]},'de-w0-1':{a:'3',b:'4',score:[1,7]}};
    assert.equal((await request('torneo-organizador/grilla/primera/llamar',later,null,true)).status,200);
    assert.deepEqual(avisos.slice(-2).map(call=>call.jugador_id),[101,104]);
    const list=async()=> (await (await request('torneo-visor/llamados',null,login.token)).json()).avisos;
    const calls=await list();
    assert.equal(calls.length,2);
    assert.ok(calls.every(call=>call.clave_pendiente));
    assert.notEqual(avisos[0].clave_pendiente,avisos[1].clave_pendiente);
    const confirm=id=>'torneo-visor/avisos/'+id+'/confirmar';
    assert.equal((await request(confirm(avisos[1].id),{},login.token)).status,404);
    assert.equal((await request(confirm(calls[0].id),{})).status,401);
    assert.equal((await request(confirm(calls[0].id),{},login.token)).status,200);
    assert.equal((await request(confirm(calls[0].id),{},login.token)).status,200);
    assert.equal((await list()).filter(call=>call.clave_pendiente).length,1);
    assert.equal((await list()).some(call=>call.id===calls[0].id),false);
    const locationInfo='torneo-organizador/grilla/primera/llamados';
    const receipts=async matchId=>(await (await request(locationInfo,null,null,true)).json()).assignments[matchId].receipts;
    assert.equal((await request(locationInfo,null,login.token)).status,403);
    assert.deepEqual(await receipts(later.matchId),{'1':true,'4':false});
    assert.deepEqual(await receipts(match.id),{'1':false,'2':false});
    assert.equal((await request('torneo-organizador/grilla/primera/llamar',later,null,true)).status,200);
    assert.deepEqual(await receipts(later.matchId),{'1':false,'4':false});
    draw.visible=true;
    const publicGrid=await (await request('torneo-visor/grilla/primera',null,login.token)).json();
    assert.doesNotMatch(JSON.stringify(publicGrid),/receipts|clave_pendiente|confirmado_at/);
    assert.ok(avisos[1].clave_pendiente);
    const other=await (await request('torneo-visor/login',{dni:'30000007'})).json();
    assert.equal((await (await request('torneo-visor/avisos?after=0',null,other.token)).json()).avisos.length,0);
    const contact=await (await request('torneo-organizador/grilla/primera/contactar',{...call,playerId:match.a},null,true)).json();assert.match(contact.url,/^https:\/\/wa.me\/5491123456789\?text=/);assert.match(decodeURIComponent(contact.url),/Mesa 19/);
    assert.equal((await request('torneo-visor/logout',{},login.token)).status,200);
    assert.equal((await request('torneo-visor/session',null,login.token)).status,401);
  }finally{}
});
