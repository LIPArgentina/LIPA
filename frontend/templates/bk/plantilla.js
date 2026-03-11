import { apiFetch, apiUrl } from "../api.js";

const MAX_PLAYERS = 20;

const tableBody = document.querySelector("#playersTable tbody");

async function loadPlayers() {
  try {
    const res = await apiFetch("/api/team/players", {
      method: "GET",
      cache: "no-store"
    });

    if (!res.ok) {
      console.error("Error cargando jugadores");
      return;
    }

    const data = await res.json();

    renderPlayers(data.players || []);
  } catch (err) {
    console.error("Error cargando jugadores", err);
  }
}

function renderPlayers(players) {

  tableBody.innerHTML = "";

  for (let i = 0; i < MAX_PLAYERS; i++) {

    const player = players[i] || {};

    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${i + 1}</td>
      <td>
        <input 
          type="text"
          value="${player.name || ""}"
          data-index="${i}"
          class="player-name"
        >
      </td>
    `;

    tableBody.appendChild(row);
  }
}

async function savePlayers() {

  const inputs = document.querySelectorAll(".player-name");

  const players = [];

  inputs.forEach((input, i) => {
    const name = input.value.trim();

    if (name) {
      players.push({
        number: i + 1,
        name
      });
    }
  });

  try {
    const res = await apiFetch("/api/team/save-players", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ players })
    });

    if (!res.ok) {
      alert("Error guardando jugadores");
      return;
    }

    alert("Jugadores guardados");
  } catch (err) {
    console.error(err);
    alert("Error guardando jugadores");
  }
}

document
  .querySelector("#savePlayers")
  ?.addEventListener("click", savePlayers);

document.addEventListener("DOMContentLoaded", loadPlayers);

/* ===============================
   Header: Volver + Cambiar contraseña
================================ */

(function () {
  function ensureHeaderButtons() {
    const header = document.getElementById("headerActions");
    if (!header) return;

    let volver = document.getElementById("btnBackTop");
    if (!volver) {
      volver = document.createElement("a");
      volver.href = "../index.html";
      volver.textContent = "Volver";
      volver.className = "btn-logout";
      volver.id = "btnBackTop";
      volver.style.textDecoration = "none";
      header.appendChild(volver);
    }

    let change = document.getElementById("btnChangePassTop");
    if (!change) {
      change = document.createElement("button");
      change.type = "button";
      change.id = "btnChangePassTop";
      change.textContent = "Cambiar contraseña";
      change.className = "btn-logout";
      header.appendChild(change);
    }

    change.onclick = () => {
      const dlg = document.getElementById("passModal");
      if (!dlg) return;

      const err = document.getElementById("passError");
      const ok = document.getElementById("passSuccess");
      const oldPass = document.getElementById("oldPass");
      const newPass = document.getElementById("newPass");
      const newPass2 = document.getElementById("newPass2");

      if (err) err.style.display = "none";
      if (ok) ok.style.display = "none";
      if (oldPass) oldPass.value = "";
      if (newPass) newPass.value = "";
      if (newPass2) newPass2.value = "";

      if (typeof dlg.showModal === "function") dlg.showModal();
    };
  }

  function wirePasswordModal() {
    const form = document.getElementById("passForm");
    const submitBtn = document.getElementById("submitPass");
    const dlg = document.getElementById("passModal");

    if (!form || !submitBtn || !dlg) return;
    if (submitBtn.dataset.bound === "1") return;
    submitBtn.dataset.bound = "1";

    submitBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();

      const slug =
        new URLSearchParams(location.search).get("team") ||
        JSON.parse(localStorage.getItem("lpi.session") || "null")?.slug ||
        "";

      const oldPass = document.getElementById("oldPass")?.value?.trim() || "";
      const newPass = document.getElementById("newPass")?.value?.trim() || "";
      const newPass2 = document.getElementById("newPass2")?.value?.trim() || "";
      const err = document.getElementById("passError");
      const ok = document.getElementById("passSuccess");

      if (err) err.style.display = "none";
      if (ok) ok.style.display = "none";

      if (!slug || !oldPass || !newPass || !newPass2) {
        if (err) {
          err.textContent = "Completá todos los campos";
          err.style.display = "block";
        }
        return;
      }

      if (newPass !== newPass2) {
        if (err) {
          err.textContent = "Las contraseñas nuevas no coinciden";
          err.style.display = "block";
        }
        return;
      }

      try {
        const res = await LPI_apiFetch("/api/team/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug,
            oldPassword: oldPass,
            newPassword: newPass
          })
        });

        if (!res.ok) {
          let msg = "No se pudo cambiar la contraseña";
          try {
            const data = await res.json();
            if (data?.error) msg = data.error;
          } catch {}
          if (err) {
            err.textContent = msg;
            err.style.display = "block";
          }
          return;
        }

        if (ok) {
          ok.textContent = "¡Contraseña actualizada!";
          ok.style.display = "block";
        }

        setTimeout(() => {
          try {
            dlg.close();
          } catch {}
        }, 700);
      } catch (e) {
        if (err) {
          err.textContent = "Error al cambiar la contraseña";
          err.style.display = "block";
        }
      }
    });

    form.querySelectorAll("[data-toggle]").forEach((chk) => {
      chk.addEventListener("change", () => {
        const target = document.querySelector(chk.dataset.toggle);
        if (!target) return;
        target.type = chk.checked ? "text" : "password";
      });
    });
  }

  function bootHeaderArea() {
    ensureHeaderButtons();
    wirePasswordModal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootHeaderArea);
  } else {
    bootHeaderArea();
  }
})();