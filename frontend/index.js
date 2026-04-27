function readSession() {
  try {
    const raw = localStorage.getItem("lpi.session") || sessionStorage.getItem("lpi.session");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isAdmin() {
  const sess = readSession();
  return (sess?.role || "").toLowerCase() === "admin";
}

function getSlug() {
  const sess = readSession();
  if (sess?.slug) return String(sess.slug);

  const p = new URLSearchParams(location.search);
  return p.get("team") || sessionStorage.getItem("teamSlug") || localStorage.getItem("teamSlug");
}

function findActions() {
  return (
    document.querySelector(".actions") ||
    document.querySelector(".session__actions") ||
    document.getElementById("sessionActions")
  );
}

function ensureManageTeamButton() {
  const actions = findActions();
  if (!actions) return;

  const btn = document.getElementById("btnAdminEquipos");
  if (!btn) return;

  btn.classList.add("btn", "btn-outline", "btn-sm");
  btn.style.textDecoration = "none";

  const sess = readSession();
  const admin = (sess?.role || "").toLowerCase() === "admin";

  if (admin) {
    btn.textContent = "Administrar equipos";
    btn.href = "./admin.html";
    btn.classList.remove("hidden");
    return;
  }

  if (sess?.slug) {
    const slug = String(sess.slug);
    btn.textContent = "Administrar equipo";
    btn.href = `/templates/plantilla.html?team=${encodeURIComponent(slug)}`;
    btn.classList.remove("hidden");
    return;
  }

  btn.classList.add("hidden");
  btn.removeAttribute("href");
}

function ensureConsultasButton() {
  const btn = document.getElementById("btnConsultas");
  if (!btn) return;

  btn.classList.add("btn", "btn-outline", "btn-sm");
  btn.style.textDecoration = "none";

  if (isAdmin()) {
    btn.href = "./consultas/consultas.html";
    btn.classList.remove("hidden");
    return;
  }

  btn.classList.add("hidden");
  btn.removeAttribute("href");
}

function redirectAfterLogin() {
  const sess = readSession();
  const role = (sess?.role || "").toLowerCase();
  const slug = sess?.slug || getSlug();

  if (role === "admin") {
    location.href = "./admin.html";
    return;
  }

  if (slug) {
    location.href = `/templates/plantilla.html?team=${encodeURIComponent(slug)}`;
    return;
  }

  location.reload();
}

function setupAuthBridge() {
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data || {};
    if (data.type === "lpi:auth-success") {
      ensureManageTeamButton();
      ensureConsultasButton();
      redirectAfterLogin();
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === "lpi.session" && event.newValue) {
      ensureManageTeamButton();
      ensureConsultasButton();
    }
  });

  window.addEventListener("login:success", () => {
    ensureManageTeamButton();
    ensureConsultasButton();
    redirectAfterLogin();
  });

  window.addEventListener("logout:success", () => {
    ensureManageTeamButton();
    ensureConsultasButton();
  });
}

const MAX_BANNERS = 5;


function getApiBase() {
  const fromConfig =
    (typeof window !== "undefined" &&
      window.APP_CONFIG &&
      window.APP_CONFIG.API_BASE_URL) ||
    "";

  return String(fromConfig || "").replace(/\/$/, "");
}

function apiUrl(path) {
  const cleanPath = String(path || "");
  const base = getApiBase();
  if (!base) return cleanPath;
  return `${base}${cleanPath}`;
}

async function loadBannerForHome() {
  try {
    const res = await fetch(apiUrl("/api/get-banner"), { cache: "no-store" });
    if (!res.ok) throw new Error("GET /api/get-banner failed");
    const data = await res.json();
    renderBanner(data);
  } catch (err) {
    console.error("Banner load error:", err);
  }
}


const bannerState = {
  banners: [],
  currentIndex: 0,
  intervalId: null,
};

function normalizeBannersConfig(config) {
  if (!config) return [];
  if (Array.isArray(config)) return config;
  if (Array.isArray(config.banners)) return config.banners;

  if (typeof config === "object") {
    const maybeText = config.text || "";
    const maybeLink = config.link || null;
    if (maybeText || maybeLink) {
      return [{ text: maybeText, link: maybeLink }];
    }
  }

  return [];
}

