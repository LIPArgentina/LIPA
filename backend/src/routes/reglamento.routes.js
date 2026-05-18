const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

let cachedIndex = null;
let cachedMtimeMs = 0;

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/bola\s*8/g, 'bola ocho 8')
    .replace(/bola\s*9/g, 'bola nueve 9')
    .replace(/bola\s*10/g, 'bola diez 10')
    .replace(/triangulo/g, 'triangulo armado armar rack')
    .replace(/rompimiento|reventada|salida/g, 'quiebre reventada salida rompimiento')
    .replace(/buchaca|tronera/g, 'buchaca tronera')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/)
    .filter((w) => w.length >= 3 || /^\d+$/.test(w));
}

function detectModality(question) {
  const q = normalizeText(question);
  if (/\b(10|diez)\b/.test(q) || q.includes('bola diez')) return { key: 'bola10', words: ['bola', 'diez', '10'] };
  if (/\b(9|nueve)\b/.test(q) || q.includes('bola nueve')) return { key: 'bola9', words: ['bola', 'nueve', '9'] };
  if (/\b(8|ocho)\b/.test(q) || q.includes('bola ocho')) return { key: 'bola8', words: ['bola', 'ocho', '8'] };
  return null;
}

function chunkModality(text) {
  const t = normalizeText(text);
  if (t.includes('modalidad de bola nueve') || t.includes('bola nueve') || t.includes('bola 9')) return 'bola9';
  if (t.includes('modalidad de bola ocho') || t.includes('bola ocho') || t.includes('bola 8')) return 'bola8';
  if (t.includes('modalidad de bola diez') || t.includes('bola diez') || t.includes('bola 10')) return 'bola10';
  return null;
}

function directAnswer(question) {
  const q = normalizeText(question);
  const asksRack = /(armad|arma|armar|triangulo|rack|coloca|colocan|acomod)/.test(q);
  if (!asksRack) return null;

  if (detectModality(question)?.key === 'bola9') {
    return {
      answer: 'En Bola 9 se arma en forma de diamante sobre el punto pie: la bola 1 va en el ápice, la bola 9 va en el centro y las demás bolas pueden ir sin orden específico.',
      citations: [{ page: 20, title: '2.2 Armado de Bola Nueve' }]
    };
  }

  if (detectModality(question)?.key === 'bola8') {
    return {
      answer: 'En Bola 8 se arma un triángulo de 15 bolas sobre el punto pie. La bola 8 va en el centro, una bola de cada grupo va en los extremos del triángulo y el resto puede ir sin orden específico.',
      citations: [{ page: 24, title: '3.2 Armado de Bola Ocho (8)' }]
    };
  }

  if (detectModality(question)?.key === 'bola10') {
    return {
      answer: 'En Bola 10 se arma un triángulo lo más cerrado posible: la bola 1 va en el ápice sobre el punto pie, la bola 10 va en el centro y las demás bolas pueden ir sin orden específico.',
      citations: [{ page: 47, title: '9.2 Armado de bola diez' }]
    };
  }

  return null;
}

