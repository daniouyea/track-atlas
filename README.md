# Track Atlas

Visor de actividades de Strava: superponer y comparar rutas, «¿he pasado por aquí?», heatmap propio.
Multiusuario con login de Strava: cada usuario solo ve sus datos.

Nuxt 4 (modo SPA) + Nitro, SQLite nativo de Node 24 (`node:sqlite`), MapLibre GL.

## Desarrollo

Necesita una app de API de Strava para el login: créala en https://www.strava.com/settings/api con
*Authorization Callback Domain* = `localhost`, y copia `.env.example` a `.env` con el Client ID y Secret.

```sh
docker compose up -d        # http://localhost:3210
docker compose logs -f
```

`docker-compose.yml` es la configuración de **producción**; en local Docker Compose le añade
automáticamente `docker-compose.override.yml` (target `dev`, código montado, puerto 3210, `./data`).

## Importar datos

1. Strava → Ajustes → Mi cuenta → *Descargar o eliminar tu cuenta* → «Solicitar archivo».
2. Elige el ZIP desde el botón **Importar**. El navegador lo abre (zip.js) y solo sube
   `activities.csv` y las actividades que faltan, comprimidas con gzip y en tandas de ≤ 20 MB:
   Cloudflare corta las peticiones de más de 100 MB y el export trae fotos que no hacen falta.
   Alternativa en el servidor: copiarlo en `data/import/<id de atleta>/` y «importa desde la carpeta».

Reimportar es seguro y rápido: solo se procesan las actividades nuevas (opción para forzar todas). Las que no tienen GPS (rodillo, manuales) se omiten.

## Sincronización con Strava

- Al abrir la app se traen las actividades nuevas (`POST /api/strava/sync`). Un usuario sin actividades
  recibe las 50 más recientes; para el resto, el ZIP (rápido) o la descarga del historial.
- Descarga del historial en segundo plano (`server/plugins/stravaBackfill.ts`, cada minuto): recorre de la
  más reciente a la más antigua mientras quede cupo. El cupo de la API (lectura: 400 / 15 min, 4000 / día)
  es **de la aplicación**, compartido entre usuarios: se lee de las cabeceras `X-ReadRateLimit-*` y el
  historial deja libre un 30 % para la sincronización interactiva.
- Actividades sin GPS (rodillo, manuales) se recuerdan en `strava_skips` para no volver a pedirlas.

## Heatmap global de Strava

Mapa base «Heatmap global de Strava»: teselas públicas de Strava (bici, hasta zoom 12) sobre el mapa oscuro.
No traen CORS, así que pasan por `/api/heatmap/{z}/{x}/{y}` (solo con sesión). Más zoom exige las cookies
de una sesión de strava.com: no implementado.

## Comparar con otros tracks

Pega una URL de Strava o suelta un GPX/TCX/FIT en el mapa: se marca qué parte ya has recorrido
y qué actividades tuyas coinciden más.

| URL | Cómo se obtiene |
|---|---|
| Actividad tuya ya importada | De la base de datos local |
| Ruta (`/routes/…`) o segmento (`/segments/…`) | API de Strava (token del usuario) |
| Actividad tuya reciente | API de Strava |
| Actividad de otra persona | La API no lo permite: «Exportar GPX» en Strava y soltar el fichero |

## Usuarios

- Login con OAuth de Strava; sesión en cookie cifrada (`SESSION_SECRET`).
- Todas las tablas llevan `user_id` (id de atleta) y toda la API filtra por él (`server/middleware/auth.ts`).
- Migración desde la versión de un solo usuario: se hace copia `data/atlas.v0-backup-*.sqlite` y los datos
  existentes pasan al **primer usuario que inicia sesión**.
- `STRAVA_BASE_URL` permite apuntar a un Strava simulado para pruebas.

## Producción (Coolify)

Build pack *Docker Compose* con `docker-compose.yml` (Coolify ignora el override de desarrollo):
target `prod`, puerto 3000, volumen persistente `atlas-data` en `/data` y healthcheck.
Variables: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `SESSION_SECRET`. En la app de Strava,
*Authorization Callback Domain* = el dominio de producción (`localhost` ya está permitido siempre).

## Estructura

- `server/utils/importer.ts`: lectura del ZIP/carpeta de exportación y `activities.csv` (EN/ES)
- `server/utils/parsers.ts`: GPX / TCX / FIT (+ `.gz`)
- `server/utils/geo.ts`: remuestreo, simplificación, índice de celdas y distancias
- `server/utils/compare.ts`: cobertura de un track de referencia frente a mis actividades
- `server/utils/strava.ts`: OAuth y llamadas a la API de Strava
- `server/utils/auth.ts`, `server/middleware/auth.ts`, `server/api/auth/*`: login, sesión y usuarios
- `server/api/*`: actividades, trazas (`/api/tracks`, gzip + ETag), `near`, importación, referencia y comparación
- `app/`: mapa (`AtlasMap.vue`), lista, perfil de elevación, comparación, estilos por mapa base, importación

`npm run typecheck` comprueba tipos (app y servidor).
