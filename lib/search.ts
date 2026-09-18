import { XMLParser } from "fast-xml-parser";
import {
  AMBIGUOUS_LOCATIONS,
  CATEGORY_MAP,
  COUNTRY_EXCLUSIONS,
  KNOWN_SOCIAL_PAGES,
  KNOWN_SOCIAL_SOURCES,
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

// Nombre de organizaciones conocidas (ver KNOWN_SOCIAL_SOURCES): cuenta como
// alternativa a mencionar una ubicación, porque Google indexa mucho mejor
// una página de Facebook específica que ya conoce que una búsqueda genérica
// por keyword+ubicación sobre todo el dominio.
const knownSourcesGroup = KNOWN_SOCIAL_SOURCES.map((s) => `"${s}"`).join(" OR ");
const socialLocationGroup = knownSourcesGroup
  ? `${locationGroup} OR ${knownSourcesGroup}`
  : locationGroup;

// Páginas/grupos de Facebook conocidos (ver KNOWN_SOCIAL_PAGES): al tener la
// URL exacta, se buscan con site:facebook.com/<slug> en vez de depender de
// keyword+ubicación — son fuentes locales ya vetadas, así que cualquier post
// reciente de ellas cuenta, no solo los que mencionan una ubicación puntual.
const knownPagesGroup = KNOWN_SOCIAL_PAGES.map((slug) => `site:facebook.com/${slug}`).join(
  " OR "
);

function isFromKnownPage(link: string): boolean {
  try {
    const url = new URL(link);
    if (!url.hostname.replace(/^www\./, "").endsWith("facebook.com")) return false;
    const path = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    return KNOWN_SOCIAL_PAGES.some((slug) => path === slug || path.startsWith(`${slug}/`));
  } catch {
    return false;
  }
}

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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Busca `term` (ya normalizado o no) dentro de `normText` (ya normalizado)
// respetando límites de palabra, para que un término corto como "mina" o
// "robo" no matchee adentro de "eliminado", "terminó" o "aprobó". Las
// frases de varias palabras usan substring normal — chocar de casualidad
// con una frase de varias palabras es prácticamente imposible.
function includesTerm(normText: string, term: string): boolean {
  const normTerm = normalize(term);
  if (normTerm.includes(" ")) return normText.includes(normTerm);
  return new RegExp(`\\b${escapeRegExp(normTerm)}\\b`).test(normText);
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
    if (!includesTerm(normText, loc)) return false;
    if (AMBIGUOUS_LOCATIONS.includes(loc)) return normText.includes(NORM_AYACUCHO);
    return true;
  });
}

// Igual que mentionsAyacuchoOrVraem pero para organizaciones conocidas (ver
// KNOWN_SOCIAL_SOURCES): un post de una de estas páginas cuenta como
// relevante aunque el snippet truncado de Google no llegue a mencionar
// explícitamente una ubicación.
function mentionsKnownSource(text: string): boolean {
  const normText = normalize(text);
  return KNOWN_SOCIAL_SOURCES.some((s) => includesTerm(normText, s));
}

// Se descarta si el texto nombra explícitamente otro país, aunque también
// mencione Ayacucho/VRAEM: hay lugares homónimos en el extranjero (avenida
// "Gran Mariscal de Ayacucho" en Caracas, partido de Ayacucho en Buenos
// Aires, estado Sucre en Venezuela) que un dominio genérico no delata.
function mentionsForeignCountry(text: string): boolean {
  const normText = normalize(text);
  return COUNTRY_EXCLUSIONS.some((c) => includesTerm(normText, c));
}

function mentionsPeru(text: string): boolean {
  const normText = normalize(text);
  return includesTerm(normText, "Peru") || includesTerm(normText, "Perú");
}

// Dominio peruano (.pe): confiamos en que "Ayacucho" a secas basta, porque
// ya sabemos que el medio es de Perú.
//
// Dominios genéricos que también se tratan como confiables aunque no sean
// .pe: medios grandes reales que sí cubren Perú/Ayacucho de verdad. Sin
// esto, exigir "Perú" en el texto para todo dominio no-.pe filtraba ~1 de
// cada 4 resultados legítimos de Infobae (probado en vivo) para evitar un
// puñado de falsos positivos raros — mal negocio. Solo los dominios
// genéricos que NO están en esta lista (los realmente desconocidos) quedan
// bajo el requisito estricto de que el texto diga "Perú".
const TRUSTED_GENERIC_DOMAINS = ["infobae.com"];

