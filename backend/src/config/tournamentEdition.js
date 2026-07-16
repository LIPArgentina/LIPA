const CURRENT_EDITION = 6;
const HISTORIC_EDITIONS = new Set([5, 6]);

function normalizeTournamentEdition(value, fallback = CURRENT_EDITION) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return HISTORIC_EDITIONS.has(parsed) ? parsed : fallback;
}

module.exports = {
  CURRENT_EDITION,
  normalizeTournamentEdition
};
