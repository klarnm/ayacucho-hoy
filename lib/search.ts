import { XMLParser } from "fast-xml-parser";
import { CATEGORY_MAP, PRIORITY_LOCATIONS, SOCIAL_SOURCES, type CategoryId } from "./categories";

export interface ResultItem {
  id: string;
  title: string;
  summary: string;
  link: string;
  source: string;
  sourceType: "medio" | "facebook" | "x" | "instagram";
  categoryId: CategoryId;
  categoryLabel: string;
  publishedAt: string; // ISO
  imageUrl?: string;
  isVideo?: boolean;
}

const MAX_AGE_DAYS = 5;

// Grupo OR de localidades prioritarias, listo para insertar en una query de Google.
const locationGroup = PRIORITY_LOCATIONS.map((l) =>
  l.includes(" ") ? `"${l}"` : l
).join(" OR ");

function isRecent(dateStr: string): boolean {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const ageMs = Date.now() - d.getTime();
  return ageMs <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000 && ageMs >= 0;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

// Clasifica por dominio real del link, sin importar de qué búsqueda vino
// (Google News a veces indexa posts de redes sociales como si fueran "medio").
function detectSourceType(link: string): ResultItem["sourceType"] {
  try {
    const host = new URL(link).hostname.replace(/^www\./, "");
    if (host.endsWith("facebook.com")) return "facebook";
    if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com"))
      return "x";
    if (host.endsWith("instagram.com")) return "instagram";
  } catch {
    // link inválido: cae a "medio" por defecto
  }
  return "medio";
}

// --- Google News RSS: gratis, sin API key. Cubre medios/portales de noticias. ---
async function searchGoogleNews(
  categoryId: CategoryId,
  keyword: string
): Promise<ResultItem[]> {
  const q = encodeURIComponent(`${keyword} (${locationGroup})`);
  const url = `https://news.google.com/rss/search?q=${q}+when:5d&hl=es-419&gl=PE&ceid=PE:es-419`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      // Google News RSS cambia seguido; no cachear agresivo
      next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    const json = parser.parse(xml);
    const items = json?.rss?.channel?.item;
    const list = Array.isArray(items) ? items : items ? [items] : [];

    const category = CATEGORY_MAP[categoryId];
    return list
      .map((it: any, i: number): ResultItem | null => {
        const title = stripHtml(String(it.title ?? ""));
        const link = String(it.link ?? "");
        const pubDate = String(it.pubDate ?? "");
        const sourceName =
          (typeof it.source === "object" ? it.source["#text"] : it.source) ||
          "Medio local";
        if (!title || !link || !isRecent(pubDate)) return null;
        return {
          id: `${categoryId}-news-${keyword}-${i}-${link}`,
          title,
          summary: stripHtml(String(it.description ?? "")).slice(0, 220),
          link,
          source: sourceName,
          sourceType: detectSourceType(link),
          categoryId,
          categoryLabel: category.label,
          publishedAt: new Date(pubDate).toISOString(),
        };
      })
      .filter((x: ResultItem | null): x is ResultItem => x !== null);
  } catch {
    return [];
  }
}

// Extrae imagen/video del pagemap que Google Custom Search ya incluye por resultado (sin costo extra).
function extractMedia(it: any): { imageUrl?: string; isVideo?: boolean } {
  const pagemap = it.pagemap ?? {};
  const imageUrl: string | undefined =
    pagemap.cse_thumbnail?.[0]?.src ?? pagemap.cse_image?.[0]?.src;
  const isVideo = Boolean(pagemap.videoobject?.length);
  return { imageUrl, isVideo };
}

// --- Google Custom Search API: requiere API key + CX. Cubre redes sociales vía site: ---
// Una sola consulta por categoría (todas las keywords y las 3 redes combinadas con OR)
// para no agotar la cuota gratis de 100 consultas/día.
async function searchSocial(categoryId: CategoryId, keywords: string[]): Promise<ResultItem[]> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) return []; // silenciosamente omite si no está configurado

  const domains = SOCIAL_SOURCES.map((s) => `site:${s.domain}`).join(" OR ");
  const kw = keywords.map((k) => `"${k}"`).join(" OR ");
  const q = encodeURIComponent(`(${domains}) (${kw}) (${locationGroup})`);
  // Nota: NO usamos cr=countryPE aquí. Google clasifica facebook.com/x.com/
  // instagram.com como alojados en EE.UU., así que combinar site: (esos
  // dominios) con cr=countryPE (país=Perú) nunca se cumple a la vez y da 0
  // resultados. El filtro de país solo aplica a medios locales (Google News).
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${q}&dateRestrict=d5&num=10`;

  try {
    // Cache de 3h: con 10 categorías, como máximo 10 consultas nuevas cada 3h
    // (80/día) sin importar cuántas visitas reciba la página — nunca se pasa
    // de las 100 consultas/día gratis de Google, sin importar el tráfico.
    const res = await fetch(url, { next: { revalidate: 60 * 60 * 3 } });
    if (!res.ok) return [];
    const json = await res.json();
    const items = json.items ?? [];
    const category = CATEGORY_MAP[categoryId];

    return items
      .map((it: any, i: number): ResultItem | null => {
        const sourceType = detectSourceType(it.link ?? "");
        if (sourceType === "medio") return null; // no era ninguna de las 3 redes
        const { imageUrl, isVideo } = extractMedia(it);
        return {
          id: `${categoryId}-${sourceType}-${i}-${it.link}`,
          title: it.title ?? "",
          summary: (it.snippet ?? "").slice(0, 220),
          link: it.link,
          source: SOCIAL_SOURCES.find((s) => s.id === sourceType)?.label ?? sourceType,
          sourceType,
          categoryId,
          categoryLabel: category.label,
          // Google CSE no siempre da fecha exacta; usamos "ahora" como aproximación
          // dentro de la ventana de 5 días que ya filtra dateRestrict.
          publishedAt: new Date().toISOString(),
          imageUrl,
          isVideo,
        };
      })
      .filter((x: ResultItem | null): x is ResultItem => x !== null);
  } catch {
    return [];
  }
}

/**
 * Genera todas las tareas de búsqueda para las categorías pedidas: una por
 * keyword para medios (Google News, gratis) y una sola por categoría para
 * redes sociales (Custom Search, cuota limitada). El caller puede ir
 * consumiendo conforme resuelven (usar Promise con .then individual, no
 * Promise.all, para lograr streaming real).
 */
export function buildSearchTasks(categoryIds: CategoryId[]): Promise<ResultItem[]>[] {
  const tasks: Promise<ResultItem[]>[] = [];

  for (const categoryId of categoryIds) {
    const category = CATEGORY_MAP[categoryId];
    for (const keyword of category.keywords) {
      tasks.push(searchGoogleNews(categoryId, keyword));
    }
    tasks.push(searchSocial(categoryId, category.keywords));
  }
  return tasks;
}
