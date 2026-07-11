# Base de Datos Staging

Para tareas locales de Codex y scripts de mantenimiento, usar siempre staging:

- Frontend: `lipa-frontend-staging`
- Backend: `liga-backend-staging`
- DB: `lipa-db-staging`

El archivo `backend/.env` no se versiona. Debe configurarse manualmente con la `External Database URL` de Render para `lipa-db-staging`.

No usar URLs de producción ni URLs antiguas/no identificadas en `backend/.env`.

Antes de ejecutar scripts que escriban datos:

1. Confirmar que `DATABASE_URL` apunta a `lipa-db-staging`.
2. Ejecutar primero en modo `dry-run`.
3. Usar `--write` solo cuando el reporte sea correcto.

## Backfill de resultados por jugador

El script `backend/scripts/backfill_jugador_resultados.js` reconstruye resultados normalizados desde `cruces_validations`.

Primero ejecutar sin escritura:

```bash
node backend/scripts/backfill_jugador_resultados.js
```

Si el reporte es correcto, ejecutar la escritura:

```bash
node backend/scripts/backfill_jugador_resultados.js --write
```

También se puede limitar por categoría:

```bash
node backend/scripts/backfill_jugador_resultados.js --category=tercera
```
