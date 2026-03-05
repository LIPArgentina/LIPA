

## Contenido restaurado del ZIP original
- Se detectó frontend original en: `/mnt/data/original_zip/LIGA/Frontend`.
- Carpetas agregadas en `frontend/legacy/`: 
  - legacy/data/
  - legacy/equipos/
  - legacy/fecha/
  - legacy/fixture/
  - legacy/tablas/
  - legacy/templates/
- Archivos raíz preservados en `frontend/legacy/root_files/`:
  - legacy/root_files/admin.html
  - legacy/root_files/index.html
  - legacy/root_files/logo_liga.png
  - legacy/root_files/planilla.html
  - legacy/root_files/primera.html
  - legacy/root_files/segunda.html
  - legacy/root_files/tercera.html
- JSONs de datos también copiados a `backend/src/data/` (prefijo por carpeta):
  - backend/src/data/data_usuarios.json
  - backend/src/data/equipos_babylon.players.json
  - backend/src/data/equipos_dogos.players.json
  - backend/src/data/equipos_el-trebol.players.json
  - backend/src/data/equipos_nuevo.players.json
  - backend/src/data/equipos_takos.players.json


## Fusión desde ZIP original (último adjunto)
- Frontend original detectado en: `/mnt/data/original_zip_1760145747/LIGA/Frontend`.
- Archivos raíz preservados en `frontend/legacy/root_files/`:
  - legacy/root_files/admin.html
  - legacy/root_files/index.html
  - legacy/root_files/logo_liga.png
  - legacy/root_files/planilla.html
  - legacy/root_files/primera.html
  - legacy/root_files/segunda.html
  - legacy/root_files/tercera.html
- JSONs replicados a `backend/src/data/` para usar desde la API:
  - backend/src/data/data_usuarios.json
  - backend/src/data/equipos_babylon.players.json
  - backend/src/data/equipos_dogos.players.json
  - backend/src/data/equipos_el-trebol.players.json
  - backend/src/data/equipos_nuevo.players.json
  - backend/src/data/equipos_takos.players.json


## Ajuste solicitado
- Se restauró el **frontend original** en la raíz de `frontend/` (sin carpeta `legacy/`).
- Se mantuvieron también archivos como `logo_liga.png` en la raíz para compatibilidad con rutas antiguas.
- El backend está configurado para servir `frontend/` como estático.
