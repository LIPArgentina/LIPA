# LIPA

Sitio y backend de la Liga LIPA.

## Estructura

- `frontend/`: archivos públicos del sitio.
- `backend/`: API Node/Express y conexión a base de datos.
- `robots.txt`: reglas públicas para buscadores.
- `sitemap.xml`: rutas públicas principales del sitio.

## Variables de entorno

No subir archivos `.env` al repositorio. Configurar las variables en Render:

- `DATABASE_URL`
- `JWT_SECRET`
- `FRONTEND_URL`
- `PICTURES_DIR`
- `OPENAI_API_KEY`, si se usa el asistente de reglamento

`JWT_SECRET` debe ser largo y aleatorio. No usar valores de ejemplo.
