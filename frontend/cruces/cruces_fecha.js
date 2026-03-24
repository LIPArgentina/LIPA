
/* FIX: extracción correcta de cruces por pares */

function extractMatchesFromFecha(fecha) {
  const result = [];
  if (!fecha || !Array.isArray(fecha.tablas)) return result;

  fecha.tablas.forEach((tabla) => {
    const equipos = Array.isArray(tabla?.equipos)
      ? tabla.equipos.filter(Boolean)
      : [];

    if (equipos.length < 2) return;

    for (let i = 0; i < equipos.length; i += 2) {
      const local = equipos[i];
      const visitante = equipos[i + 1];

      if (local?.equipo && visitante?.equipo) {
        result.push({
          local: local.equipo,
          visitante: visitante.equipo,
          grupo: tabla?.grupo || ""
        });
      }
    }
  });

  return result;
}
