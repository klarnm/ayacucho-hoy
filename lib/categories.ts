export type CategoryId =
  | "corrupcion"
  | "drogas"
  | "terrorismo"
  | "crimen"
  | "mineria"
  | "contra-estado"
  | "fuerza"
  | "ambiental"
  | "incendios"
  | "delincuencia"
  | "hidrocarburos";

export interface Category {
  id: CategoryId;
  label: string;
  // Palabras clave que se combinan (OR) para armar la query de búsqueda.
  keywords: string[];
}

export const CATEGORIES: Category[] = [
  {
    id: "corrupcion",
    label: "Corrupción",
    keywords: ["corrupción", "coima", "malversación", "peculado", "denuncia fiscal"],
  },
  {
    id: "drogas",
    label: "Tráfico de drogas",
    keywords: [
      "narcotráfico",
      "decomiso droga",
      "laboratorio clandestino",
      "PNP incauta droga",
      "droga",
      "marihuana",
      "insumos químicos",
    ],
  },
  {
    id: "terrorismo",
    label: "Terrorismo",
    keywords: ["Sendero Luminoso", "remanentes terroristas", "atentado VRAEM", "ANFASEP"],
  },
  {
    id: "crimen",
    label: "Crimen organizado",
    keywords: [
      "banda criminal",
      "organización delictiva",
      "extorsión",
      "sicariato",
      "asesinato",
      "detención",
      "enfrentamiento",
      "explosivos",
      "muertos",
      "heridos",
    ],
  },
  {
    id: "mineria",
    label: "Minería ilegal",
    keywords: [
      "minería ilegal",
      "minería informal",
      "interdicción minera",
      "dragas mineras",
      "mina",
    ],
  },
  {
    id: "contra-estado",
    label: "Medidas contra el Estado",
    keywords: [
      "protesta",
      "marcha",
      "bloqueo de vías",
      "enfrentamiento con policía",
      "manifestación",
      "movilización",
      "frente de defensa",
      "ASFAH",
    ],
  },
  {
    id: "fuerza",
    label: "Medidas de fuerza",
    keywords: ["huelga", "paro", "plantón", "toma de local", "gremio"],
  },
  {
    id: "ambiental",
    label: "Contaminación ambiental",
    keywords: [
      "derrame",
      "relave minero",
      "contaminación río",
      "denuncia ambiental",
      "huayco",
      "desastre natural",
    ],
  },
  {
    id: "incendios",
    label: "Incendios forestales",
    keywords: ["incendio forestal", "quema de pastizales", "brigada forestal", "incendio"],
  },
  {
    id: "delincuencia",
    label: "Delincuencia",
    keywords: ["robo", "asalto", "hurto", "ola de delincuencia"],
  },
  {
    id: "hidrocarburos",
    label: "Hidrocarburos y comunidades nativas",
    keywords: [
      "TGP",
      "Pluspetrol",
      "Megantoni",
      "comunidad nativa",
      "derrame de gas",
      "gasoducto",
      "consulta previa",
    ],
  },
];

export const CATEGORY_MAP: Record<CategoryId, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c])
) as Record<CategoryId, Category>;

// Plataformas de redes sociales que se buscan vía site: en Google Custom Search
export const SOCIAL_SOURCES = [
  { id: "facebook", domain: "facebook.com", label: "Facebook" },
  { id: "x", domain: "x.com", label: "X / Twitter" },
  { id: "instagram", domain: "instagram.com", label: "Instagram" },
];

// Región Ayacucho (sus 11 provincias) + VRAEM. Cualquiera de estas localidades
// es prioridad — un resultado que mencione alguna de ellas cuenta como válido.
// Huanta y La Mar (el VRAEM ayacuchano) van a nivel de distrito porque ahí
// ocurre la mayoría de los eventos de narcotráfico/terrorismo/crimen organizado.
export const PRIORITY_LOCATIONS = [
  "Ayacucho",
  "VRAEM",
  "Huamanga",
  "Cangallo",
  "Huanca Sancos",
  "Lucanas",
  "Parinacochas",
  "Páucar del Sara Sara",
  "Sucre",
  "Víctor Fajardo",
  "Vilcas Huamán",
  // Huanta (provincia) y sus distritos
  "Huanta",
  "Ayahuanco",
  "Huamanguilla",
  "Iguaín",
  "Llochegua",
  "Luricocha",
  "Santillana",
  "Sivia",
  // La Mar (provincia) y sus distritos
  "La Mar",
  "Anco",
  "Ayna",
  "Chilcas",
  "Chungui",
  "Luis Carranza",
  "San Miguel",
  "Samugari",
  "Tambo",
  // Megantoni (La Convención, Cusco): limítrofe con La Mar, zona VRAEM donde
  // operan TGP/Pluspetrol y hay comunidades nativas — relevante para la
  // categoría de hidrocarburos aunque administrativamente no sea Ayacucho.
  "Megantoni",
];

// Localidades cuyo nombre choca con lugares de otros países (ej. "Sucre" es
// capital de Bolivia y también un estado de Venezuela). Para estas no basta
// con que aparezcan solas como el resto de PRIORITY_LOCATIONS: se exige que
// "Ayacucho" también esté en el resultado.
export const AMBIGUOUS_LOCATIONS = ["Sucre"];

// Países que se excluyen: se restan (operador "-" de Google) de la query Y
// además, si el título/resumen de un resultado menciona alguno de estos
// nombres, se descarta aunque también mencione Ayacucho/VRAEM — hay lugares
// en otros países que se llaman igual por la batalla de Ayacucho (ej. una
// avenida en Caracas, un partido en Buenos Aires, el estado Sucre en
// Venezuela).
export const COUNTRY_EXCLUSIONS = [
  "Bolivia",
  "Venezuela",
  "Ecuador",
  "Colombia",
  "Chile",
  "Argentina",
  "México",
];
