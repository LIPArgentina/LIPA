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

function authHeaders(extra = {}) {
  const sess = readSession();
  return sess?.token ? { ...extra, Authorization: `Bearer ${sess.token}` } : extra;
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
  const role = (sess?.role || "").toLowerCase();

  btn.classList.remove("btn-admin-salas");
  btn.classList.remove("btn-admin-team");

  if (role === "admin") {
    btn.textContent = "Administrar equipos";
    btn.href = "./admin.html";
    btn.classList.add("btn-admin-team");
    btn.classList.remove("hidden");
    return;
  }

  if (role === "sala" && sess?.slug) {
    const slug = String(sess.slug);
    const params = new URLSearchParams();
    params.set("sala", slug);
    if (sess.token) params.set("token", String(sess.token));

    btn.textContent = "Administrar sala";
    btn.href = `./salas/admin_salas.html?${params.toString()}`;
    btn.classList.add("btn-admin-salas");
    btn.classList.remove("hidden");
    return;
  }

  if (sess?.slug) {
    const slug = String(sess.slug);
    btn.textContent = "Administrar equipo";
    btn.href = `./templates/plantilla.html?team=${encodeURIComponent(slug)}`;
    btn.classList.add("btn-admin-team");
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

function ensureJugadoresViewButton() {
  const btn = document.getElementById("btnJugadoresView");
  if (!btn) return;

  btn.classList.add("btn", "btn-outline", "btn-sm");
  btn.style.textDecoration = "none";

  if (isAdmin()) {
    btn.href = "./jugadores/jugadores_view.html";
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

  if (role === "sala" && slug) {
    const params = new URLSearchParams();
    params.set("sala", slug);
    if (sess?.token) params.set("token", String(sess.token));
    location.href = `./salas/admin_salas.html?${params.toString()}`;
    return;
  }

  if (slug) {
    location.href = `./templates/plantilla.html?team=${encodeURIComponent(slug)}`;
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
      ensureJugadoresViewButton();
      redirectAfterLogin();
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === "lpi.session" && event.newValue) {
      ensureManageTeamButton();
      ensureConsultasButton();
      ensureJugadoresViewButton();
    }
  });

  window.addEventListener("login:success", () => {
    ensureManageTeamButton();
    ensureConsultasButton();
    ensureJugadoresViewButton();
    redirectAfterLogin();
  });

  window.addEventListener("logout:success", () => {
    ensureManageTeamButton();
    ensureConsultasButton();
    ensureJugadoresViewButton();
  });
}

const MAX_BANNERS = 5;
const BANNER_ROTATE_MS = 10000;


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

function isFlyerAldoHref(href) {
  try {
    const url = new URL(href, location.origin);
    return url.searchParams.get("popup") === "aldo";
  } catch {
    return false;
  }
}

function buildBannerHTML(item) {
  const text = item?.text || "";
  const link = item?.link;

  let html = text || "";

  if (link && typeof link === "object" && link.href && link.label) {
    const linkAttrs = isFlyerAldoHref(link.href)
      ? 'data-popup="aldo"'
      : 'target="_blank" rel="noopener noreferrer"';

    html += `
      <a 
        href="${link.href}" 
        class="banner-link"
        ${linkAttrs}
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
      }, BANNER_ROTATE_MS);
    }
  }
}

async function loadBirthdayTicker() {
  const ticker = document.getElementById("birthdayTicker");
  const track = document.getElementById("birthdayTickerTrack");
  if (!ticker || !track) return;

  try {
    const res = await fetch(apiUrl("/api/players-public/birthdays/today"), { cache: "no-store" });
    if (!res.ok) throw new Error("GET /api/players-public/birthdays/today failed");
    const data = await res.json();
    const names = (data.players || [])
      .map((player) => String(player.nombre || "").trim())
      .filter(Boolean);

    if (!names.length) {
      ticker.classList.add("hidden");
      track.textContent = "";
      return;
    }

    const message = `La Liga Independiente de Pool Argentina le desea un Feliz Cumpleaños a ${names.join(", ")}`;
    track.textContent = `${message}   •   ${message}`;
    ticker.classList.remove("hidden");
  } catch (err) {
    console.error("Birthday ticker load error:", err);
    ticker.classList.add("hidden");
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
        credentials: "include",
        headers: authHeaders({ "Content-Type": "application/json" }),
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

const VISITOR_ID_KEY = "lipa.visitorId";
const VISITOR_PING_MS = 60000;
let visitorPingId = null;

function getVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    return `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

async function trackVisitorActivity() {
  try {
    await fetch(apiUrl("/api/track-visit"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitorId: getVisitorId(),
        path: location.pathname + location.search,
        referrer: document.referrer || "",
      }),
      keepalive: true,
    });
  } catch (err) {
    console.error("Stats track error:", err);
  }
}

async function loadPublicStats() {
  try {
    const res = await fetch(apiUrl("/api/public-stats"), { cache: "no-store" });
    if (!res.ok) throw new Error("GET /api/public-stats failed");

    const data = await res.json();
    const el = document.getElementById("statsBar");
    if (!el) return;

    el.textContent = `Online: ${data.online ?? 0} | Hoy: ${data.today ?? 0} | Semana: ${data.week ?? 0}`;
  } catch (err) {
    console.error("Stats load error:", err);
  }
}

function startPublicStats() {
  trackVisitorActivity();
  loadPublicStats();

  if (visitorPingId) clearInterval(visitorPingId);
  visitorPingId = setInterval(() => {
    trackVisitorActivity();
    loadPublicStats();
  }, VISITOR_PING_MS);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      trackVisitorActivity();
      loadPublicStats();
    }
  });
}