function isTrustedPeruDomain(link: string): boolean {
  try {
    const host = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
    return host.endsWith(".pe") || TRUSTED_GENERIC_DOMAINS.includes(host);
  } catch {
    return false;
  }
}

// trustedDomain=true (medio .pe, o ya viene de una fuente vetada) confía en
// que "Ayacucho" a secas basta. Si no, "Ayacucho" es más ambiguo de lo que
// parece: es nombre de calle en casi toda ciudad argentina y aparece en
// planes militares venezolanos (por la misma batalla), sin que el texto
// diga el país — así que para dominios genéricos exigimos además que el
// texto confirme "Perú" explícitamente.
function isAboutAyacucho(text: string, trustedDomain: boolean): boolean {
  if (mentionsForeignCountry(text)) return false;
  if (!mentionsAyacuchoOrVraem(text) && !mentionsKnownSource(text)) return false;
  return trustedDomain || mentionsPeru(text);
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
          !isAboutAyacucho(`${title} ${fullSummary}`, isTrustedPeruDomain(sourceUrl))
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

// Cache propio en memoria por query (ver el mismo cache de Bright Data más
// abajo para el porqué: next:{revalidate} no estaba evitando llamadas
// repetidas en la práctica).
const googleCseCache = new Map<string, { items: ResultItem[]; fetchedAt: number }>();
const GOOGLE_CSE_CACHE_MS = 60 * 60 * 3 * 1000; // 3h

// --- Google Custom Search API: requiere API key + CX. Cubre redes sociales vía site: ---
// Una sola consulta por categoría (todas las keywords y las 3 redes combinadas con OR)
// para no agotar la cuota gratis de 100 consultas/día.
async function searchSocial(categoryId: CategoryId, keywords: string[]): Promise<ResultItem[]> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) return []; // silenciosamente omite si no está configurado

  const domains = SOCIAL_SOURCES.map((s) => `site:${s.domain}`).join(" OR ");
  const kw = keywords.map((k) => `"${k}"`).join(" OR ");
  // Un post cuenta si viene de cualquier red social Y menciona una ubicación
  // válida, O si viene de una de nuestras páginas ya vetadas (KNOWN_SOCIAL_PAGES) —
  // estas últimas no necesitan mencionar ubicación porque ya son fuentes
  // locales de Ayacucho.
  const sourceGroup = knownPagesGroup
    ? `((${domains}) (${socialLocationGroup})) OR (${knownPagesGroup})`
    : `(${domains}) (${socialLocationGroup})`;
  const q = encodeURIComponent(`(${kw}) (${sourceGroup}) ${exclusionGroup}`);
  // Nota: NO usamos cr=countryPE aquí. Google clasifica facebook.com/x.com/
  // instagram.com como alojados en EE.UU., así que combinar site: (esos
  // dominios) con cr=countryPE (país=Perú) nunca se cumple a la vez y da 0
  // resultados. El filtro de país solo aplica a medios locales (Google News).
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${q}&dateRestrict=d5&num=10`;

  // Cache de 3h por query: con 10 categorías, como máximo 10 consultas
  // nuevas cada 3h (80/día) sin importar cuántas visitas reciba la página —
  // nunca se pasa de las 100 consultas/día gratis de Google.
  const cached = googleCseCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < GOOGLE_CSE_CACHE_MS) {
    return cached.items;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const items = json.items ?? [];
    const category = CATEGORY_MAP[categoryId];

    const results = items
      .map((it: any, i: number): ResultItem | null => {
        const sourceType = detectSourceType(it.link ?? "");
        if (sourceType === "medio") return null; // no era ninguna de las 3 redes
        const title = it.title ?? "";
        const snippet = it.snippet ?? "";
        // Las redes sociales nunca son dominio .pe, así que trustedDomain va
        // en false: si no viene de una página vetada, hace falta que el
        // texto confirme "Perú" además de la ubicación.
        if (!isFromKnownPage(it.link ?? "") && !isAboutAyacucho(`${title} ${snippet}`, false)) return null;
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
    googleCseCache.set(url, { items: results, fetchedAt: Date.now() });
    return results;
  } catch {
    return [];
  }
}

// --- Bright Data: API paga con 5,000 créditos gratis/mes. Trae los posts
// reales de nuestras páginas de Facebook ya vetadas (KNOWN_SOCIAL_PAGES),
// sin depender de que Google las haya indexado. Requiere BRIGHTDATA_API_TOKEN. ---
const BRIGHTDATA_DATASET_ID = "gd_lkaxegm826bjpoo9m5"; // Facebook - Pages Posts by Profile URL

// Este dataset de Bright Data es solo para páginas/perfiles, no grupos — los
// "groups/..." de KNOWN_SOCIAL_PAGES quedan fuera hasta que conectemos el
// dataset específico de grupos.
const BRIGHTDATA_PAGE_SLUGS = KNOWN_SOCIAL_PAGES.filter((slug) => !slug.startsWith("groups/"));

// fetch() sin límite propio puede quedarse esperando para siempre si hay un
// problema de red puntual — pasó en vivo: el poll de abajo revisa el reloj
// ANTES de cada intento, pero un fetch ya colgado nunca deja que ese chequeo
// se repita. Con AbortController, cada llamada individual tiene su propio
// tope y el loop puede seguir aunque un intento se cuelgue.
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Bright Data no siempre responde rápido: medido en vivo con las 9 páginas
// reales, el trigger responde {snapshot_id} a los ~61s (es el propio límite
// interno de Bright Data para intentar responder sincrónico), y el scrape
// completo termina ~132s después de empezar (45 posts, 0 errores). Este
// poll espera hasta 200s en total antes de rendirse (falla silenciosa,
// igual que el resto de las fuentes) — coordinado con maxDuration en
// app/api/search/route.ts.
async function pollBrightDataSnapshot(snapshotId: string, token: string): Promise<any[]> {
  const deadline = Date.now() + 200_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetchWithTimeout(
        `https://api.brightdata.com/datasets/v3/progress/${snapshotId}`,
        { headers: { Authorization: `Bearer ${token}` } },
        15_000
      );
      if (!res.ok) return [];
      const status = await res.json();
      if (status.status === "ready") {
        const dataRes = await fetchWithTimeout(
          `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
          { headers: { Authorization: `Bearer ${token}` } },
          30_000
        );
        if (!dataRes.ok) return [];
        const posts = await dataRes.json();
        return Array.isArray(posts) ? posts : [];
      }
      if (status.status === "failed") return [];
    } catch {
      // timeout o error de red puntual en este intento: se reintenta en la
      // siguiente vuelta del loop, mientras siga dentro del deadline.
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return [];
}

// Se llama UNA sola vez por carga de página (no una vez por categoría) para
// no multiplicar el gasto de créditos: 9 páginas x 5 posts x 2 veces/día x 30
// días ≈ 2,700 registros/mes, dentro del límite gratis de 5,000.
//
// Cache de 3h, igual que searchSocial (Google CSE): dentro de esa ventana,
// esta misma llamada devuelve el {snapshot_id} ya cacheado (que a esas
// alturas ya está "ready"), así que el poll de arriba resuelve casi
// instantáneo. Solo la primera vez, o justo cuando el cache vence, puede
// tardar los ~50s completos.
//
// Cache propio en memoria: probado en vivo (dev Y build de producción local)
// que next:{revalidate} de Next.js NO estaba evitando una llamada nueva a
// Bright Data en cada request — dos cargas seguidas tardaron casi lo mismo
// (95s vs 103s), cuando la segunda debía ser instantánea. En vez de
// depender de ese mecanismo, guardamos el resultado en una variable del
// módulo con su propia marca de tiempo: mientras el proceso del servidor
// siga vivo (mismo warm start en Vercel, o el mismo proceso en local),
// cualquier request dentro de las 3h siguientes reusa esto sin llamar a
// Bright Data. No es un cache compartido entre instancias distintas de
// Vercel bajo mucho tráfico, pero es mucho más confiable que lo que
// probamos, y es exactamente lo que evita el "F5 = esperar de nuevo".
let brightDataCache: { posts: any[]; fetchedAt: number } | null = null;
const BRIGHTDATA_CACHE_MS = 60 * 60 * 3 * 1000; // 3h

async function fetchBrightDataPosts(): Promise<any[]> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token || BRIGHTDATA_PAGE_SLUGS.length === 0) return [];

  if (brightDataCache && Date.now() - brightDataCache.fetchedAt < BRIGHTDATA_CACHE_MS) {
    return brightDataCache.posts;
  }

  const input = BRIGHTDATA_PAGE_SLUGS.map((slug) => ({
    url: `https://www.facebook.com/${slug}/`,
    num_of_posts: 5,
  }));
  const url = `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${BRIGHTDATA_DATASET_ID}&notify=false&include_errors=true`;

  try {
    // Medido en vivo: Bright Data espera hasta ~61s antes de rendirse y
    // devolver {snapshot_id} en vez de los posts directo — es su propio
    // límite interno, no el nuestro. 60s de timeout propio competía contra
    // eso y a veces lo mataba justo antes de que respondiera. 90s da margen
    // real por encima de ese umbral.
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
      },
      90_000
    );
    if (!res.ok) return [];
    const body = await res.json();
    const posts: any[] = Array.isArray(body)
      ? body
      : body?.snapshot_id
      ? await pollBrightDataSnapshot(body.snapshot_id, token)
      : [];
    if (posts.length > 0) brightDataCache = { posts, fetchedAt: Date.now() };
    return posts;
  } catch {
    return [];
  }
}

