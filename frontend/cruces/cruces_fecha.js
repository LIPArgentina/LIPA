
// cruces_fecha.js FINAL

(async function () {

const CATEGORY_KEYS = {
  tercera: "__categoria_tercera__",
  segunda: "__categoria_segunda__"
};

function getCategory() {
  const url = new URL(window.location.href);
  return url.searchParams.get("cat") || "tercera";
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session") || "{}");
  } catch {
    return {};
  }
}

function normalize(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

// ✅ HABILITACIÓN CORRECTA
async function checkEnabled(category) {
  const key = CATEGORY_KEYS[category] || category;
  const res = await fetch(`/api/cruces/status?team=${key}`);
  if (!res.ok) throw new Error("No habilitado");
}

// ✅ CRUCES DESDE DB
async function loadCruces(category) {
  const key = CATEGORY_KEYS[category] || category;
  const res = await fetch("/api/cruces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ team: key })
  });
  return res.json();
}

// 🔎 BUSCAR PARTIDO DEL EQUIPO
function findMatch(cruces, team) {
  const t = normalize(team);
  return (cruces || []).find(p =>
    normalize(p.local) === t || normalize(p.visitante) === t
  );
}

// 📄 PLANILLA (endpoint flexible)
async function fetchPlanilla(team) {
  const slug = team.toLowerCase().replace(/\s+/g, '');

  let res = await fetch(`/api/team/planilla?team=${slug}`);
  if (!res.ok) {
    res = await fetch(`/api/planilla?team=${slug}`);
  }
  if (!res.ok) return null;

  return res.json();
}

// 🎨 RENDER SIMPLE (no rompe UI)
function render(planilla, id) {
  const el = document.getElementById(id);
  if (!planilla) {
    el.innerHTML = "<p>No presentada</p>";
    return;
  }
  el.innerHTML = `<h3>${planilla.equipo || "Equipo"}</h3>`;
}

// 🚀 BOOT
try {
  const category = getCategory();
  await checkEnabled(category);

  const session = getSession();
  const team = session.team || session.equipo;

  const data = await loadCruces(category);
  const match = findMatch(data.cruces, team);

  if (!match) throw new Error("No match");

  const localPlanilla = await fetchPlanilla(match.local);
  const visitantePlanilla = await fetchPlanilla(match.visitante);

  render(localPlanilla, "local");
  render(visitantePlanilla, "visitante");

} catch (e) {
  document.body.innerHTML = "<h2>No se pudo verificar el acceso</h2>";
}

})();