function buildBannerHTML(item) {
  const text = item?.text || "";
  const link = item?.link;

  let html = text || "";

  if (link && typeof link === "object" && link.href && link.label) {
    html += `
      <a 
        href="${link.href}" 
        target="_blank" 
        rel="noopener noreferrer"
        class="banner-link"
      >
        ${link.label}
      </a>
    `;
  }

  return html;
}

function goToBanner(index, restartTimer = false) {
  const banners = bannerState.banners || [];
  const bannerEl = document.getElementById("bannerMessage");
  const dotsContainer = document.getElementById("bannerDots");

  if (!bannerEl || !banners.length) return;

  const max = banners.length;
  const safeIndex = ((index % max) + max) % max;
  bannerState.currentIndex = safeIndex;

  bannerEl.innerHTML = buildBannerHTML(banners[safeIndex]);

  bannerEl.classList.remove("banner-slide");
  void bannerEl.offsetWidth;
  bannerEl.classList.add("banner-slide");

  if (dotsContainer) {
    const dots = dotsContainer.querySelectorAll(".banner-dot");
    dots.forEach((dot, idx) => {
      dot.classList.toggle("is-active", idx === safeIndex);
    });
  }

  if (restartTimer) {
    if (bannerState.intervalId) {
      clearInterval(bannerState.intervalId);
      bannerState.intervalId = null;
    }

    if (banners.length > 1) {
      bannerState.intervalId = setInterval(() => {
        goToBanner(bannerState.currentIndex + 1, false);
      }, 6000);
    }
  }
}

function renderBanner(config) {
  const bannerEl = document.getElementById("bannerMessage");
  const dotsContainer = document.getElementById("bannerDots");
  if (!bannerEl) return;

  const banners = normalizeBannersConfig(config);
  bannerState.banners = banners;
  bannerState.currentIndex = 0;

  if (bannerState.intervalId) {
    clearInterval(bannerState.intervalId);
    bannerState.intervalId = null;
  }

  if (!banners.length) {
    bannerEl.textContent = "";
    if (dotsContainer) {
      dotsContainer.innerHTML = "";
      dotsContainer.classList.add("hidden");
    }
    return;
  }

  if (dotsContainer) {
    dotsContainer.innerHTML = "";

    if (banners.length > 1) {
      dotsContainer.classList.remove("hidden");
      banners.forEach((_, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "banner-dot";
        btn.dataset.index = String(idx);
        btn.setAttribute("aria-label", `Banner ${idx + 1}`);
        dotsContainer.appendChild(btn);
      });
    } else {
      dotsContainer.classList.add("hidden");
    }
  }

  goToBanner(0, true);
}

document.addEventListener("DOMContentLoaded", () => {
  const dotsContainer = document.getElementById("bannerDots");
  if (dotsContainer) {
    dotsContainer.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".banner-dot");
      if (!btn) return;
      const idx = Number(btn.dataset.index);
      if (Number.isNaN(idx)) return;
      goToBanner(idx, true);
    });
  }
});

