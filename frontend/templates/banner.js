import { apiFetch } from "../api.js";




async function fetchBannerConfig() {
  const res = await apiFetch("/api/get-banner", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("GET /api/get-banner failed");
  }
  return res.json();
}

function applyBannerToDOM(data) {
  const msgEl = document.getElementById("bannerMessage");
  if (!msgEl) return;


  if (data && data.text) {
    msgEl.textContent = data.text;
  } else {

    return;
  }













}

async function loadAndRenderBanner() {
  try {
    const data = await fetchBannerConfig();
    applyBannerToDOM(data);
  } catch (err) {
    console.error("No se pudo cargar el banner público", err);

  }
}

function setupPublicBanner() {

  loadAndRenderBanner();



  window.addEventListener("storage", (event) => {
    if (event.key === "lpi_banner_bust") {
      loadAndRenderBanner();
    }
  });
}

document.addEventListener("DOMContentLoaded", setupPublicBanner);