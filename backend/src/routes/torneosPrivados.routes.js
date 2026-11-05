const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../db');
const { requireAdmin, requireTorneoOrganizador } = require('../middleware/auth');
const { createRenewableSession, setAccessCookie } = require('../utils/authSessions');

const DEFAULT_PASSWORD = '1234';
const MAX_ORGANIZADORES = 30;

function slugify(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function cleanDni(value) {
  return String(value || '').replace(/\D/g, '');
}

function cleanWhatsapp(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function normalizeCategoria(value) {
  const category = String(value || '').trim().toLowerCase();
  if (['primera', '1ra', '1era'].includes(category)) return 'primera';
  if (['segunda', '2da'].includes(category)) return 'segunda';
  if (['tercera', '3ra'].includes(category)) return 'tercera';
  return null;
}

function categoriaMasBaja(...values) {
  const categories = values.flat(Infinity).map(normalizeCategoria).filter(Boolean);
  if (categories.includes('tercera')) return 'tercera';
  if (categories.includes('segunda')) return 'segunda';
  if (categories.includes('primera')) return 'primera';
  return null;
}

module.exports = function createTorneosPrivadosRouter() {
  const router = express.Router();
  let schemaPromise = null;

  function ensureSchema() {
    if (!schemaPromise) {
      schemaPromise = pool.query(`
        CREATE TABLE IF NOT EXISTS torneo_organizadores (
          id SERIAL PRIMARY KEY,
          nombre_promocional TEXT NOT NULL,
          nombre_organizador TEXT NOT NULL DEFAULT '',
          whatsapp TEXT NOT NULL DEFAULT '',
          ubicacion TEXT NOT NULL DEFAULT '',
          slug TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          must_change_password BOOLEAN NOT NULL DEFAULT true,
          activo BOOLEAN NOT NULL DEFAULT true,
          orden INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS torneo_inscripciones (
          id BIGSERIAL PRIMARY KEY,
          torneo_organizador_id INTEGER NOT NULL REFERENCES torneo_organizadores(id) ON DELETE CASCADE,
          jugador_id INTEGER REFERENCES jugadores(id) ON DELETE SET NULL,
          nombre_ingresado TEXT NOT NULL,
          nombre_oficial TEXT NOT NULL,
          dni TEXT NOT NULL,
          whatsapp TEXT NOT NULL,
          categoria TEXT,
          estado_pago TEXT NOT NULL CHECK (estado_pago IN ('total', 'sena', 'sin_sena')),
          monto_sena INTEGER,
          corroborado BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(torneo_organizador_id, dni)
        );

        CREATE INDEX IF NOT EXISTS torneo_inscripciones_organizador_idx
          ON torneo_inscripciones(torneo_organizador_id, corroborado, created_at DESC);

        ALTER TABLE torneo_inscripciones
          ADD COLUMN IF NOT EXISTS categoria TEXT;
        ALTER TABLE torneo_inscripciones
          ADD COLUMN IF NOT EXISTS porcentaje_sena SMALLINT;
        ALTER TABLE torneo_inscripciones
          ADD COLUMN IF NOT EXISTS monto_sena INTEGER;
        ALTER TABLE torneo_inscripciones
          DROP CONSTRAINT IF EXISTS torneo_inscripciones_estado_pago_check;
        UPDATE torneo_inscripciones
           SET porcentaje_sena = 50
         WHERE estado_pago = '50'
           AND porcentaje_sena IS NULL;
        UPDATE torneo_inscripciones
           SET estado_pago = 'sena'
         WHERE estado_pago = '50';
        UPDATE torneo_inscripciones
           SET monto_sena = COALESCE(monto_sena, porcentaje_sena::integer * 1000, 50000)
         WHERE estado_pago = 'sena';
        UPDATE torneo_inscripciones
           SET monto_sena = NULL
         WHERE estado_pago <> 'sena';
        ALTER TABLE torneo_inscripciones
          ADD CONSTRAINT torneo_inscripciones_estado_pago_check
          CHECK (estado_pago IN ('total', 'sena', 'sin_sena'));
        ALTER TABLE torneo_inscripciones
          DROP CONSTRAINT IF EXISTS torneo_inscripciones_porcentaje_sena_check;
        UPDATE torneo_inscripciones SET porcentaje_sena = NULL;
        ALTER TABLE torneo_inscripciones
          DROP CONSTRAINT IF EXISTS torneo_inscripciones_monto_sena_check;
        ALTER TABLE torneo_inscripciones
          ADD CONSTRAINT torneo_inscripciones_monto_sena_check
          CHECK (
            (estado_pago = 'sena' AND monto_sena BETWEEN 1000 AND 99999000 AND monto_sena % 1000 = 0)
            OR (estado_pago IN ('total', 'sin_sena') AND monto_sena IS NULL)
          );
        ALTER TABLE torneo_inscripciones
          DROP CONSTRAINT IF EXISTS torneo_inscripciones_categoria_check;
        ALTER TABLE torneo_inscripciones
          ADD CONSTRAINT torneo_inscripciones_categoria_check
          CHECK (categoria IS NULL OR categoria IN ('primera', 'segunda', 'tercera'));
      `).catch((error) => {
        schemaPromise = null;
        throw error;
      });
    }
    return schemaPromise;
  }

  async function reconcilePendingRegistrations(organizerId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`
        SELECT
          i.id AS inscripcion_id,
          j.id AS jugador_id,
          j.nombre,
          j.categoria_actual,
          ARRAY(
            SELECT je.categoria
              FROM jugador_equipos je
             WHERE je.jugador_id = j.id
               AND je.activo = true
             ORDER BY je.desde DESC NULLS LAST, je.id DESC
          ) AS categorias_activas
          FROM torneo_inscripciones i
          JOIN LATERAL (
            SELECT candidate.id, candidate.nombre, candidate.categoria_actual
              FROM jugadores candidate
             WHERE regexp_replace(COALESCE(candidate.dni, ''), '[^0-9]', '', 'g') =
                   regexp_replace(COALESCE(i.dni, ''), '[^0-9]', '', 'g')
               AND regexp_replace(COALESCE(candidate.dni, ''), '[^0-9]', '', 'g') <> ''
             ORDER BY candidate.id ASC
             LIMIT 1
          ) j ON true
         WHERE i.torneo_organizador_id = $1
           AND i.corroborado = false
         FOR UPDATE OF i
      `, [organizerId]);

      for (const row of rows) {
        const categoria = categoriaMasBaja(row.categoria_actual, row.categorias_activas || []);
        await client.query(`
          UPDATE torneo_inscripciones
             SET jugador_id = $1,
                 nombre_oficial = $2,
                 categoria = COALESCE($3, categoria),
                 corroborado = true,
                 updated_at = NOW()
           WHERE id = $4
             AND torneo_organizador_id = $5
             AND corroborado = false
        `, [row.jugador_id, row.nombre, categoria, row.inscripcion_id, organizerId]);
      }

      await client.query('COMMIT');
      return rows.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function findOrganizador({ id, slug, includeInactive = false }) {
    await ensureSchema();
    const values = [];
    const clauses = [];
    const numericId = Number(id);
    if (Number.isFinite(numericId) && numericId > 0) {
      values.push(numericId);
      clauses.push(`id = $${values.length}`);
    } else {
      const cleanSlug = slugify(slug);
      if (!cleanSlug) return null;
      values.push(cleanSlug);
      clauses.push(`slug = $${values.length}`);
    }
    if (!includeInactive) clauses.push('activo = true');
    const result = await pool.query(
      `SELECT * FROM torneo_organizadores WHERE ${clauses.join(' AND ')} LIMIT 1`, values
    );
    return result.rows[0] || null;
  }

  router.get('/torneo-organizadores', async (_req, res) => {
    try {
      await ensureSchema();
      const { rows } = await pool.query(`
        SELECT id, nombre_promocional, nombre_organizador, whatsapp, ubicacion, slug
          FROM torneo_organizadores
         WHERE activo = true
         ORDER BY orden ASC, nombre_promocional ASC
      `);
      res.json({ ok: true, organizadores: rows });
    } catch (error) {
      console.error('GET /torneo-organizadores', error);
      res.status(500).json({ ok: false, error: 'No se pudieron cargar los organizadores' });
    }
  });

  router.get('/admin/torneo-organizadores', requireAdmin, async (_req, res) => {
    try {
      await ensureSchema();
      const { rows } = await pool.query(`
        SELECT id, nombre_promocional, nombre_organizador, whatsapp, ubicacion, slug, activo, orden
          FROM torneo_organizadores ORDER BY orden ASC, id ASC
      `);
      res.json({ ok: true, organizadores: rows });
    } catch (error) {
      console.error('GET /admin/torneo-organizadores', error);
      res.status(500).json({ ok: false, error: 'No se pudieron cargar los organizadores' });
    }
  });

  router.post('/admin/save-torneo-organizadores', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureSchema();
      const input = Array.isArray(req.body?.organizadores) ? req.body.organizadores.slice(0, MAX_ORGANIZADORES) : [];
      const rows = input.map((item, index) => {
        const nombrePromocional = String(item?.nombrePromocional || '').trim();
        const slug = slugify(item?.slug || nombrePromocional);
        if (!nombrePromocional || !slug) return null;
        return {
          id: Number(item?.id) || null,
          nombrePromocional,
          nombreOrganizador: String(item?.nombreOrganizador || '').trim(),
          whatsapp: cleanWhatsapp(item?.whatsapp),
          ubicacion: String(item?.ubicacion || '').trim(),
          slug,
          activo: item?.activo !== false,
          orden: index + 1,
        };
      }).filter(Boolean);
      const seen = new Set();
      for (const row of rows) {
        if (seen.has(row.slug)) return res.status(400).json({ ok: false, error: `Nombre promocional repetido: ${row.nombrePromocional}` });
        seen.add(row.slug);
      }

      const defaultHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
      await client.query('BEGIN');
      const keepIds = [];
      for (const row of rows) {
        let saved;
        if (row.id) {
          saved = await client.query(`
            UPDATE torneo_organizadores SET
              nombre_promocional=$1, nombre_organizador=$2, whatsapp=$3, ubicacion=$4,
              slug=$5, activo=$6, orden=$7, updated_at=NOW()
            WHERE id=$8 RETURNING id
          `, [row.nombrePromocional, row.nombreOrganizador, row.whatsapp, row.ubicacion, row.slug, row.activo, row.orden, row.id]);
        }
        if (!saved?.rowCount) {
          saved = await client.query(`
            INSERT INTO torneo_organizadores
              (nombre_promocional, nombre_organizador, whatsapp, ubicacion, slug, password_hash, must_change_password, activo, orden)
            VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8)
            ON CONFLICT (slug) DO UPDATE SET
              nombre_promocional=EXCLUDED.nombre_promocional,
              nombre_organizador=EXCLUDED.nombre_organizador,
              whatsapp=EXCLUDED.whatsapp, ubicacion=EXCLUDED.ubicacion,
              activo=EXCLUDED.activo, orden=EXCLUDED.orden, updated_at=NOW()
            RETURNING id
          `, [row.nombrePromocional, row.nombreOrganizador, row.whatsapp, row.ubicacion, row.slug, defaultHash, row.activo, row.orden]);
        }
        keepIds.push(saved.rows[0].id);
      }
      if (keepIds.length) {
        await client.query('UPDATE torneo_organizadores SET activo=false, updated_at=NOW() WHERE NOT (id = ANY($1::int[]))', [keepIds]);
      } else {
        await client.query('UPDATE torneo_organizadores SET activo=false, updated_at=NOW()');
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('POST /admin/save-torneo-organizadores', error);
      res.status(500).json({ ok: false, error: 'No se pudieron guardar los organizadores' });
    } finally {
      client.release();
    }
  });

  router.post('/torneo-organizador/login', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const organizador = await findOrganizador({ id: req.body?.id, slug: req.body?.slug });
      if (!organizador) return res.status(404).json({ ok: false, msg: 'organizador inexistente' });
      const valid = await bcrypt.compare(String(req.body?.password || ''), organizador.password_hash || '');
      if (!valid) return res.status(401).json({ ok: false, msg: 'contraseña incorrecta' });
      const session = await createRenewableSession({
        role: 'torneo', torneoOrganizadorId: organizador.id, slug: organizador.slug,
        displayName: organizador.nombre_promocional
      }, `torneo:${organizador.id}`);
      setAccessCookie(res, session.token);
      res.json({
        ok: true, role: 'torneo', torneoOrganizadorId: organizador.id,
        slug: organizador.slug, displayName: organizador.nombre_promocional,
        mustChangePassword: organizador.must_change_password, ...session
      });
    } catch (error) {
      console.error('POST /torneo-organizador/login', error);
      res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión' });
    }
  });

  router.post('/torneo-organizador/change-password', requireTorneoOrganizador, async (req, res) => {
    try {
      const current = String(req.body?.oldPassword || '');
      const next = String(req.body?.newPassword || '');
      if (!current || next.length < 4) return res.status(400).json({ ok: false, error: 'La nueva contraseña debe tener al menos 4 caracteres' });
      const organizador = await findOrganizador({ id: req.user.torneoOrganizadorId, includeInactive: true });
      if (!organizador || !(await bcrypt.compare(current, organizador.password_hash))) {
        return res.status(401).json({ ok: false, error: 'La contraseña actual no es correcta' });
      }
      const hash = await bcrypt.hash(next, 10);
      await pool.query('UPDATE torneo_organizadores SET password_hash=$1, must_change_password=false, updated_at=NOW() WHERE id=$2', [hash, organizador.id]);
      res.json({ ok: true });
    } catch (error) {
      console.error('POST /torneo-organizador/change-password', error);
      res.status(500).json({ ok: false, error: 'No se pudo cambiar la contraseña' });
    }
  });

  router.get('/torneo-organizador/inscripciones', requireTorneoOrganizador, async (req, res) => {
    try {
      await ensureSchema();
      const actualizadas = await reconcilePendingRegistrations(req.user.torneoOrganizadorId);
      const organizador = await findOrganizador({ id: req.user.torneoOrganizadorId, includeInactive: true });
      const { rows } = await pool.query(`
        SELECT i.id, i.jugador_id, i.nombre_ingresado, i.nombre_oficial, i.dni, i.whatsapp, i.categoria,
               i.estado_pago, i.monto_sena, i.corroborado, i.created_at, i.updated_at,
               COALESCE(j.foto_path, '') AS foto_path
          FROM torneo_inscripciones i
          LEFT JOIN jugadores j ON j.id = i.jugador_id
         WHERE i.torneo_organizador_id=$1 ORDER BY i.created_at DESC, i.id DESC
      `, [req.user.torneoOrganizadorId]);
      res.json({ ok: true, organizador: {
        nombrePromocional: organizador.nombre_promocional,
        nombreOrganizador: organizador.nombre_organizador,
        whatsapp: organizador.whatsapp, ubicacion: organizador.ubicacion,
        mustChangePassword: organizador.must_change_password
      }, inscripciones: rows, pendientesActualizadas: actualizadas });
    } catch (error) {
      console.error('GET /torneo-organizador/inscripciones', error);
      res.status(500).json({ ok: false, error: 'No se pudieron cargar las inscripciones' });
    }
  });

  router.post('/torneo-organizador/inscripciones/revisar-pendientes', requireTorneoOrganizador, async (req, res) => {
    try {
      await ensureSchema();
      const actualizadas = await reconcilePendingRegistrations(req.user.torneoOrganizadorId);
      res.json({ ok: true, actualizadas });
    } catch (error) {
      console.error('POST /torneo-organizador/inscripciones/revisar-pendientes', error);
      res.status(500).json({ ok: false, error: 'No se pudieron revisar las inscripciones pendientes' });
    }
  });

  router.get('/torneo-organizador/jugadores', requireTorneoOrganizador, async (req, res) => {
    try {
      const query = String(req.query?.q || '').trim();
      const dni = cleanDni(query);
      if (query.length < 2 && dni.length < 2) return res.json({ ok: true, jugadores: [] });
      const words = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
      const values = [];
      const clauses = [];
      if (dni) {
        values.push(`${dni}%`);
        clauses.push(`regexp_replace(COALESCE(j.dni,''), '[^0-9]', '', 'g') LIKE $${values.length}`);
      }
      if (words.length) {
        const wordClauses = words.map(word => {
          values.push(`%${word}%`);
          return `LOWER(COALESCE(NULLIF(j.nombre_normalizado, ''), j.nombre, '')) LIKE $${values.length}`;
        });
        clauses.push(`(${wordClauses.join(' AND ')})`);
      }
      if (!clauses.length) return res.json({ ok: true, jugadores: [] });
      const result = await pool.query(`
        SELECT
          j.id,
          j.nombre,
          COALESCE(j.dni, '') AS dni,
          EXISTS (
            SELECT 1
              FROM jugador_equipos je
             WHERE je.jugador_id = j.id
               AND je.activo = true
          ) AS activo
          FROM jugadores j
         WHERE (${clauses.join(' OR ')})
         ORDER BY j.nombre ASC, j.id ASC
         LIMIT 30
      `, values);
      res.json({ ok: true, jugadores: result.rows });
    } catch (error) {
      console.error('GET /torneo-organizador/jugadores', error);
      res.status(500).json({ ok: false, error: 'No se pudieron buscar jugadores' });
    }
  });

  router.post('/torneo-organizador/inscripciones', requireTorneoOrganizador, async (req, res) => {
    try {
      await ensureSchema();
      const nombre = String(req.body?.nombre || '').trim().replace(/\s+/g, ' ');
      const dni = cleanDni(req.body?.dni);
      const whatsapp = cleanWhatsapp(req.body?.whatsapp);
      const requestedPayment = String(req.body?.estadoPago || '').trim().toLowerCase();
      const estadoPago = requestedPayment === '50' ? 'sena' : requestedPayment;
      const legacyPercentage = Number(req.body?.porcentajeSena ?? (requestedPayment === '50' ? 50 : NaN));
      const rawAmount = Number(req.body?.montoSena ?? (Number.isInteger(legacyPercentage) ? legacyPercentage * 1000 : NaN));
      const montoSena = estadoPago === 'sena' && Number.isInteger(rawAmount) && rawAmount >= 1000 && rawAmount <= 99999000 && rawAmount % 1000 === 0
        ? rawAmount
        : null;
      if (!nombre || dni.length < 6 || !['total', 'sena', 'sin_sena'].includes(estadoPago)) {
        return res.status(400).json({ ok: false, error: 'Nombre, DNI y estado de pago son obligatorios' });
      }
      if (estadoPago === 'sena' && montoSena === null) {
        return res.status(400).json({ ok: false, error: 'Ingresá el monto de seña en miles de pesos' });
      }
      const found = await pool.query(`
        SELECT j.id, j.nombre, j.categoria_actual,
               ARRAY(
                 SELECT je.categoria FROM jugador_equipos je
                  WHERE je.jugador_id=j.id AND je.activo=true
                  ORDER BY je.desde DESC NULLS LAST, je.id DESC
               ) AS categorias_activas
          FROM jugadores j
         WHERE regexp_replace(COALESCE(j.dni,''), '[^0-9]', '', 'g')=$1
         ORDER BY j.id ASC LIMIT 1
      `, [dni]);
      const player = found.rows[0] || null;
      const categoria = categoriaMasBaja(player?.categoria_actual, player?.categorias_activas || []);
      if (!player && req.body?.confirmProvisional !== true) {
        return res.json({ ok: true, corroborado: false, requiresConfirmation: true });
      }
      const result = await pool.query(`
        INSERT INTO torneo_inscripciones
          (torneo_organizador_id, jugador_id, nombre_ingresado, nombre_oficial, dni, whatsapp, categoria, estado_pago, monto_sena, corroborado)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
      `, [req.user.torneoOrganizadorId, player?.id || null, nombre, player?.nombre || nombre, dni, whatsapp, categoria, estadoPago, montoSena, Boolean(player)]);
      res.status(201).json({ ok: true, corroborado: Boolean(player), inscripcion: result.rows[0] });
    } catch (error) {
      if (error?.code === '23505') return res.status(409).json({ ok: false, error: 'Ese DNI ya está inscripto en este torneo' });
      console.error('POST /torneo-organizador/inscripciones', error);
      res.status(500).json({ ok: false, error: 'No se pudo guardar la inscripción' });
    }
  });

  router.patch('/torneo-organizador/inscripciones/:id/pago', requireTorneoOrganizador, async (req, res) => {
    try {
      const requestedPayment = String(req.body?.estadoPago || '').trim().toLowerCase();
      const estado = requestedPayment === '50' ? 'sena' : requestedPayment;
      const legacyPercentage = Number(req.body?.porcentajeSena ?? (requestedPayment === '50' ? 50 : NaN));
      const rawAmount = Number(req.body?.montoSena ?? (Number.isInteger(legacyPercentage) ? legacyPercentage * 1000 : NaN));
      const montoSena = estado === 'sena' && Number.isInteger(rawAmount) && rawAmount >= 1000 && rawAmount <= 99999000 && rawAmount % 1000 === 0
        ? rawAmount
        : null;
      if (!['total', 'sena', 'sin_sena'].includes(estado)) return res.status(400).json({ ok: false, error: 'Estado de pago inválido' });
      if (estado === 'sena' && montoSena === null) return res.status(400).json({ ok: false, error: 'Ingresá el monto de seña en miles de pesos' });
      const result = await pool.query(`
        UPDATE torneo_inscripciones
           SET estado_pago=$1, monto_sena=$2, updated_at=NOW()
         WHERE id=$3 AND torneo_organizador_id=$4 RETURNING *
      `, [estado, montoSena, Number(req.params.id), req.user.torneoOrganizadorId]);
      if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Inscripción no encontrada' });
      res.json({ ok: true, inscripcion: result.rows[0] });
    } catch (error) {
      console.error('PATCH pago inscripción', error);
      res.status(500).json({ ok: false, error: 'No se pudo actualizar el pago' });
    }
  });

  router.patch('/torneo-organizador/inscripciones/:id/contacto', requireTorneoOrganizador, async (req, res) => {
    try {
      const whatsapp = cleanWhatsapp(req.body?.whatsapp);
      const result = await pool.query(`
        UPDATE torneo_inscripciones SET whatsapp=$1, updated_at=NOW()
         WHERE id=$2 AND torneo_organizador_id=$3 RETURNING *
      `, [whatsapp, Number(req.params.id), req.user.torneoOrganizadorId]);
      if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Inscripción no encontrada' });
      res.json({ ok: true, inscripcion: result.rows[0] });
    } catch (error) {
      console.error('PATCH contacto inscripción', error);
      res.status(500).json({ ok: false, error: 'No se pudo actualizar el contacto' });
    }
  });

  router.patch('/torneo-organizador/inscripciones/:id/categoria', requireTorneoOrganizador, async (req, res) => {
    try {
      const categoria = ['primera', 'segunda', 'tercera'].includes(req.body?.categoria) ? req.body.categoria : '';
      if (!categoria) return res.status(400).json({ ok: false, error: 'Categoría inválida' });
      const result = await pool.query(`
        UPDATE torneo_inscripciones SET categoria=$1, updated_at=NOW()
         WHERE id=$2 AND torneo_organizador_id=$3 RETURNING *
      `, [categoria, Number(req.params.id), req.user.torneoOrganizadorId]);
      if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Inscripción no encontrada' });
      res.json({ ok: true, inscripcion: result.rows[0] });
    } catch (error) {
      console.error('PATCH categoría inscripción', error);
      res.status(500).json({ ok: false, error: 'No se pudo actualizar la categoría' });
    }
  });

  router.delete('/torneo-organizador/inscripciones/:id', requireTorneoOrganizador, async (req, res) => {
    try {
      const result = await pool.query('DELETE FROM torneo_inscripciones WHERE id=$1 AND torneo_organizador_id=$2', [Number(req.params.id), req.user.torneoOrganizadorId]);
      if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Inscripción no encontrada' });
      res.json({ ok: true });
    } catch (error) {
      console.error('DELETE inscripción', error);
      res.status(500).json({ ok: false, error: 'No se pudo eliminar la inscripción' });
    }
  });

  router.post('/admin/reset-torneo-password/:id', requireAdmin, async (req, res) => {
    try {
      await ensureSchema();
      const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
      const result = await pool.query(`
        UPDATE torneo_organizadores SET password_hash=$1, must_change_password=true, updated_at=NOW()
         WHERE id=$2 RETURNING id, nombre_promocional
      `, [hash, Number(req.params.id)]);
      if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Organizador no encontrado' });
      res.json({ ok: true, newPassword: DEFAULT_PASSWORD });
    } catch (error) {
      console.error('POST reset torneo password', error);
      res.status(500).json({ ok: false, error: 'No se pudo blanquear la contraseña' });
    }
  });

  router.post('/admin/impersonate-torneo', requireAdmin, async (req, res) => {
    try {
      const organizador = await findOrganizador({ id: req.body?.id, includeInactive: true });
      if (!organizador) return res.status(404).json({ ok: false, error: 'Organizador no encontrado' });
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error('Falta JWT_SECRET');
      const token = jwt.sign({ role: 'torneo', torneoOrganizadorId: organizador.id, slug: organizador.slug, displayName: organizador.nombre_promocional, impersonatedBy: 'admin' }, secret, { expiresIn: '45m' });
      res.json({ ok: true, session: { role: 'torneo', torneoOrganizadorId: organizador.id, slug: organizador.slug, displayName: organizador.nombre_promocional, category: 'torneos', token, isTestSession: true, ts: Date.now() } });
    } catch (error) {
      console.error('POST impersonate torneo', error);
      res.status(500).json({ ok: false, error: 'No se pudo generar la sesión temporal' });
    }
  });

  return router;
};
