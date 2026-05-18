const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

let cachedChunks = null;
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

function splitWords(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function loadReglamentoChunks(frontendDir) {
  const filePath = path.join(frontendDir, 'reglamento', 'reglamento.html');
  const stat = fs.statSync(filePath);

  if (cachedChunks && cachedMtimeMs === stat.mtimeMs) return cachedChunks;

  const html = fs.readFileSync(filePath, 'utf8');
  const chunks = [];
  const articleRe = /<article\s+class="page-card"\s+id="page-(\d+)"\s+data-page="\d+">([\s\S]*?)(?=<\/article>)/gi;
  let match;

  while ((match = articleRe.exec(html))) {
    const page = Number(match[1]);
    const text = stripHtml(match[2]);
    if (text && text.length > 40) {
      chunks.push({ page, text, key: splitWords(text) });
    }
  }

  cachedChunks = chunks;
  cachedMtimeMs = stat.mtimeMs;
  return chunks;
}

function findRelevantChunks(question, chunks) {
  const words = splitWords(question);
  const boosted = new Set(words);

  if (/bola\s*8|ocho/i.test(question)) ['bola','ocho','8'].forEach((w) => boosted.add(w));
  if (/bola\s*9|nueve/i.test(question)) ['bola','nueve','9'].forEach((w) => boosted.add(w));
  if (/bola\s*10|diez/i.test(question)) ['bola','diez','10'].forEach((w) => boosted.add(w));
  if (/quiebre|reventada|romp/i.test(question)) ['quiebre','reventada','salida'].forEach((w) => boosted.add(w));
  if (/falta|faltas/i.test(question)) ['falta','faltas'].forEach((w) => boosted.add(w));

  const scored = chunks.map((chunk) => {
    let score = 0;
    const textNorm = ' ' + chunk.key.join(' ') + ' ';
    for (const word of boosted) {
      if (textNorm.includes(' ' + word + ' ')) score += word.length > 4 ? 3 : 1;
    }
    return { ...chunk, score };
  });

  return scored
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.page - b.page)
    .slice(0, 6);
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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: 'Falta configurar OPENAI_API_KEY en el backend.' });
    }

    const chunks = loadReglamentoChunks(req.app.locals.FRONTEND_DIR || req.deps?.FRONTEND_DIR || process.cwd());
    const relevant = findRelevantChunks(question, chunks);

    if (!relevant.length) {
      return res.json({
        ok: true,
        answer: 'No encontré una regla clara relacionada con esa pregunta dentro del reglamento cargado.',
        citations: []
      });
    }

    const context = relevant.map((chunk) => `PÁGINA ${chunk.page}\n${chunk.text.slice(0, 2800)}`).join('\n\n---\n\n');

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
            content: 'Sos asistente de reglamento CPB para LIPA. Respondé en español rioplatense, corto y directo. Usá únicamente el contexto provisto. Si no está claro, decí que no encontrás una regla clara. Siempre citá al final los puntos o páginas usados, con formato: Fuente: página X.'
          },
          {
            role: 'user',
            content: `Pregunta: ${question}\n\nContexto del reglamento:\n${context}`
          }
        ],
        temperature: 0.2,
        max_output_tokens: 280
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('OpenAI reglamento error:', data);
      return res.status(502).json({ ok: false, error: 'No se pudo consultar la IA en este momento.' });
    }

    const answer = data.output_text || data.output?.flatMap((item) => item.content || []).map((c) => c.text || '').join('\n').trim();
    const citations = relevant.map((chunk) => ({ page: chunk.page })).slice(0, 4);

    res.json({ ok: true, answer: answer || 'No encontré una respuesta clara en el reglamento.', citations });
  } catch (err) {
    console.error('reglamento/ask error:', err);
    res.status(500).json({ ok: false, error: 'Error consultando el reglamento.' });
  }
});

module.exports = router;
