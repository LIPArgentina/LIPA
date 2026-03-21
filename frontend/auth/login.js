const API_BASE = ""; // mismo dominio

async function loadTeams(category) {
  try {
    const res = await fetch(`${API_BASE}/api/teams?division=${category}`);
    const data = await res.json();
    return data.users || [];
  } catch (err) {
    console.error("Error cargando equipos:", err);
    return [];
  }
}

async function openTeamCategory(category) {
  const teamList = document.getElementById("teamList");
  teamList.innerHTML = "<div style='padding:10px'>Cargando...</div>";

  const teams = await loadTeams(category);

  if (!teams.length) {
    teamList.innerHTML = "<div style='padding:10px'>No hay equipos</div>";
    return;
  }

  teamList.innerHTML = teams.map(team => `
    <div class="team-option" data-team="${team.username}">
      ${team.username}
    </div>
  `).join("");

  document.querySelectorAll(".team-option").forEach(el => {
    el.addEventListener("click", () => {
      selectTeam(el.dataset.team);
    });
  });
}

function selectTeam(teamName) {
  document.getElementById("teamInput").value = teamName;
  document.getElementById("teamList").innerHTML = "";
}
