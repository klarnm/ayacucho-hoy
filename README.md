# Ayacucho Hoy

Buscador de acontecimientos locales en Ayacucho. Sin base de datos: cada vez
que se abre la página, busca en vivo en internet y va mostrando resultados
conforme llegan (streaming).

## Qué hace ahora mismo

- **Noticias de medios**: Google News RSS, gratis, sin API key. Funciona
  desde el primer `npm run dev`.
- **Redes sociales (Facebook, X, Instagram)**: Google Custom Search API.
  Requiere una API key gratuita de Google (ver `.env.example`). Si no la
  configuras, la app simplemente no muestra esos resultados — no se rompe.
- **Facebook de fuentes vetadas**: Bright Data trae directo los posts de las
  páginas de Facebook en `KNOWN_SOCIAL_PAGES` (lib/categories.ts), sin
  depender de que Google las haya indexado — Google indexa muy mal Facebook.
  Requiere `BRIGHTDATA_API_TOKEN` (ver más abajo). Sin ella, simplemente no
  aporta estos resultados extra.
- **10 categorías**: corrupción, tráfico de drogas, terrorismo, crimen
  organizado, minería ilegal, medidas contra el Estado, medidas de fuerza,
  contaminación ambiental, incendios forestales, delincuencia.
- **Filtro de 5 días**: se descarta todo lo más viejo.
- **Streaming real**: los resultados aparecen uno por uno (Server-Sent
  Events), no hay que esperar a que todas las búsquedas terminen.

## Correr en local

```bash
npm install
cp .env.example .env.local   # opcional, solo si quieres redes sociales
npm run dev
```

Abre http://localhost:3000

## Configurar Google Custom Search (opcional, para redes sociales)

Instrucciones detalladas dentro de `.env.example`. Resumen:

1. API key en Google Cloud Console (activa "Custom Search API").
2. Motor de búsqueda en programmablesearchengine.google.com.
3. Pega ambos valores en `.env.local`.

El plan gratis da 100 búsquedas/día. Con 10 categorías × ~4 keywords ×
3 redes sociales, cada carga de página completa (modo "Todos") puede gastar
~120 búsquedas — se acaba la cuota gratis rápido. Para producción real,
conviene:
- Dejar que el usuario filtre por categoría (no cargar "Todos" por defecto), o
- Cachear resultados por categoría unos minutos (ej. con Redis o `revalidate`), o
- Subir a un plan de pago de Google ($5 por 1000 queries).

## Configurar Bright Data (opcional, para posts reales de Facebook)

1. Cuenta gratis en [brightdata.com](https://brightdata.com) — da 5,000
   créditos/mes gratis, sin tarjeta.
2. En Scrapers Library, activa "Facebook - Pages Posts by Profile URL".
3. Copia tu API key (Account settings) y ponla en `.env.local` como
   `BRIGHTDATA_API_TOKEN`.
4. **Rota la key si alguna vez la compartiste en texto plano** (captura,
   chat, etc.) — Bright Data permite generar una nueva sin perder la cuenta.

Con las páginas de `KNOWN_SOCIAL_PAGES` (9 páginas, 5 posts c/u, refrescando
cada 12h) el gasto es de ~2,700 créditos/mes — dentro del plan gratis. Si
agregas más páginas a esa lista, vigila el consumo en el dashboard de Bright
Data. Los "groups/..." de esa lista no aplican aquí (necesitan el dataset de
grupos, no el de páginas).

## Deploy en Vercel

1. Sube este proyecto a un repo de GitHub.
2. Entra a vercel.com → "Add New Project" → importa el repo.
3. En "Environment Variables" agrega `GOOGLE_CSE_API_KEY`, `GOOGLE_CSE_CX`
   y `BRIGHTDATA_API_TOKEN` (los que vayas a usar).
4. Deploy. Listo — el plan gratis (Hobby) alcanza para empezar.

## Ver quién usa la app / bloquear IPs

Como se conversó: activa **Vercel Analytics** (gratis, un toggle) para ver
visitas y de dónde vienen. Para bloquear IPs o países puntuales, pon el
dominio detrás de **Cloudflare** (plan Free) — ahí sí tienes reglas de
firewall por IP/país sin costo.

## Siguiente paso natural

- Ajustar `dateRestrict`/`when:5d` si Google cambia el formato de sus
  parámetros (pasa de vez en cuando).
- Si el volumen de tráfico crece, mover el streaming a un caché corto
  (ej. Redis con TTL de 5-10 min) para no gastar cuota de API en cada
  visita — actualmente CADA carga de página dispara todas las búsquedas
  de nuevo.
