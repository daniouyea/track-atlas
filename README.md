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

## Producción (Coolify)

`Dockerfile` con target `prod` (por defecto, último stage). Escucha en el puerto 3000.
Montar un volumen persistente en `/data` (base de datos SQLite e importaciones).

## Estructura

- `server/utils/importer.ts`: lectura del ZIP/carpeta de exportación y `activities.csv` (EN/ES)
- `server/utils/parsers.ts`: GPX / TCX / FIT (+ `.gz`)
- `server/utils/geo.ts`: remuestreo, simplificación, índice de celdas y distancias
- `server/api/*`: actividades, trazas (`/api/tracks`, gzip + ETag), `near`, importación
- `app/`: mapa (`AtlasMap.vue`), lista, perfil de elevación, importación
