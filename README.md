# Track Atlas

Visor personal de actividades de Strava: superponer y comparar rutas, «¿he pasado por aquí?», heatmap propio.

Nuxt 4 (modo SPA) + Nitro, SQLite nativo de Node 24 (`node:sqlite`), MapLibre GL.

## Desarrollo

```sh
docker compose up -d        # http://localhost:3210
docker compose logs -f
```

## Importar datos

1. Strava → Ajustes → Mi cuenta → *Descargar o eliminar tu cuenta* → «Solicitar archivo».
2. Sube el ZIP desde el botón **Importar**, o cópialo (ZIP o descomprimido) en `data/import/`
   y usa «importa desde la carpeta».

Reimportar es seguro y rápido: solo se procesan las actividades nuevas (opción para forzar todas). Las que no tienen GPS (rodillo, manuales) se omiten.

## Comparar con otros tracks

Pega una URL de Strava o suelta un GPX/TCX/FIT en el mapa: se marca qué parte ya has recorrido
y qué actividades tuyas coinciden más.

| URL | Cómo se obtiene |
|---|---|
| Actividad tuya ya importada | De la base de datos local |
| Ruta (`/routes/…`) o segmento (`/segments/…`) | API de Strava |
| Actividad tuya reciente | API de Strava |
| Actividad de otra persona | La API no lo permite: «Exportar GPX» en Strava y soltar el fichero |

Para usar la API: crea una app en https://www.strava.com/settings/api con
*Authorization Callback Domain* = `localhost` (y el dominio de producción), copia `.env.example`
a `.env` con el Client ID y Secret, `docker compose up -d` y pulsa «Conectar con Strava».

## Producción (Coolify)

`Dockerfile` con target `prod` (por defecto, último stage). Escucha en el puerto 3000.
Montar un volumen persistente en `/data` (base de datos SQLite e importaciones).
Variables: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`.

## Estructura

- `server/utils/importer.ts`: lectura del ZIP/carpeta de exportación y `activities.csv` (EN/ES)
- `server/utils/parsers.ts`: GPX / TCX / FIT (+ `.gz`)
- `server/utils/geo.ts`: remuestreo, simplificación, índice de celdas y distancias
- `server/utils/compare.ts`: cobertura de un track de referencia frente a mis actividades
- `server/utils/strava.ts`: OAuth y llamadas a la API de Strava
- `server/api/*`: actividades, trazas (`/api/tracks`, gzip + ETag), `near`, importación, referencia y comparación
- `app/`: mapa (`AtlasMap.vue`), lista, perfil de elevación, comparación, estilos por mapa base, importación

`npm run typecheck` comprueba tipos (app y servidor).
