/**
 * Reset de contraseñas (equipos) – LIGA / LIPA
 *
 * - Lee backend/data/team_passwords.json (o el archivo que le pases por argv)
 * - Genera:
 *    1) backend/data/team_passwords.json  (nuevo, con hashes bcrypt)
 *    2) backend/data/team_passwords.export.csv (slug,password en claro para que las repartas)
 *
 * Uso:
 *   node tools/reset_team_passwords.js
 *   node tools/reset_team_passwords.js backend/data/team_passwords.json
 *
 * Requisitos:
 *   npm i bcrypt
 */
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");

const inFile = process.argv[2] || path.join("backend", "data", "team_passwords.json");
const outFile = inFile; // sobreescribe el mismo archivo
const exportCsv = path.join(path.dirname(inFile), "team_passwords.export.csv");

function readJson(p){
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function randPassword(len=10){
  // Evito caracteres confusos
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#";
  let out = "";
  for(let i=0;i<len;i++){
    out += alphabet[Math.floor(Math.random()*alphabet.length)];
  }
  return out;
}

(async function main(){
  if(!fs.existsSync(inFile)){
    console.error("[reset] No existe:", inFile);
    process.exit(1);
  }

  const obj = readJson(inFile);
  const slugs = Object.keys(obj);

  if(!slugs.length){
    console.error("[reset] No hay slugs en", inFile);
    process.exit(1);
  }

  const saltRounds = 10;
  const newHashes = {};
  const rows = [["slug","password"]];

  for(const slug of slugs){
    const pwd = randPassword(10);
    const hash = await bcrypt.hash(pwd, saltRounds);
    newHashes[slug] = hash;
    rows.push([slug, pwd]);
  }

  fs.writeFileSync(outFile, JSON.stringify(newHashes, null, 2) + "\n", "utf8");

  // CSV
  const csvText = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n") + "\n";
  fs.writeFileSync(exportCsv, csvText, "utf8");

  console.log("[reset] OK");
  console.log(" - hashes:", outFile);
  console.log(" - export:", exportCsv);
  console.log("IMPORTANTE: guardá el CSV en un lugar seguro y compartilo 1 sola vez con cada equipo.");
})().catch((e)=>{
  console.error("[reset] ERROR:", e);
  process.exit(1);
});
