import { XMLParser } from "fast-xml-parser";
import {
  AMBIGUOUS_LOCATIONS,
  CATEGORY_MAP,
  COUNTRY_EXCLUSIONS,
  PRIORITY_LOCATIONS,
  SOCIAL_SOURCES,
  type CategoryId,
} from "./categories";

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
// Las localidades ambiguas (ver AMBIGUOUS_LOCATIONS) no entran solas: se
// exige que aparezcan junto con "Ayacucho" para contar como válidas.
const locationGroup = [
  ...PRIORITY_LOCATIONS.filter((l) => !AMBIGUOUS_LOCATIONS.includes(l)).map((l) =>
    l.includes(" ") ? `"${l}"` : l
  ),
  ...AMBIGUOUS_LOCATIONS.map((l) => `(${l.includes(" ") ? `"${l}"` : l} Ayacucho)`),
].join(" OR ");

// Operador "-" de Google: resta países ambiguos (ver COUNTRY_EXCLUSIONS) de
// todas las búsquedas, para no confundir localidades de Ayacucho con lugares
// del extranjero que se llaman igual.
const exclusionGroup = COUNTRY_EXCLUSIONS.map((c) => `-${c}`).join(" ");

function isRecent(dateStr: string): boolean {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const ageMs = Date.now() - d.getTime();
  return ageMs <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000 && ageMs >= 0;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

// TLDs de otros países. Un resultado cuyo dominio termine en uno de estos se
// descarta siempre, sin importar qué diga el texto — el filtro de palabras
// (AMBIGUOUS_LOCATIONS, COUNTRY_EXCLUSIONS) puede fallar por lo difuso que es
// el buscador de Google, pero el dominio del medio no miente sobre su país.
// No incluye TLDs genéricos (.com, .info, etc.) porque medios peruanos como
// infobae.com/peru o larepublica.pe conviven ahí con dominios de EE. UU.
const FOREIGN_TLDS = [
  ".ec", // Ecuador
  ".ve", // Venezuela
  ".co", // Colombia
  ".cl", // Chile
  ".ar", // Argentina
  ".mx", // México
  ".bo", // Bolivia
  ".py", // Paraguay
  ".uy", // Uruguay
  ".es", // España
  ".cu", // Cuba
  ".ni", // Nicaragua
  ".hn", // Honduras
  ".gt", // Guatemala
  ".sv", // El Salvador
  ".cr", // Costa Rica
  ".pa", // Panamá
  ".do", // Rep. Dominicana
];

function isForeignDomain(link: string): boolean {
  try {
    const host = new URL(link).hostname.toLowerCase();
    return FOREIGN_TLDS.some((tld) => host.endsWith(tld));
  } catch {
    return false;
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // quita tildes
}

const NORM_AYACUCHO = normalize("Ayacucho");

// Filtro de contenido propio: aparte de lo que Google decida que es
// relevante (su búsqueda es difusa y a veces trae resultados de otros
// países aunque la query los excluya), verificamos nosotros mismos que el
// título + resumen realmente mencionen Ayacucho, el VRAEM, o alguna de sus
// provincias/distritos. Las localidades ambiguas (AMBIGUOUS_LOCATIONS) solo
// cuentan si además aparece "Ayacucho" en el texto.
function mentionsAyacuchoOrVraem(text: string): boolean {
  const normText = normalize(text);
  return PRIORITY_LOCATIONS.some((loc) => {
    const normLoc = normalize(loc);
    if (!normText.includes(normLoc)) return false;
    if (AMBIGUOUS_LOCATIONS.includes(loc)) return normText.includes(NORM_AYACUCHO);
    return true;
  });
}

// Se descarta si el texto nombra explícitamente otro país, aunque también
// mencione Ayacucho/VRAEM: hay lugares homónimos en el extranjero (avenida
// "Gran Mariscal de Ayacucho" en Caracas, partido de Ayacucho en Buenos
// Aires, estado Sucre en Venezuela) que un dominio genérico no delata.
function mentionsForeignCountry(text: string): boolean {
  const normText = normalize(text);
  return COUNTRY_EXCLUSIONS.some((c) => normText.includes(normalize(c)));
}

function isAboutAyacucho(text: string): boolean {
  return mentionsAyacuchoOrVraem(text) && !mentionsForeignCountry(text);
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
  const q = encodeURIComponent(`${keyword} (${locationGroup}) ${exclusionGroup}`);
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
        // "link" es siempre un redirect de news.google.com, no sirve para
        // saber el país/dominio real del medio. El dominio real viene en el
        // atributo url de <source>.
        const link = String(it.link ?? "");
        const sourceUrl = typeof it.source === "object" ? String(it.source["@_url"] ?? "") : "";
        const pubDate = String(it.pubDate ?? "");
        const sourceName =
          (typeof it.source === "object" ? it.source["#text"] : it.source) ||
          "Medio local";
        const fullSummary = stripHtml(String(it.description ?? ""));
        if (
          !title ||
          !link ||
          !isRecent(pubDate) ||
          isForeignDomain(sourceUrl) ||
          !isAboutAyacucho(`${title} ${fullSummary}`)
        )
          return null;
        return {
          id: `${categoryId}-news-${keyword}-${i}-${link}`,
          title,
          summary: fullSummary.slice(0, 220),
          link,
          source: sourceName,
          sourceType: detectSourceType(sourceUrl || link),
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
  const q = encodeURIComponent(`(${domains}) (${kw}) (${locationGroup}) ${exclusionGroup}`);
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
        const title = it.title ?? "";
        const snippet = it.snippet ?? "";
        if (!isAboutAyacucho(`${title} ${snippet}`)) return null;
        const { imageUrl, isVideo } = extractMedia(it);
        return {
          id: `${categoryId}-${sourceType}-${i}-${it.link}`,
          title,
          summary: snippet.slice(0, 220),
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
