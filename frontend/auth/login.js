import { apiFetch } from "../api.js";

const DATA_PATH = "../data";
const sessionKey = "lpi.session";

const categoryGrid = document.getElementById("categoryGrid");
const teamForm = document.getElementById("teamForm");
const adminForm = document.getElementById("adminForm");

const teamFormTitle = document.getElementById("teamFormTitle");
const userSelect = document.getElementById("userSelect");
const passwordInput = document.getElementById("passwordInput");
const togglePass = document.getElementById("togglePass");
const teamError = document.getElementById("teamError");

const adminPass = document.getElementById("adminPass");
const toggleAdminPass = document.getElementById("toggleAdminPass");
const adminError = document.getElementById("adminError");

const backFromTeam = document.getElementById("backFromTeam");
const backFromAdmin = document.getElementById("backFromAdmin");

let currentCategory = null;
let currentUsers = [];

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeUsers(list) {
  return list
    .map((u) => {
      const username = u.username || u.name || u.team || "";
      const slug = (u.slug && u.slug.trim()) ? u.slug.trim() : slugify(username);
      const role = (u.role || "team").toLowerCase();
      return username ? { username, slug, role } : null;
    })
    .filter(Boolean)
    .filter((u) => u.role !== "admin" && u.username.toLowerCase() !== "admin" && u.slug.toLowerCase() !== "admin");
}

const BACKEND_URL = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');

async function loadUsers(categoria) {
  try {
    const resp = await fetch(`${BACKEND_URL}/api/teams?division=${encodeURIComponent(categoria)}`, {
      cache: "no-store",
      credentials: "omit"
    });

    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data)) return normalizeUsers(data);
      if (Array.isArray(data?.teams)) return normalizeUsers(data.teams);
      if (Array.isArray(data?.users)) return normalizeUsers(data.users);
    }
  } catch (e) {
    console.debug("No se pudo leer equipos desde API:", e?.message || e);
  }

  try {
    const resp = await fetch(`${DATA_PATH}/usuarios.${categoria}.json`, { cache: "no-store" });
    if (resp.ok) {
      const data = await resp.json();

      if (Array.isArray(data)) return normalizeUsers(data);
      if (Array.isArray(data?.users)) return normalizeUsers(data.users);
    }
  } catch (e) {
    console.debug("No se pudo leer usuarios JSON:", e?.message || e);
  }

  const base = `${DATA_PATH}/usuarios.${categoria}.js`;
  delete window.LPI_USERS;

  try {
    await import(`${base}?v=${Date.now()}`);
    if (Array.isArray(window.LPI_USERS)) {
      return normalizeUsers(window.LPI_USERS);
    }
  } catch (e) {
    console.debug("ESM import falló:", e?.message || e);
  }

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

  return [];
}

function showCategoryGrid() {
  categoryGrid.classList.remove("hidden");
  teamForm.classList.add("hidden");
  adminForm.classList.add("hidden");
  teamError.classList.add("hidden");
  adminError.classList.add("hidden");
  passwordInput.value = "";
  adminPass.value = "";
}

async function openTeamCategory(category) {
  currentCategory = category;
  currentUsers = await loadUsers(category);
  currentUsers.sort((a, b) => (a.username || a.name).localeCompare((b.username || b.name), "es"));

  userSelect.innerHTML = "";

  for (const u of currentUsers) {
    const opt = document.createElement("option");
    opt.value = u.slug;
    opt.textContent = u.username;
    userSelect.appendChild(opt);
  }

  const lastCategory = localStorage.getItem("lpi.lastCategory");
  const lastTeamSlug = localStorage.getItem("lpi.lastTeamSlug");

  if (lastCategory === category && lastTeamSlug) {
    const exists = currentUsers.some((u) => u.slug === lastTeamSlug);
    if (exists) userSelect.value = lastTeamSlug;
  }

  teamFormTitle.textContent = `Ingreso: ${capitalize(category)}`;
  teamError.classList.add("hidden");
  passwordInput.value = "";
  togglePass.checked = false;
  passwordInput.type = "password";

  categoryGrid.classList.add("hidden");
  adminForm.classList.add("hidden");
  teamForm.classList.remove("hidden");
}

