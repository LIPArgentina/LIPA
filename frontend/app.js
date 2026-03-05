// === Config ===
const DATA_PATH = "./data";
const sessionKey = "lpi.session";

const $ = (sel, root = document) => root.querySelector(sel);

// Header / modales
const btnAdminEquipos = $("#btnAdminEquipos");
const btnBanner = $("#btnBanner");
const loginModal = $("#loginModal");
const loginTitle = $("#loginTitle");
const userSelect = $("#userSelect");
const passwordInput = $("#passwordInput");
const togglePass = $("#togglePass");
const loginError = $("#loginError");

const adminModal = $("#adminModal");
const adminPass = $("#adminPass");
const toggleAdminPass = $("#toggleAdminPass");
const adminError = $("#adminError");

const passModal = $("#passModal");
const oldPass = $("#oldPass");
const newPass = $("#newPass");
const newPass2 = $("#newPass2");
const passError = $("#passError");
const passSuccess = $("#passSuccess");

// --- Boot ---
document.addEventListener("DOMContentLoaded", () => {
  const sess = JSON.parse(localStorage.getItem(sessionKey) || "null");
  renderSession(sess);
});

function wireLoginDropdown() {
  const btnIngresar = $("#btnIngresar");
  const ingresarMenu = $("#ingresarMenu");

  btnIngresar?.addEventListener("click", (e) => {
    e.stopPropagation();
    ingresarMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", () => ingresarMenu.classList.add("hidden"));

  ingresarMenu?.addEventListener("click", async (e) => {
    if (!(e.target instanceof HTMLButtonElement)) return;
    const action = e.target.dataset.action;

    if (action === "admin") {
      adminPass.value = "";
      adminError.classList.add("hidden");
      adminModal.showModal();
      return;
    }
    await openCategoryLogin(action);
  });
}

// --- Admin ---
toggleAdminPass?.addEventListener("change", () => {
  adminPass.type = toggleAdminPass.checked ? "text" : "password";
});

document.querySelector("#submitAdmin")?.addEventListener("click", async (ev) => {
  ev.preventDefault();
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminPass.value }),
    });
    if (!res.ok) {
      adminError.classList.remove("hidden");
      return;
    }
    adminError.classList.add("hidden");
    adminModal.close();

    establishSession({
      role: "admin",
      displayName: "Admin",
      slug: null,
      category: "admin",
    });

// avisamos al resto de la app que el login terminó bien
window.dispatchEvent(new Event("login:success"));

  } catch {
    adminError.classList.remove("hidden");
  }
});

// --- Login por categoría / equipos ---
togglePass?.addEventListener("change", () => {
  passwordInput.type = togglePass.checked ? "text" : "password";
});

async function openCategoryLogin(categoria) {
  loginTitle.textContent = `Ingreso: ${capitalize(categoria)}`;
  loginError.classList.add("hidden");
  passwordInput.value = "";
  togglePass.checked = false;
  passwordInput.type = "password";

  const users = await loadUsers(categoria);
  users.sort((a, b) => (a.username || a.name).localeCompare((b.username || b.name), "es"));

  userSelect.innerHTML = "";
  for (const u of users) {
    const opt = document.createElement("option");
    opt.value = u.slug;
    opt.textContent = u.username;
    userSelect.appendChild(opt);
  }

  loginModal.showModal();

  document.querySelector("#submitLogin").onclick = async (ev) => {
    ev.preventDefault();
    const selectedSlug = userSelect.value;
    const selectedUser = users.find((u) => u.slug === selectedSlug);
    if (!selectedUser) {
      loginError.classList.remove("hidden");
      return;
    }

    try {
      const res = await fetch("/api/team/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: selectedSlug, password: passwordInput.value }),
      });
      if (!res.ok) {
        loginError.classList.remove("hidden");
        return;
      }
      loginError.classList.add("hidden");
      loginModal.close();

      establishSession({
        role: selectedUser.role ?? "user",
        displayName: selectedUser.username,
        slug: selectedUser.slug,
        category: categoria,
      });

window.dispatchEvent(new Event("login:success"));

    } catch (err) {
      loginError.classList.remove("hidden");
    }
  };
}

