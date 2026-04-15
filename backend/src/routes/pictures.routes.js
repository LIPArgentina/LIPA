// PATCH: getTeamOptions adjusted for frontend compatibility

async function getTeamOptions() {
  const { rows } = await pool.query(
    `
    SELECT display_name, slug_uid, slug_base
    FROM equipos
    WHERE COALESCE(display_name, '') <> ''
      AND (COALESCE(slug_uid, '') <> '' OR COALESCE(slug_base, '') <> '')
    ORDER BY display_name ASC, id ASC
    `
  );

  const seen = new Set();
  const options = [];

  for (const row of rows) {
    const slug = normalizeSlug(row.slug_uid || row.slug_base || '');
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    options.push({
      slug,
      displayName: String(row.display_name || slug).trim()
    });
  }

  return options;
}
