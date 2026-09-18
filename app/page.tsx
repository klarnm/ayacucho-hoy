"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, type CategoryId } from "@/lib/categories";
import type { ResultItem } from "@/lib/search";

const SOURCE_COLOR: Record<ResultItem["sourceType"], string> = {
  medio: "oklch(45% 0.14 250)",
  facebook: "oklch(48% 0.14 255)",
  x: "oklch(25% 0.01 80)",
  instagram: "oklch(52% 0.16 350)",
};

const SOURCE_INITIAL: Record<ResultItem["sourceType"], string> = {
  medio: "N",
  facebook: "f",
  x: "X",
  instagram: "IG",
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diffMs / (1000 * 60 * 60));
  if (hrs < 1) return "Hace instantes";
  if (hrs < 24) return `Hace ${hrs} ${hrs === 1 ? "hora" : "horas"}`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Ayer";
  return `Hace ${days} días`;
}

type SourceFilter = "todos" | "medios" | "redes";

export default function Home() {
  const [active, setActive] = useState<"todos" | CategoryId>("todos");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("todos");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    setItems([]);
    seenIds.current = new Set();
    setLoading(true);

    const es = new EventSource(`/api/search?category=${active}`);

    es.addEventListener("item", (e) => {
      const item: ResultItem = JSON.parse(e.data);
      if (seenIds.current.has(item.id)) return;
      seenIds.current.add(item.id);
      setItems((prev) =>
        [...prev, item].sort(
          (a, b) =>
            new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
        )
      );
    });

    es.addEventListener("done", () => {
      setLoading(false);
      setLastUpdated(
        new Date().toLocaleString("es-PE", {
          hour: "2-digit",
          minute: "2-digit",
          day: "2-digit",
          month: "short",
        })
      );
      es.close();
    });

    es.onerror = () => {
      setLoading(false);
      es.close();
    };

    return () => es.close();
  }, [active]);

  const filteredItems = useMemo(() => {
    let list = items;
    if (sourceFilter === "medios") list = list.filter((i) => i.sourceType === "medio");
    else if (sourceFilter === "redes") list = list.filter((i) => i.sourceType !== "medio");

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        [i.title, i.summary, i.source, i.categoryLabel]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return list;
  }, [items, sourceFilter, query]);

  const resultsLabel = useMemo(() => {
    if (active === "todos") return `${filteredItems.length} eventos · últimos 5 días`;
    const cat = CATEGORIES.find((c) => c.id === active);
    return `${cat?.label} · ${filteredItems.length} eventos`;
  }, [active, filteredItems.length]);

  return (
    <div style={{ minHeight: "100vh" }}>
      <header
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "28px 20px 20px",
          borderBottom: "2px solid var(--ink)",
        }}
      >
        <h1
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: "clamp(32px, 8vw, 44px)",
            margin: 0,
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          AYACUCHO HOY
        </h1>
        <p
          style={{
            margin: "10px 0 0",
            fontSize: 15,
            color: "var(--muted)",
            maxWidth: "46ch",
          }}
        >
          Buscador de acontecimientos locales — corrupción, seguridad,
          protestas y medio ambiente en un solo lugar.
        </p>
        <div
          style={{
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span
            className="pulse-dot"
            style={{
              width: 8,
              height: 8,
              background: "var(--accent)",
              borderRadius: "50%",
            }}
          />
          <span>
            {loading
              ? "Buscando en vivo…"
              : lastUpdated
              ? `Actualizado ${lastUpdated}`
              : ""}
          </span>
        </div>
      </header>

      <nav
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "16px 20px",
          borderBottom: "2px solid var(--ink)",
          position: "sticky",
          top: 0,
          background: "var(--bg)",
          zIndex: 5,
        }}
      >
        <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
          {[{ id: "todos" as const, label: "Todos" }, ...CATEGORIES].map(
            (cat) => (
              <button
                key={cat.id}
                onClick={() => setActive(cat.id)}
                style={{
                  flex: "none",
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 600,
                  fontSize: 13,
                  padding: "9px 14px",
                  border: "2px solid var(--ink)",
                  background: active === cat.id ? "var(--accent)" : "white",
                  color: active === cat.id ? "white" : "var(--ink)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {cat.label}
              </button>
            )
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, overflowX: "auto" }}>
          {(
            [
              { id: "todos" as const, label: "Todas las fuentes" },
              { id: "medios" as const, label: "Solo medios" },
              { id: "redes" as const, label: "Solo redes sociales" },
            ]
          ).map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSourceFilter(opt.id)}
              style={{
                flex: "none",
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 600,
                fontSize: 12,
                padding: "6px 12px",
                border: "1px solid var(--ink)",
                background: sourceFilter === opt.id ? "var(--ink)" : "white",
                color: sourceFilter === opt.id ? "white" : "var(--ink)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por palabra, fuente (ej. facebook, instagram)…"
          style={{
            marginTop: 8,
            width: "100%",
            boxSizing: "border-box",
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 13,
            padding: "9px 12px",
            border: "2px solid var(--ink)",
            background: "white",
            color: "var(--ink)",
          }}
        />
      </nav>

      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "20px 20px 60px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <p
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--muted)",
            margin: "0 0 2px",
          }}
        >
          {resultsLabel}
        </p>

        {filteredItems.map((item, i) => (
          <a
            key={item.id}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="card-in"
            style={{
              display: "block",
              textDecoration: "none",
              color: "inherit",
              border: "2px solid var(--ink)",
              background: "white",
              padding: 18,
              animationDelay: `${Math.min(i, 10) * 60}ms`,
            }}
          >
            {item.imageUrl && (
              <div
                style={{
                  position: "relative",
                  margin: "-18px -18px 14px",
                  borderBottom: "2px solid var(--ink)",
                  overflow: "hidden",
                  background: "oklch(90% 0.01 80)",
                }}
              >
                <img
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  style={{
                    width: "100%",
                    height: 180,
                    objectFit: "cover",
                    display: "block",
                  }}
                  onError={(e) => {
                    const wrapper = e.currentTarget.parentElement as HTMLElement;
                    if (wrapper) wrapper.style.display = "none";
                  }}
                />
                {item.isVideo && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "oklch(0% 0 0 / 0.25)",
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        background: "white",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 15,
                        paddingLeft: 3,
                      }}
                    >
                      ▶
                    </div>
                  </div>
                )}
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 11,
                  fontWeight: 700,
                  border: "1px solid var(--ink)",
                  padding: "2px 7px",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                }}
              >
                {item.categoryLabel}
              </span>
              <span
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "oklch(50% 0.01 80)",
                  whiteSpace: "nowrap",
                }}
              >
                N°{String(i + 1).padStart(2, "0")}
              </span>
            </div>
            <h2
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 19,
                fontWeight: 600,
                lineHeight: 1.25,
                margin: "0 0 8px",
              }}
            >
              {item.title}
            </h2>
            <p
              style={{
                fontSize: "14.5px",
                lineHeight: 1.5,
                color: "oklch(32% 0.01 80)",
                margin: "0 0 14px",
              }}
            >
              {item.summary}
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: "12.5px",
                fontWeight: 600,
                color: "oklch(35% 0.01 80)",
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: SOURCE_COLOR[item.sourceType],
                  color: "white",
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 10,
                  fontWeight: 700,
                  flex: "none",
                }}
              >
                {SOURCE_INITIAL[item.sourceType]}
              </span>
              <span>{item.source}</span>
              <span style={{ color: "oklch(65% 0.01 80)" }}>·</span>
              <span style={{ color: "oklch(50% 0.01 80)", fontWeight: 500 }}>
                {relativeTime(item.publishedAt)}
              </span>
            </div>
          </a>
        ))}

        {!loading && filteredItems.length === 0 && (
          <div
            style={{
              border: "2px dashed oklch(70% 0.01 80)",
              padding: "32px 18px",
              textAlign: "center",
              fontSize: 14,
              color: "var(--muted)",
            }}
          >
            No hay eventos registrados en esta categoría en los últimos 5
            días.
          </div>
        )}
      </main>

      <footer
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "18px 20px 40px",
          borderTop: "2px solid var(--ink)",
          fontSize: 12,
          color: "var(--muted)",
        }}
      >
        Ayacucho Hoy · resultados en vivo, sin base de datos
      </footer>
    </div>
  );
}