function getReglamentoPath(frontendDir) {
  const candidates = [
    path.join(frontendDir || '', 'reglamento', 'reglamento.html'),
    path.join(process.cwd(), 'frontend', 'reglamento', 'reglamento.html'),
    path.join(process.cwd(), 'reglamento', 'reglamento.html')
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('No se encontró frontend/reglamento/reglamento.html');
  return found;
}

function loadReglamentoIndex(frontendDir) {
  const filePath = getReglamentoPath(frontendDir);
  const stat = fs.statSync(filePath);
  if (cachedIndex && cachedMtimeMs === stat.mtimeMs) return cachedIndex;

  const html = fs.readFileSync(filePath, 'utf8');
  const pages = [];
  const pageRe = /<article\s+class="page-card"\s+id="page-(\d+)"\s+data-page="\d+">([\s\S]*?)(?=<\/article>)/gi;
  let match;

  while ((match = pageRe.exec(html))) {
    const page = Number(match[1]);
    const text = stripHtml(match[2]).replace(/^Página\s+\d+\s+Subir\s*/i, '').trim();
    if (text && text.length > 40) {
      pages.push({
        type: 'page',
        page,
        title: `Página ${page}`,
        text,
        normalized: normalizeText(text),
        tokens: tokenize(text),
        modality: chunkModality(text)
      });
    }
  }

  // Fragmentos destacados manuales para las secciones más consultadas.
  // Esto evita que una pregunta corta se vaya a páginas cercanas pero equivocadas.
  const manual = [
    {
      page: 20,
      title: '2.2 Armado de Bola Nueve',
      modality: 'bola9',
      text: 'Armado de Bola Nueve. Las bolas objetivo se colocan herméticamente pegadas en forma de diamante en el punto pie, con la bola número uno en el ápice del diamante y la bola número nueve en medio del diamante. Las otras bolas se pueden colocar sin orden específico de numeración.'
    },
    {
      page: 21,
      title: '2.3 Tiro de quiebre legal en Bola Nueve',
      modality: 'bola9',
      text: 'Tiro de quiebre legal en Bola Nueve. La bola tacadora es en mano y debe colocarse detrás de la línea de salida. Al menos tres bolas objetivo deben ser embocadas o cruzar la línea de la cabaña. Si la bola 9 es embocada en un tiro legal de salida, el jugador gana la mesa; si fue tiro ilegal, la bola 9 vuelve al punto pie.'
    },
    {
      page: 24,
      title: '3.2 Armado de Bola Ocho (8)',
      modality: 'bola8',
      text: 'Armado de Bola Ocho. Las quince bolas objetivo se colocan en forma de triángulo con una bola en el ápice sobre el punto pie. La bola ocho se coloca en el centro del triángulo. Una bola de cada grupo debe estar situada en los extremos del triángulo; las demás pueden colocarse sin orden numérico determinado.'
    },
    {
      page: 25,
      title: '3.3 Tiro de quiebre inicial en Bola Ocho',
      modality: 'bola8',
      text: 'Tiro de quiebre inicial en Bola Ocho. La bola tacadora comienza en mano detrás de la línea de cabaña. Si no se emboca ninguna bola, al menos cuatro bolas objetivo deben contactar banda; si no, el tiro es ilegal y el oponente puede aceptar la mesa, armar y quebrar, o armar y obligar a repetir el quiebre.'
    },
    {
      page: 25,
      title: '3.3 Bola ocho embocada en el quiebre',
      modality: 'bola8',
      text: 'Embocar la bola ocho en un tiro de quiebre no es una falta. Si se emboca la bola ocho en el quiebre, el jugador puede colocar nuevamente la bola ocho en el punto y aceptar la posición de las bolas restantes, o armar nuevamente el triángulo y ejecutar el tiro de quiebre.'
    },
    {
      page: 26,
      title: '3.4 Mesa abierta en Bola Ocho',
      modality: 'bola8',
      text: 'Mesa abierta en Bola Ocho. Antes de determinar grupos, la mesa está abierta. Si se emboca legalmente una bola, al jugador le corresponde el grupo de esa bola y al oponente el otro. Con mesa abierta cualquier bola objetivo puede golpearse primero excepto la bola ocho.'
    },
    {
      page: 47,
      title: '9.2 Armado de bola diez',
      modality: 'bola10',
      text: 'Armado de Bola Diez. Las bolas objetivo son armadas lo más herméticamente posible en forma triangular, con la bola uno en el ápice del triángulo sobre el punto pie y la bola diez en el centro del triángulo. Las otras bolas se colocan sin conservar un orden específico.'
    },
    {
      page: 47,
      title: '9 Modalidad de Bola Diez',
      modality: 'bola10',
      text: 'Bola Diez es una disciplina cantada, jugada con diez bolas objetivo numeradas del uno al diez y la bola tacadora. Las bolas son entroneradas en orden numérico ascendente. El jugador que legalmente emboca la bola diez como última bola gana la mesa.'
    }
  ].map((item) => ({
    type: 'section',
    ...item,
    normalized: normalizeText(`${item.title} ${item.text}`),
    tokens: tokenize(`${item.title} ${item.text}`)
  }));

  cachedIndex = [...manual, ...pages];
  cachedMtimeMs = stat.mtimeMs;
  return cachedIndex;
}

function expandQuery(question) {
  const tokens = new Set(tokenize(question));
  const q = normalizeText(question);
  const modality = detectModality(question);
  if (modality) modality.words.forEach((w) => tokens.add(w));
  if (/(armad|arma|armar|triangulo|rack|coloca|colocan|acomod)/.test(q)) {
    ['armado', 'armar', 'triangulo', 'diamante', 'apice', 'centro', 'punto', 'pie', 'colocan'].forEach((w) => tokens.add(w));
  }
  if (/(quiebre|romp|reventad|salida)/.test(q)) {
    ['quiebre', 'reventada', 'salida', 'cabaña', 'legal', 'ilegal'].forEach((w) => tokens.add(w));
  }
  if (/(falta|faltas)/.test(q)) ['falta', 'faltas', 'sancion', 'pierde'].forEach((w) => tokens.add(w));
  if (/(cantar|cantada|defensa)/.test(q)) ['cantada', 'cantar', 'defensa', 'buchaca'].forEach((w) => tokens.add(w));
  return { tokens: [...tokens], modality };
}

function findRelevantChunks(question, chunks) {
  const { tokens, modality } = expandQuery(question);
  const q = normalizeText(question);

  const scored = chunks.map((chunk) => {
    let score = 0;
    const norm = ` ${chunk.normalized} `;
    const titleNorm = normalizeText(chunk.title || '');

    for (const word of tokens) {
      if (!word) continue;
      const hit = norm.includes(` ${word} `);
      if (hit) score += word.length > 4 ? 3 : 1;
      if (titleNorm.includes(word)) score += 8;
    }

    if (chunk.type === 'section') score += 8;

    if (modality) {
      if (chunk.modality === modality.key) score += 35;
      else if (chunk.modality && chunk.modality !== modality.key) score -= 60;
    }

    if (/(armad|arma|armar|triangulo|rack|coloca|colocan|acomod)/.test(q)) {
      if (/armad|triangulo|diamante|apice|centro|colocan/.test(chunk.normalized)) score += 20;
      if (/quiebre|falta|continuacion|regulaciones|heyball/.test(titleNorm)) score -= 12;
    }

    if (/(quiebre|romp|reventad|salida)/.test(q) && /quiebre|reventada|salida/.test(chunk.normalized)) score += 18;
    if (/(bola\s*8|bola ocho|\b8\b)/.test(q) && chunk.page === 24) score += 18;
    if (/(bola\s*9|bola nueve|\b9\b)/.test(q) && chunk.page === 20) score += 18;
    if (/(bola\s*10|bola diez|\b10\b)/.test(q) && chunk.page === 47) score += 18;

    return { ...chunk, score };
  });

  return scored
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || (a.type === 'section' ? -1 : 1) || a.page - b.page)
    .slice(0, 5);
}

