import { NextRequest } from "next/server";
import { CATEGORIES, type CategoryId } from "@/lib/categories";
import { buildSearchTasks } from "@/lib/search";

export const dynamic = "force-dynamic";
// Medido en vivo con las 9 páginas reales de KNOWN_SOCIAL_PAGES: Bright Data
// tarda ~132s en total (trigger + scrape completo). El peor caso posible con
// los timeouts de lib/search.ts es 90s (trigger) + 200s (poll) = 290s.
//
// 300s es el TECHO DURO de Vercel — ni el plan de pago lo pasa para este
// tipo de función. 290 da el margen máximo posible por debajo de eso.
//
// OJO: esto solo funciona si el proyecto tiene "Fluid Compute" activo (hasta
// 300s) — es el default en proyectos nuevos desde abril 2025. Si el proyecto
// es más viejo o lo tiene desactivado, el límite real es 60s y esta función
// se cortaría antes de que Bright Data termine. Revisa Project Settings →
// Functions en Vercel para confirmar.
export const maxDuration = 290;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const categoryParam = searchParams.get("category") ?? "todos";

  const categoryIds: CategoryId[] =
    categoryParam === "todos"
      ? CATEGORIES.map((c) => c.id)
      : ([categoryParam] as CategoryId[]);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      const tasks = buildSearchTasks(categoryIds);

      let received = 0;
      await Promise.all(
        tasks.map((task) =>
          task
            .then((items) => {
              received++;
              for (const item of items) {
                send("item", item);
              }
            })
            .catch(() => {
              received++;
            })
        )
      );

      send("done", { total: received });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
