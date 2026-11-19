# Visor del torneo Rodry Baygo

El visor comparte la grilla del organizador y los resultados publicados en LIPA.

- `frontend/torneos/torneos.html`: tarjeta del evento con flyer y DNI. Al ingresar, el jugador abre su categoría de inscripción. Con inscripción doble abre la primera de las dos y puede cambiar de pestaña. Volver a Torneos permite consultar el listado general.
- `frontend/torneos/visor.html`: consulta de las tres categorías con resultados cada 10 segundos y llamados personales cada 5 segundos. Cerrar sesión está en el contenido de `<main>`, fuera de los encabezados.
- `frontend/torneos/grilla.html`: mesa 1–19, piso arriba/abajo y botón rojo de llamada entre jugadores; botón WhatsApp debajo de la foto ampliada. WhatsApp abre el chat con texto preparado, sin enviarlo automáticamente.
- El servidor verifica el DNI en `jugadores`; guarda un token aleatorio con hash SHA-256, vigencia 180 días. El token del visor no concede acceso de organizador. El cierre elimina la sesión y su asociación de push.
- El visor no expone DNI, teléfonos ni identificadores internos de jugador. Las rutas de llamados y contactos requieren sesión de organizador.
- Las mesas se vinculan al sorteo, partido y ambos participantes. Si cambia alguno, la asignación anterior no se muestra.
- Cada columna permite buscar por nombre o apellido. El organizador marca «En sala» en la primera columna de Inscripciones. Ambos rivales deben estar presentes para reservar o llamar. Elegir una mesa la reserva para ese cruce en todas las categorías del organizador. Arriba existen las mesas 1 a 19 y abajo las 1 a 6 y 11 a 15. «Liberar mesa», cambiar de mesa o finalizar el partido devuelve la mesa anterior al menú. La campana envía el aviso a ambos rivales.
- «Activar sonido» reproduce una muestra. Con el visor abierto, la alarma se repite mientras el jugador tenga llamados pendientes. Tocar cada mensaje lo confirma para ese jugador en todos sus dispositivos. La campana también funciona con la grilla en borrador. En segundo plano, el sonido y la vibración de la notificación dependen del sistema. Tocar la notificación abre el visor y confirma ese llamado.

## Publicación

En la grilla del organizador, cada jugador muestra «Pendiente» o «✓ Confirmó» para el último llamado de ese cruce. La consulta se actualiza cada cinco segundos. «Sin registro» identifica llamados antiguos cuyo estado no se puede reconstruir. El visor personal retira cada mensaje al tocarlo y conserva en pantalla los que todavía esperan confirmación.

Rodrigo puede sortear y probar los llamados en borrador. En la grilla del organizador, «Publicar grilla» habilita únicamente la categoría que está viendo. Al repetir el sorteo, esa categoría vuelve a borrador. Los llamados de mesa se entregan a ambos jugadores también durante las pruebas.

El visor busca al organizador activo con el slug exacto `rodry-baygo-torneos`, verificado en producción para Rodrigo Baygorria (ID 1). El backend admite una vinculación explícita mediante `TORNEO_VISOR_ORGANIZADOR_ID`.

Para push en navegadores compatibles:

1. Mantener `FIREBASE_SERVICE_ACCOUNT` del backend (ya utilizado por los avisos generales).
2. La configuración pública y la clave pública Web Push de la app web registrada están en `backend/src/torneoFirebaseWeb.json`.
3. Para usar otra aplicación, definir `FIREBASE_WEB_CONFIG` y `FIREBASE_WEB_VAPID_KEY` en el servicio. El proyecto debe coincidir con la cuenta de servicio.
4. El jugador pulsa Activar avisos y acepta el permiso. Usar HTTPS y habilitar la API de registro de FCM si el proyecto lo requiere.

## Límite de la APK actual

La app recibe el topic general `torneos` y expone `AndroidBridge.getInstallationId()`, pero no expone su token Firebase. Por eso **no es posible enviarle push personales con la app cerrada sin actualizarla**. No se envían datos de cruces personales al topic general. En la APK actual, los llamados personales se muestran en el visor abierto. En navegador, la entrega en segundo plano depende de compatibilidad, permisos y configuración Firebase.

La navegación del visor usa una carga normal desde Torneos, sin agregar estados al historial. En la APK actual `handleBackNavigation()` utiliza `WebView.goBack()` desde páginas nuevas y al regresar a Torneos vuelve al flujo nativo; en navegador conserva el historial normal. Esto se verificó por lectura del código Android; queda pendiente la prueba en un dispositivo.

## Validación

`node --test backend/test/torneosVisor*.test.js`

Pruebas con almacenamiento simulado, sin acceder a la base real ni enviar notificaciones: login válido/inexistente, autorización, privacidad del visor, bloqueo de escritura, llamado a ambos jugadores, separación de avisos, mesa/rango/revisión, WhatsApp y cierre de sesión. Pruebas geométricas para categorías y tamaños de grilla.

Las fotos de la grilla se sirven como imágenes WebP en direcciones firmadas por inscripción. Los nombres de archivo originales quedan en el servidor.
