// llaves.js (estructura limpia)
// Q1-Q4 siempre automáticos desde tablas
// resto se combina con DB

async function loadLlaves(category){
  const auto = await calcularClasificados(category);
  const resp = await fetch(`/api/llaves?category=${category}`);
  const saved = await resp.json().catch(()=>null);
  return merge(auto, saved?.data);
}
