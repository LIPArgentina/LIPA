// === Config ===
const sessionKey = "lpi.session";

const $ = (sel, root = document) => root.querySelector(sel);

// Header / acciones
const btnAdminEquipos = $("#btnAdminEquipos");
const btnBanner = $("#btnBanner");

// --- Helpers ---
function readSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey) || "null");
  } catch {
    return null;
  }
}

function openLoginWindow() {
  const url = "./auth/login.html";
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  const width = 460;
  const height = 760;
  const left = Math.max(0, Math.round((window.screen.width - width) / 2));
  const top = Math.max(0, Math.round((window.screen.height - height) / 2));

  // En mobile conviene abrir normal
  if (isMobile) {
    window.location.href = url;
    return;
  }

  const popup = window.open(
    url,
    "lpi_login",
    `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );

  // Fallback si el navegador bloquea popup
  if (!popup || popup.closed || typeof popup.closed === "undefined") {
    window.location.href = url;
    return;
  }

  try {
    popup.focus();
  } catch {}
}

function bindLoginButton() {
  const btnIngresar = $("#btnIngresar");
  if (!btnIngresar) return;

  btnIngresar.addEventListener("click", (ev) => {
    ev.preventDefault();
    openLoginWindow();
  });
}

function wireIncomingAuthEvents() {
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data || {};
    if (data.type === "lpi:auth-success") {
      renderSession(readSession());
      window.dispatchEvent(new Event("login:success"));
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === sessionKey) {
      renderSession(readSession());
    }
  });
}

// --- Boot ---
document.addEventListener("DOMContentLoaded", () => {
  renderSession(readSession());
  wireIncomingAuthEvents();
});

// === Sesión / Header ===
function renderSession(sess) {
  const box = $("#sessionBox");
  const brandCta = $(".brand__cta");
  const defaultCta = "INGRESÁ PARA GESTIONAR TUS JUGADORES Y PRÓXIMOS ENCUENTROS";

  if (!box) return;

  if (!sess) {
    box.innerHTML = `
      <button id="btnIngresar" class="btn btn-primary">Ingresar</button>
    `;
    bindLoginButton();

    if (btnAdminEquipos) {
      btnAdminEquipos.classList.add("hidden");
      btnAdminEquipos.removeAttribute("href");
    }

    if (btnBanner) btnBanner.classList.add("hidden");
    if (brandCta) brandCta.textContent = defaultCta;
    return;
  }

  box.innerHTML = `
    <button id="btnLogout" class="btn btn-ghost btn-sm">Cerrar sesión</button>
  `;

  const role = (sess.role || "").toLowerCase();

  if (role === "admin") {
    if (btnAdminEquipos) {
      btnAdminEquipos.textContent = "Administrar equipos";
      btnAdminEquipos.href = "./admin.html";
      btnAdminEquipos.classList.remove("hidden");
    }

    if (btnBanner) btnBanner.classList.remove("hidden");
    if (brandCta) brandCta.textContent = "Hola, Admin!";
  } else {
    const slug =
      sess.slug ||
      localStorage.getItem("teamSlug") ||
      sessionStorage.getItem("teamSlug");

    if (btnAdminEquipos && slug) {
      btnAdminEquipos.textContent = "Administrar equipo";
      btnAdminEquipos.href = `./templates/plantilla.html?team=${encodeURIComponent(slug)}`;
      btnAdminEquipos.classList.remove("hidden");
    } else if (btnAdminEquipos) {
      btnAdminEquipos.classList.add("hidden");
      btnAdminEquipos.removeAttribute("href");
    }

    if (btnBanner) btnBanner.classList.add("hidden");
    if (brandCta) brandCta.textContent = `Hola, ${sess.displayName || "Equipo"}!`;
  }

  wireSessionActions();
}

function wireSessionActions() {
  $("#btnLogout")?.addEventListener("click", () => {
    localStorage.removeItem(sessionKey);
    renderSession(null);
    window.dispatchEvent(new Event("logout:success"));
  });

  btnAdminEquipos?.addEventListener("click", (ev) => {
    const href = btnAdminEquipos.getAttribute("href");
    if (!href) return;

    ev.preventDefault();
    window.location.href = href;
  });
}