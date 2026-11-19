// Run: node --test test/torneosVisor.test.js. No production database or pushes used.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const path=require('path');
const mount=require('../src/routes/torneosVisor.routes');
function fixture(){
  const sessions=new Map(),avisos=[],llamados=[];
  const players=Array.from({length:8},(_,i)=>({id:String(i+1),jugador_id:i+101,nombre:'Jugador de prueba '+(i+1),position:i+1,foto_path:'',dni:String(30000000+i)}));
  const saved={jugadores:players,resultados:{},revision:0,sorteo_revision:1};
  const result=rows=>({rows});
  const pool={release(){},async connect(){return pool;},async query(sql,args=[]){
    if(sql.includes('CREATE TABLE')||sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return result([]);
    if(sql.includes('INSERT INTO torneo_visor_sesiones')){sessions.set(args[0],{jugador_id:args[1]});return result([]);}
    if(sql.includes('SELECT s.jugador_id')){const s=sessions.get(args[0]);return result(s?[{...s,nombre:players.find(p=>p.jugador_id===s.jugador_id).nombre}]:[]);}
    if(sql.includes('DELETE FROM torneo_visor_sesiones')){sessions.delete(args[0]);return result([]);}
    if(sql.includes('SELECT id,nombre FROM jugadores'))return result(players.filter(p=>p.dni===args[0]).map(p=>({id:p.jugador_id,nombre:p.nombre})));
    if(sql.includes('SELECT id FROM torneo_organizadores'))return result([{id:1}]);
    if(sql.includes('SELECT g.* FROM torneo_grillas'))return result(args[1]==='primera'?[saved]:[]);
    if(sql.includes('DISTINCT ON(match_id)'))return result(llamados);
    if(sql.includes('FROM torneo_inscripciones i'))return result(players.filter(p=>args[1].includes(p.id)).map(p=>({...p,whatsapp:'1123456789'})));
    if(sql.includes('INSERT INTO torneo_llamados')){llamados.push({match_id:args[3],a:args[4],b:args[5],mesa:args[6],piso:args[7]});return result([{id:llamados.length}]);}
    if(sql.includes('INSERT INTO torneo_avisos')){avisos.push({id:String(avisos.length+1),jugador_id:args[1],mensaje:args[2]});return result([]);}
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
  return {app,saved,avisos};
}
if(process.env.VISOR_DEMO==='1')fixture().app.listen(3097,'127.0.0.1',()=>console.log('DEMO ONLY http://localhost:3097/torneos/torneos.html · DNI 30000000'));
else test('DNI session, read-only API, private calls and organizer authorization',async()=>{
  const {app,saved,avisos}=fixture();
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
    assert.equal((await request('torneo-organizador/grilla/primera/llamar',{...call,mesa:20},null,true)).status,400);
    assert.equal((await request('torneo-organizador/grilla/primera/llamar',{...call,revision:9},null,true)).status,409);
    assert.equal((await request('torneo-organizador/grilla/primera/llamar',call,null,true)).status,200);
    assert.equal(avisos.length,2);assert.match(avisos[0].mensaje,/Mesa 19 · Piso arriba/);
    const inbox=await (await request('torneo-visor/avisos?after=0',null,login.token)).json();assert.equal(inbox.avisos.length,1);
    const other=await (await request('torneo-visor/login',{dni:'30000007'})).json();
    assert.equal((await (await request('torneo-visor/avisos?after=0',null,other.token)).json()).avisos.length,0);
    const contact=await (await request('torneo-organizador/grilla/primera/contactar',{...call,playerId:match.a},null,true)).json();assert.match(contact.url,/^https:\/\/wa.me\/5491123456789\?text=/);assert.match(decodeURIComponent(contact.url),/Mesa 19/);
    assert.equal((await request('torneo-visor/logout',{},login.token)).status,200);
    assert.equal((await request('torneo-visor/session',null,login.token)).status,401);
  }finally{}
});
