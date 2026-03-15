const pool = require("../../db");

const DEFAULT_BANNERS = [
  { text: "Algo salió mal, contacte al administrador.", link: null }
];

function normalize(rows) {
  if (!rows || rows.length === 0) {
    return { banners: DEFAULT_BANNERS };
  }

  return {
    banners: rows.map((r) => ({
      text: r.text,
      link: r.link_href && r.link_label
        ? { href: r.link_href, label: r.link_label }
        : null
    }))
  };
}

async function getBanner() {
  const result = await pool.query(`
    SELECT text, link_href, link_label
    FROM banners
    WHERE active = true
    ORDER BY position ASC, id ASC
  `);

  return normalize(result.rows);
}

async function saveBanner(payload) {
  if (!payload || typeof payload !== "object") {
    const err = new Error("Payload inválido");
    err.statusCode = 400;
    throw err;
  }

  const banners = Array.isArray(payload.banners)
    ? payload.banners
    : payload.text
      ? [{ text: payload.text, link: payload.link }]
      : [];

  const cleaned = banners
    .map((b) => ({
      text: String(b.text || "").trim(),
      link: b.link || null
    }))
    .filter((b) => b.text);

  if (cleaned.length === 0) {
    cleaned.push(DEFAULT_BANNERS[0]);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`DELETE FROM banners`);

    for (let i = 0; i < cleaned.length; i++) {
      const b = cleaned[i];

      await client.query(
        `INSERT INTO banners (text, link_href, link_label, position)
         VALUES ($1,$2,$3,$4)`,
        [
          b.text,
          b.link?.href || null,
          b.link?.label || null,
          i
        ]
      );
    }

    await client.query("COMMIT");

    return { banners: cleaned };

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getBanner,
  saveBanner
};