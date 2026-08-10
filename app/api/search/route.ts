import { NextRequest } from "next/server";
import { CATEGORIES, type CategoryId } from "@/lib/categories";
import { buildSearchTasks } from "@/lib/search";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
