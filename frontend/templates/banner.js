import { apiFetch } from "../api.js";

// templates/banner.js
// Banner público: lee /api/get-banner y actualiza el mensaje de la portada

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

  // Texto principal
  if (data && data.text) {
    msgEl.textContent = data.text;
  } else {
    // Si no hay texto en el JSON, dejamos el texto por defecto del HTML
    return;
  }

  // Si más adelante querés usar link/botón público, podés extender esto:
  // data.link?.href y data.link?.label ya vienen preparados
  // Ejemplo (si creás un <a id="bannerLink">...):
  //
  // const linkEl = document.getElementById('bannerLink');
  // if (linkEl && data.link?.href && data.link?.label) {
  //   linkEl.href = data.link.href;
  //   linkEl.textContent = data.link.label;
  //   linkEl.classList.remove('hidden');
  // } else if (linkEl) {
  //   linkEl.classList.add('hidden');
  // }
}

async function loadAndRenderBanner() {
  try {
    const data = await fetchBannerConfig();
    applyBannerToDOM(data);
  } catch (err) {
    console.error("No se pudo cargar el banner público", err);
    // Acá simplemente dejamos el texto por defecto del HTML
  }
}

function setupPublicBanner() {
  // Cargar al inicio
  loadAndRenderBanner();

  // Escuchar el "bust" que se setea cuando guardás desde el popup de admin
  // (index.js hace: localStorage.setItem('lpi_banner_bust', String(Date.now()));
  window.addEventListener("storage", (event) => {
    if (event.key === "lpi_banner_bust") {
      loadAndRenderBanner();
    }
  });
}

document.addEventListener("DOMContentLoaded", setupPublicBanner);