function openFlyerAldoModal() {
  const dlg = document.getElementById("flyerAldoModal");
  if (!dlg) return;

  const socialDlg = document.getElementById("socialFollowModal");
  if (socialDlg?.open) socialDlg.close();

  requestAnimationFrame(() => {
    if (typeof dlg.showModal === "function" && !dlg.open) {
      dlg.showModal();
    }
  });
}

function setupDialogOpener(dialogId, openButtonId) {
  const dlg = document.getElementById(dialogId);
  if (!dlg) return;

  const openBtn = openButtonId ? document.getElementById(openButtonId) : null;
  const closeBtn = dlg.querySelector(".flyer-popup__close");
  const closeModal = () => dlg.close?.();
  const openModal = () => {
    const socialDlg = document.getElementById("socialFollowModal");
    if (socialDlg?.open) socialDlg.close();

    requestAnimationFrame(() => {
      if (typeof dlg.showModal === "function" && !dlg.open) {
        dlg.showModal();
      }
    });
  };

  openBtn?.addEventListener("click", openModal);
  closeBtn?.addEventListener("click", closeModal);

  dlg.addEventListener("click", (event) => {
    if (event.target === dlg) closeModal();
  });

  dlg.addEventListener("cancel", () => closeModal());

  return openModal;
}

function setupFlyerImageZoom() {
  const zoomableDialogs = document.querySelectorAll(".flyer-popup--zoomable");

  zoomableDialogs.forEach((dlg) => {
    const image = dlg.querySelector(".flyer-popup__image");
    if (!image) return;

    image.addEventListener("click", () => {
      dlg.classList.toggle("is-zoomed");
    });

    dlg.addEventListener("close", () => {
      dlg.classList.remove("is-zoomed");
    });
  });
}

function setupSocialFollowModal() {
  const dlg = document.getElementById("socialFollowModal");
  if (!dlg) return;
  if (new URLSearchParams(location.search).has("popup")) return;

  const closeBtn = dlg.querySelector(".social-follow-modal__close");
  const closeModal = () => dlg.close?.();

  closeBtn?.addEventListener("click", closeModal);

  dlg.addEventListener("click", (event) => {
    if (event.target === dlg) closeModal();
  });

  dlg.addEventListener("cancel", () => closeModal());

  requestAnimationFrame(() => {
    if (typeof dlg.showModal === "function" && !dlg.open) {
      dlg.showModal();
    }
  });
}

function setupFlyerAldoModal() {
  const params = new URLSearchParams(location.search);
  setupDialogOpener("flyerAldoModal");

  if (params.get("popup") === "aldo") openFlyerAldoModal();
}

function setupInscripcionSuperligaModal() {
  const params = new URLSearchParams(location.search);
  const openModal = setupDialogOpener("inscripcionSuperligaModal", "btnInscripcionSuperliga");
  if (params.get("popup") === "inscripcion" && openModal) openModal();
}

function escapePdfText(value) {
  return String(value)
    .normalize("NFC")
    .replace(/[\\()]/g, "\\$&")
    .replace(/[^\x20-\xFF]/g, "");
}

function toLatin1Bytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    bytes[i] = value.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function buildSimplePdf(lines) {
  const objects = [];
  const content = [];

  const addText = (text, x, y, size, font = "F1") => {
    content.push(`BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET\n`);
  };

  addText("ASCENSOS LIPA", 72, 780, 22, "F2");
  addText("Liga Independiente de Pool Argentina", 72, 756, 11, "F1");

  let y = 718;
  lines.forEach((line) => {
    if (line.type === "section") {
      y -= 12;
      addText(line.text, 72, y, 14, "F2");
      y -= 22;
      return;
    }

    addText(line.text, 88, y, 10.5, "F1");
    y -= 16;
  });

  const stream = content.join("");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return toLatin1Bytes(pdf);
}

function downloadAscensosPdf() {
  const sections = [...document.querySelectorAll("#ascensosLipaModal [data-ascensos-section]")];
  const lines = [];

  sections.forEach((section) => {
    const title = section.querySelector(".ascensos-popup__subtitle")?.textContent?.trim();
    if (title) lines.push({ type: "section", text: title });

    section.querySelectorAll("li").forEach((item, index) => {
      const text = item.textContent.trim();
      lines.push({ type: "item", text: `${index + 1}. ${text}` });
    });
  });

  const blob = new Blob([buildSimplePdf(lines)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ascensos-lipa.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setupAscensosLipaModal() {
  const params = new URLSearchParams(location.search);
  const openModal = setupDialogOpener("ascensosLipaModal", "btnAscensosLipa");
  document.getElementById("btnDownloadAscensosPdf")?.addEventListener("click", downloadAscensosPdf);
  if (params.get("popup") === "ascensos" && openModal) openModal();
}

function setupBannerPopupLinks() {
  const bannerEl = document.getElementById("bannerMessage");
  if (!bannerEl) return;

  bannerEl.addEventListener("click", (event) => {
    const link = event.target.closest('a.banner-link[data-popup="aldo"]');
    if (!link) return;

    event.preventDefault();
    openFlyerAldoModal();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  ensureManageTeamButton();
  ensureConsultasButton();
  ensureJugadoresViewButton();
  setupAuthBridge();
  setupBannerAdmin();
  loadBirthdayTicker();
  loadBannerForHome();
  startPublicStats();
  setupFlyerAldoModal();
  setupInscripcionSuperligaModal();
  setupAscensosLipaModal();
  setupFlyerImageZoom();
  setupBannerPopupLinks();
  setupSocialFollowModal();
});