// === Loader compatible con window.LPI_USERS ===
async function loadUsers(categoria) {
  const base = `${DATA_PATH}/usuarios.${categoria}.js`;

  // Limpio el global previo para no mezclar categorías
  delete window.LPI_USERS;

  // 1) Import ESM: ejecuta el script y debería setear window.LPI_USERS
  try {
    await import(`${base}?v=${Date.now()}`);
    if (Array.isArray(window.LPI_USERS)) {
      return normalizeUsers(window.LPI_USERS);
    }
  } catch (e) {
    console.debug("ESM import falló:", e?.message || e);
  }

  // 2) Fallback: fetch + eval (también setea window.LPI_USERS)
  try {
    const resp = await fetch(base, { cache: "no-store" });
    if (!resp.ok) throw new Error("fetch usuarios.*.js status " + resp.status);
    const code = await resp.text();
    const evalFn = new Function(code + "\nreturn window.LPI_USERS;");
    const arr = evalFn();
    if (Array.isArray(arr)) return normalizeUsers(arr);
  } catch (e) {
    console.error("Fallback fetch+eval falló:", e);
  }

  // 3) JSON paralelo como último recurso
  try {
    const j = await (await fetch(`${DATA_PATH}/usuarios.${categoria}.json`, { cache: "no-store" })).json();
    if (Array.isArray(j)) return normalizeUsers(j);
  } catch {}

  return [];
}

function normalizeUsers(list) {
  // Filtra "admin" y normaliza a { username, slug, role }
  return list
    .map((u) => {
      const username = u.username || u.name || u.team || "";
      const slug = (u.slug && u.slug.trim()) ? u.slug.trim() : slugify(username);
      const role = (u.role || "team").toLowerCase();
      return username ? { username, slug, role } : null;
    })
    .filter(Boolean)
    .filter(u => u.role !== "admin" && u.username.toLowerCase() !== "admin" && u.slug.toLowerCase() !== "admin");
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// === Sesión / Header ===
function establishSession({ role, displayName, slug, category }) {
  const sess = { role, displayName, slug, category, ts: Date.now() };
  localStorage.setItem(sessionKey, JSON.stringify(sess));
  renderSession(sess);
}

function renderSession(sess) {
  const box = document.querySelector("#sessionBox");
  const brandCta = document.querySelector(".brand__cta");
  const defaultCta = "INGRESÁ PARA GESTIONAR TUS JUGADORES Y PRÓXIMOS ENCUENTROS";

  if (!sess) {
    box.innerHTML = `
      <button id="btnIngresar" class="btn btn-primary">Ingresar</button>
      <div id="ingresarMenu" class="dropdown hidden">
        <button class="dropdown__item" data-action="admin">Admin</button>
        <button class="dropdown__item" data-action="primera">Primera</button>
        <button class="dropdown__item" data-action="segunda">Segunda</button>
        <button class="dropdown__item" data-action="tercera">Tercera</button>
      </div>
    `;
    wireLoginDropdown();

    // Sin sesión: oculto botón admin, oculto botón banner y muestro texto original
    if (btnAdminEquipos) btnAdminEquipos.classList.add("hidden");
    if (btnBanner) btnBanner.classList.add("hidden");
    if (brandCta) brandCta.textContent = defaultCta;
    return;
  }

  // Con sesión: en el box sólo dejo el botón de logout
  box.innerHTML = `
    <button id="btnLogout" class="btn btn-ghost btn-sm">Cerrar sesión</button>
  `;

  const role = (sess.role || "").toLowerCase();

  if (role === "admin") {
    // Admin: saludo personalizado en el header y botones de administrar/banner
    if (btnAdminEquipos) btnAdminEquipos.classList.remove("hidden");
    if (btnBanner) btnBanner.classList.remove("hidden");
    if (brandCta) brandCta.textContent = "Hola, Admin!";
  } else {
    // Equipo: oculto botón admin y banner y llevo el saludo con nombre al header
    if (btnAdminEquipos) btnAdminEquipos.classList.add("hidden");
    if (btnBanner) btnBanner.classList.add("hidden");
    if (brandCta) brandCta.textContent = `Hola, ${sess.displayName}!`;
  }

  wireSessionActions();
}


function wireSessionActions() {
  document.querySelector("#btnLogout")?.addEventListener("click", () => {
    localStorage.removeItem(sessionKey);
    renderSession(null);

    // avisamos al resto de la app que se cerró la sesión
    window.dispatchEvent(new Event("logout:success"));
  });

  btnAdminEquipos?.addEventListener("click", () => {
    window.location.href = "./admin.html";
  });
}

// --- Utils ---
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
