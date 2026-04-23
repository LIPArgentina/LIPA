// --- Helper para nombres prolijos ---
function slugifyFileName(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// --- Nombre de archivo ---
function sheetFileNameForMatch(ext) {
  const exportData = window.__CRUCE_EXPORT_DATA__ || {};
  const localRaw = exportData.local?.name || exportData.local?.team || 'local';
  const visitanteRaw = exportData.visitante?.name || exportData.visitante?.team || 'visitante';
  const categoryRaw = exportData.category || '';

  const localName = slugifyFileName(localRaw);
  const visitanteName = slugifyFileName(visitanteRaw);
  const category = slugifyFileName(categoryRaw);

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const fecha = `${yyyy}-${mm}-${dd}`;

  const cleanExt = String(ext || '').replace(/^\./, '').toLowerCase() || 'jpg';

  const parts = ['cruces'];
  if (category) parts.push(category);
  parts.push(localName || 'local');
  parts.push('vs');
  parts.push(visitanteName || 'visitante');
  parts.push(fecha);

  return `${parts.join('_')}.${cleanExt}`;
}