function extractAnswer(data) {
  if (data.output_text) return String(data.output_text).trim();
  const pieces = [];
  for (const item of data.output || []) {
    for (const c of item.content || []) {
      if (c.text) pieces.push(c.text);
    }
  }
  return pieces.join('\n').trim();
}

router.post('/reglamento/ask', async (req, res) => {
  try {
    const question = String(req.body?.question || '').trim();
    if (question.length < 4) {
      return res.status(400).json({ ok: false, error: 'Escribí una pregunta un poco más completa.' });
    }
    if (question.length > 700) {
      return res.status(400).json({ ok: false, error: 'La pregunta es demasiado larga.' });
    }

    const direct = directAnswer(question);
    if (direct) return res.json({ ok: true, ...direct });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: 'Falta configurar OPENAI_API_KEY en el backend.' });
    }

    const chunks = loadReglamentoIndex(req.app.locals.FRONTEND_DIR || req.deps?.FRONTEND_DIR || process.cwd());
    const relevant = findRelevantChunks(question, chunks);

    if (!relevant.length) {
      return res.json({
        ok: true,
        answer: 'No encontré una regla clara relacionada con esa pregunta dentro del reglamento CPB cargado.',
        citations: []
      });
    }

    const context = relevant
      .map((chunk, index) => `FUENTE ${index + 1}: ${chunk.title} — PÁGINA ${chunk.page}\n${chunk.text.slice(0, 2200)}`)
      .join('\n\n---\n\n');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_REGLAMENTO_MODEL || 'gpt-4.1-mini',
        input: [
          {
            role: 'system',
            content: [
              'Sos asistente de reglamento CPB para LIPA.',
              'Respondé corto, directo y en español rioplatense.',
              'Usá únicamente las fuentes provistas.',
              'No mezcles modalidades: si preguntan Bola 9, no uses Bola 8 salvo que la pregunta lo pida.',
              'Si la respuesta exacta está en una fuente, respondé sin dudar.',
              'Si no está claro, decí que no encontrás una regla clara en el reglamento cargado.',
              'Terminá con una línea: Fuente: título — página X.'
            ].join(' ')
          },
          {
            role: 'user',
            content: `Pregunta: ${question}\n\nFuentes del reglamento CPB:\n${context}`
          }
        ],
        temperature: 0.05,
        max_output_tokens: 320
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('OpenAI reglamento error:', data);
      return res.status(502).json({ ok: false, error: 'No se pudo consultar la IA en este momento.' });
    }

    const answer = extractAnswer(data);
    const citations = relevant.map((chunk) => ({ page: chunk.page, title: chunk.title })).slice(0, 4);
    res.json({ ok: true, answer: answer || 'No encontré una respuesta clara en el reglamento.', citations });
  } catch (err) {
    console.error('reglamento/ask error:', err);
    res.status(500).json({ ok: false, error: 'Error consultando el reglamento.' });
  }
});

module.exports = router;
