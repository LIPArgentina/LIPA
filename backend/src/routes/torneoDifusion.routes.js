const multer=require('multer');
const {createHash}=require('crypto');
const maxSize=16*1024*1024;
function validate(file){
 const b=file.buffer,t=file.mimetype;
 const valid=t==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):t==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:t==='image/webp'?b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP':t==='video/mp4'?b.toString('ascii',4,8)==='ftyp':t==='video/webm'?b.subarray(0,4).equals(Buffer.from([26,69,223,163])):false;
 if(!b.length||b.length>maxSize||!valid)throw Error('Archivo inválido. Usá JPG, PNG, WebP, MP4 o WebM de hasta 16 MB.');
 return {name:String(file.originalname).replace(/[\r\n\\/]/g,'_').slice(0,200),type:t,size:b.length,hash:createHash('sha256').update(b).digest('hex')};
}
function mount(router,{pool,ensureSchema,auth}){
 let ready;
 async function schema(){await ensureSchema();if(!ready)ready=pool.query('CREATE TABLE IF NOT EXISTS torneo_difusion_adjuntos (organizador_id INTEGER PRIMARY KEY REFERENCES torneo_organizadores(id) ON DELETE CASCADE, metadata JSONB NOT NULL, contenido BYTEA NOT NULL)').catch(e=>{ready=null;throw e;});await ready;}
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:maxSize,files:1,fields:3,fieldSize:20000}}).single('archivo');
 router.get('/torneo-organizador/mensaje-difusion',auth,async(req,res)=>{try{await schema();const {rows}=await pool.query('SELECT o.mensaje_difusion, a.metadata FROM torneo_organizadores o LEFT JOIN torneo_difusion_adjuntos a ON a.organizador_id=o.id WHERE o.id=$1',[req.user.torneoOrganizadorId]);if(!rows[0])return res.status(404).json({error:'Organizador inexistente.'});res.set('Cache-Control','no-store');res.json({mensaje:rows[0].mensaje_difusion||'',media:rows[0].metadata||null});}catch(e){res.status(500).json({error:'No se pudo cargar el mensaje de difusión.'});}});
 router.get('/torneo-organizador/mensaje-difusion/adjunto',auth,async(req,res)=>{try{await schema();const {rows}=await pool.query('SELECT metadata, contenido FROM torneo_difusion_adjuntos WHERE organizador_id=$1',[req.user.torneoOrganizadorId]);const file=rows[0];if(!file)return res.status(404).json({error:'No hay adjunto guardado.'});if(req.query.hash!==file.metadata.hash)return res.status(409).json({error:'El adjunto cambió. Volvé a preparar la tanda.'});res.set({'Content-Type':file.metadata.type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.send(file.contenido);}catch(e){res.status(500).json({error:'No se pudo cargar el adjunto.'});}});
 router.put('/torneo-organizador/mensaje-difusion',auth,(req,res,next)=>upload(req,res,e=>e?res.status(400).json({error:'No se pudo adjuntar el archivo. Máximo 16 MB.'}):next()),async(req,res)=>{
 const mensaje=req.body?.mensaje,mode=req.body?.mediaMode||'keep';
 if(typeof mensaje!=='string'||!mensaje.trim()||mensaje.length>4000||!['keep','remove','replace'].includes(mode))return res.status(400).json({error:'Escribí un mensaje de hasta 4000 caracteres.'});
 let meta=null,client;
 try{if(mode==='replace'){if(!req.file)throw Error('Seleccioná un archivo.');meta=validate(req.file);}else if(req.file)throw Error('La operación del adjunto no coincide.');}catch(e){return res.status(400).json({error:e.message});}
 try{await schema();client=await pool.connect();await client.query('BEGIN');const id=req.user.torneoOrganizadorId;
 const result=await client.query('UPDATE torneo_organizadores SET mensaje_difusion=$1, updated_at=NOW() WHERE id=$2 RETURNING mensaje_difusion',[mensaje,id]);if(!result.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Organizador inexistente.'});}
 if(mode==='remove')await client.query('DELETE FROM torneo_difusion_adjuntos WHERE organizador_id=$1',[id]);
 if(mode==='replace')await client.query('INSERT INTO torneo_difusion_adjuntos (organizador_id,metadata,contenido) VALUES ($1,$2::jsonb,$3) ON CONFLICT (organizador_id) DO UPDATE SET metadata=EXCLUDED.metadata,contenido=EXCLUDED.contenido',[id,JSON.stringify(meta),req.file.buffer]);
 const {rows}=await client.query('SELECT metadata FROM torneo_difusion_adjuntos WHERE organizador_id=$1',[id]);await client.query('COMMIT');res.json({ok:true,mensaje,media:rows[0]?.metadata||null});
 }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});res.status(500).json({error:'No se pudo guardar el mensaje y su adjunto. Reintentá.'});}finally{client?.release();}
 });
}
module.exports=mount;module.exports.validate=validate;