function setupBannerAdmin() {
  const btnBanner = document.getElementById("btnBanner");
  const dlg = document.getElementById("bannerModal");
  const bannerForm = document.getElementById("bannerForm");
  const submitBtn = document.getElementById("submitBanner");
  const $text = document.getElementById("bannerText");
  const $href = document.getElementById("bannerHref");
  const $label = document.getElementById("bannerLabel");
  const $ok = document.getElementById("bannerMsg");
  const $err = document.getElementById("bannerErr");
  const tabs = document.getElementById("bannerTabs");

  const SLOTS = MAX_BANNERS || 5;
  let slots = Array.from({ length: SLOTS }, () => ({
    text: "",
    href: "",
    label: "",
  }));
  let activeSlot = 0;

  function updateVisibility() {
    if (!btnBanner) return;
    if (isAdmin()) btnBanner.classList.remove("hidden");
    else btnBanner.classList.add("hidden");
  }

  function syncFormFromSlot() {
    const current = slots[activeSlot] || { text: "", href: "", label: "" };
    if ($text) $text.value = current.text || "";
    if ($href) $href.value = current.href || "";
    if ($label) $label.value = current.label || "";
    if ($ok) $ok.classList.add("hidden");
    if ($err) $err.classList.add("hidden");
  }

  function syncSlotFromForm() {
    const curr = slots[activeSlot] || {};
    slots[activeSlot] = {
      text: $text?.value ?? curr.text ?? "",
      href: $href?.value ?? curr.href ?? "",
      label: $label?.value ?? curr.label ?? "",
    };
  }

  function refreshTabsUI() {
    if (!tabs) return;
    const buttons = tabs.querySelectorAll("[data-index]");
    buttons.forEach((btn) => {
      const idx = Number(btn.dataset.index);
      btn.classList.toggle("is-active", idx === activeSlot);
    });
  }

  async function loadBanner() {
    try {
      const res = await fetch(apiUrl("/api/get-banner"), { cache: "no-store" });
      if (!res.ok) throw new Error("GET /api/get-banner failed");
      const data = await res.json();
      const banners = normalizeBannersConfig(data);

      slots = Array.from({ length: SLOTS }, (_, i) => {
        const b = banners[i] || {};
        return {
          text: b.text || "",
          href: b.link?.href || "",
          label: b.link?.label || "",
        };
      });

      activeSlot = 0;
      syncFormFromSlot();
      refreshTabsUI();

      if ($ok) $ok.classList.add("hidden");
      if ($err) $err.classList.add("hidden");
    } catch (e) {
      console.error(e);
      if ($err) {
        $err.textContent = "No se pudo cargar el banner";
        $err.classList.remove("hidden");
      }
      if ($ok) $ok.classList.add("hidden");
    }
  }

  async function saveBanner(evt) {
    if (evt) evt.preventDefault();
    syncSlotFromForm();

    const bannersPayload = slots
      .map((slot) => {
        const text = (slot.text || "").trim();
        const href = (slot.href || "").trim();
        const label = (slot.label || "").trim();
        const link = href && label ? { href, label } : null;
        return { text, link };
      })
      .filter((b) => b.text || b.link);

    const payload = { banners: bannersPayload };

    if (bannersPayload.length === 1) {
      payload.text = bannersPayload[0].text;
      payload.link = bannersPayload[0].link;
    }

    try {
      const res = await fetch(apiUrl("/api/save-banner"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("POST /api/save-banner failed");

      localStorage.setItem("lpi_banner_bust", String(Date.now()));
      renderBanner(payload);

      if ($ok) {
        $ok.textContent = "¡Guardado!";
        $ok.classList.remove("hidden");
      }
      if ($err) $err.classList.add("hidden");

      setTimeout(() => dlg?.close(), 200);
    } catch (e) {
      console.error(e);
      if ($err) {
        $err.textContent = "No se pudo guardar";
        $err.classList.remove("hidden");
      }
      if ($ok) $ok.classList.add("hidden");
    }
  }

  if (tabs) {
    tabs.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-index]");
      if (!btn) return;
      const idx = Number(btn.dataset.index);
      if (Number.isNaN(idx) || idx === activeSlot) return;
      syncSlotFromForm();
      activeSlot = idx;
      syncFormFromSlot();
      refreshTabsUI();
    });
    refreshTabsUI();
  }

  if (btnBanner && dlg) {
    btnBanner.addEventListener("click", (e) => {
      e.preventDefault();
      loadBanner().finally(() => dlg.showModal && dlg.showModal());
    });
  }

  if (bannerForm && submitBtn) {
    submitBtn.addEventListener("click", saveBanner);
    document.getElementById("cancelBanner")?.addEventListener("click", () => dlg?.close());
  }

  updateVisibility();
  window.addEventListener("storage", updateVisibility);
  window.addEventListener("login:success", updateVisibility);
  window.addEventListener("logout:success", updateVisibility);
}

document.addEventListener("DOMContentLoaded", () => {
  ensureManageTeamButton();
  ensureConsultasButton();
  setupAuthBridge();
  setupBannerAdmin();
  loadBannerForHome();
});