function openAdmin() {
  adminError.classList.add("hidden");
  adminPass.value = "";
  toggleAdminPass.checked = false;
  adminPass.type = "password";

  categoryGrid.classList.add("hidden");
  teamForm.classList.add("hidden");
  adminForm.classList.remove("hidden");
}

function establishSession({ role, displayName, slug, category, token }) {
  const sess = { role, displayName, slug, category, token, ts: Date.now() };
  localStorage.setItem(sessionKey, JSON.stringify(sess));

  if (slug) localStorage.setItem("lpi.lastTeamSlug", slug);
  if (category) localStorage.setItem("lpi.lastCategory", category);

  return sess;
}

function redirectAfterLogin(sess) {
  const role = (sess?.role || "").toLowerCase();
  const slug = sess?.slug;

  if (role === "admin") {
    window.location.href = "../admin.html";
    return;
  }

  if (slug) {
    window.location.href = `../templates/plantilla.html?team=${encodeURIComponent(slug)}`;
    return;
  }

  window.location.href = "../index.html";
}

function notifyParent(sess) {
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "lpi:auth-success", session: sess }, window.location.origin);
      return true;
    }
  } catch (e) {
    console.warn("No se pudo avisar a la ventana principal:", e);
  }
  return false;
}

function finishLogin(sess) {
  const hasParent = notifyParent(sess);

  if (hasParent) {
    setTimeout(() => {
      try {
        window.close();
      } catch {}
      setTimeout(() => redirectAfterLogin(sess), 300);
    }, 120);
    return;
  }

  redirectAfterLogin(sess);
}

async function submitTeamLogin(ev) {
  ev.preventDefault();

  const selectedSlug = userSelect.value;
  const selectedUser = currentUsers.find((u) => u.slug === selectedSlug);

  if (!selectedUser) {
    teamError.textContent = "Seleccioná un usuario válido";
    teamError.classList.remove("hidden");
    return;
  }

  try {
    const res = await apiFetch("/api/team/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: selectedSlug, password: passwordInput.value })
    });

    if (!res.ok) {
      teamError.textContent = "Usuario o contraseña incorrecta";
      teamError.classList.remove("hidden");
      return;
    }

    const data = await res.json().catch(() => ({}));

    teamError.classList.add("hidden");

    const sess = establishSession({
      role: selectedUser.role ?? "user",
      displayName: selectedUser.username,
      slug: selectedUser.slug,
      category: currentCategory,
      token: data.token || ""
    });

    finishLogin(sess);
  } catch {
    teamError.textContent = "No se pudo iniciar sesión";
    teamError.classList.remove("hidden");
  }
}

async function submitAdminLogin(ev) {
  ev.preventDefault();

  try {
    const res = await apiFetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminPass.value })
    });

    if (!res.ok) {
      adminError.textContent = "Contraseña incorrecta";
      adminError.classList.remove("hidden");
      return;
    }

    const data = await res.json().catch(() => ({}));

    adminError.classList.add("hidden");

    const sess = establishSession({
      role: "admin",
      displayName: "Admin",
      slug: null,
      category: "admin",
      token: data.token || ""
    });

    finishLogin(sess);
  } catch {
    adminError.textContent = "No se pudo iniciar sesión";
    adminError.classList.remove("hidden");
  }
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

categoryGrid.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-category]");
  if (!btn) return;

  const category = btn.dataset.category;
  if (category === "admin") {
    openAdmin();
    return;
  }

  await openTeamCategory(category);
});

teamForm.addEventListener("submit", submitTeamLogin);
adminForm.addEventListener("submit", submitAdminLogin);

togglePass.addEventListener("change", () => {
  passwordInput.type = togglePass.checked ? "text" : "password";
});

toggleAdminPass.addEventListener("change", () => {
  adminPass.type = toggleAdminPass.checked ? "text" : "password";
});

backFromTeam.addEventListener("click", showCategoryGrid);
backFromAdmin.addEventListener("click", showCategoryGrid);

document.addEventListener("DOMContentLoaded", () => {
  showCategoryGrid();
});