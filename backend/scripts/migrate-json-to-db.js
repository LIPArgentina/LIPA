#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function canonicalSlug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function readJson(p){
  return JSON.parse(fs.readFileSync(p,"utf8"));
}

async function main(){

  const projectRoot = process.argv.includes("--project-root")
    ? process.argv[process.argv.indexOf("--project-root")+1]
    : process.cwd();

  const dryRun = process.argv.includes("--dry-run");

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized:false }
  });

  if(!dryRun) await client.connect();

  const usuariosDir = path.join(projectRoot,"frontend","data");
  const equiposDir = path.join(projectRoot,"frontend","equipos");

  const divisiones = ["primera","segunda","tercera"];
  const equipos=[];

  for(const d of divisiones){

    const file = path.join(usuariosDir,`usuarios.${d}.json`);
    if(!fs.existsSync(file)) continue;

    const data = readJson(file);

    for(const u of data.users || []){

      if(u.role==="admin") continue;

      const slugBase = canonicalSlug(u.slug || u.username);
      const slugUid = `${slugBase}__${d}`;

      equipos.push({
        slug_uid:slugUid,
        slug_base:slugBase,
        division:d,
        display_name:u.username || slugBase,
        captain:u.captain || null,
        phone:u.phone || null,
        email:u.email || null
      });
    }
  }

  console.log("Equipos detectados:",equipos.length);

  if(!dryRun){
    for(const e of equipos){

      await client.query(`
        INSERT INTO equipos
        (slug_uid,slug_base,division,display_name,captain,phone,email)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (slug_uid) DO NOTHING
      `,[
        e.slug_uid,
        e.slug_base,
        e.division,
        e.display_name,
        e.captain,
        e.phone,
        e.email
      ]);

    }
  }

  const playersFiles = fs.readdirSync(equiposDir).filter(f=>f.endsWith(".players.json"));

  console.log("Archivos de jugadores:",playersFiles.length);

  for(const f of playersFiles){

    const file = path.join(equiposDir,f);
    const data = readJson(file);
    const slugBase = canonicalSlug(f.replace(".players.json",""));

    if(!dryRun){

      const r = await client.query(
        "SELECT id FROM equipos WHERE slug_base=$1 LIMIT 1",
        [slugBase]
      );

      if(!r.rows.length) continue;

      const equipoId = r.rows[0].id;

      for(let i=0;i<(data.players||[]).length;i++){

        const name = data.players[i];

        await client.query(`
          INSERT INTO jugadores (equipo_id,nombre,orden)
          VALUES ($1,$2,$3)
          ON CONFLICT DO NOTHING
        `,[equipoId,name,i+1]);

      }

    }

  }

  console.log("Migración terminada");

  if(!dryRun) await client.end();

}

main();