// Filtra los posts ya traídos de Bright Data por las keywords de una
// categoría. No pasa por isAboutAyacucho: estas páginas ya son fuentes
// vetadas de Ayacucho (igual que KNOWN_SOCIAL_PAGES en searchSocial), así
// que un post suyo cuenta con que mencione la keyword de la categoría.
function matchBrightDataPosts(
  posts: any[],
  categoryId: CategoryId,
  keywords: string[]
): ResultItem[] {
  const category = CATEGORY_MAP[categoryId];
  return posts
    .map((post: any): ResultItem | null => {
      const content: string = post.content ?? "";
      if (!content) return null;
      const normContent = normalize(content);
      if (!keywords.some((k) => includesTerm(normContent, k))) return null;
      const publishedAt = post.date_posted
        ? new Date(post.date_posted).toISOString()
        : new Date().toISOString();
      if (!isRecent(publishedAt)) return null;
      const attachment = Array.isArray(post.attachments) ? post.attachments[0] : undefined;
      const postId = String(post.post_id ?? post.url ?? "");
      return {
        id: `${categoryId}-facebook-bd-${postId}`,
        title: content.slice(0, 100),
        summary: content.slice(0, 220),
        link: String(post.url ?? post.page_url ?? ""),
        source: post.page_name ?? "Facebook",
        sourceType: "facebook",
        categoryId,
        categoryLabel: category.label,
        publishedAt,
        imageUrl: post.post_image ?? attachment?.url,
        isVideo: post.post_type === "Video" || attachment?.type === "Video",
      };
    })
    .filter((x: ResultItem | null): x is ResultItem => x !== null);
}

/**
 * Genera todas las tareas de búsqueda para las categorías pedidas: una por
 * keyword para medios (Google News, gratis), una sola por categoría para
 * redes sociales (Custom Search, cuota limitada), y los posts de Bright Data
 * (traídos una sola vez y repartidos por categoría). El caller puede ir
 * consumiendo conforme resuelven (usar Promise con .then individual, no
 * Promise.all, para lograr streaming real).
 */
export function buildSearchTasks(categoryIds: CategoryId[]): Promise<ResultItem[]>[] {
  const tasks: Promise<ResultItem[]>[] = [];
  const brightDataPosts = fetchBrightDataPosts();

  for (const categoryId of categoryIds) {
    const category = CATEGORY_MAP[categoryId];
    for (const keyword of category.keywords) {
      tasks.push(searchGoogleNews(categoryId, keyword));
    }
    tasks.push(searchSocial(categoryId, category.keywords));
    tasks.push(brightDataPosts.then((posts) => matchBrightDataPosts(posts, categoryId, category.keywords)));
  }
  return tasks;
}
