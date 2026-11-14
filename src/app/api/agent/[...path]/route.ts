import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { createAgentService } from "../../../../server/agents";
import { getDatabase } from "../../../../server/database";
import { AppError, ensure } from "../../../../server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  try {
    ensure(!request.headers.get("origin"), 403, "Agent 接口仅用于外部工具连接");
    const { path } = await context.params;
    const service = createAgentService(await getDatabase());
    const header = request.headers.get("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (request.method === "GET" && path.length === 1 && path[0] === "tasks") return json(await service.execute(token, "list"));
    if (path.length === 3 && path[0] === "tasks") {
      if (request.method === "GET" && path[2] === "context") return json(await service.execute(token, "context", path[1]));
      if (request.method === "POST" && ["start", "progress", "issues", "submissions"].includes(path[2])) {
        ensure(request.headers.get("content-type")?.includes("application/json"), 415, "请使用 JSON 请求");
        const body = await request.text();
        ensure(Buffer.byteLength(body, "utf8") <= 16000, 413, "提交内容过长");
        let input: unknown;
        try { input = JSON.parse(body); } catch { throw new AppError(400, "请求内容不是有效 JSON"); }
        return json(await service.execute(token, path[2], path[1], input));
      }
    }
    throw new AppError(404, "Agent 接口不存在");
  } catch (error) {
    const status = error instanceof AppError ? error.status : error instanceof ZodError ? 400 : 500;
    if (status === 500) console.error("Agent request failed", error);
    return json({ error: error instanceof AppError ? error.message : error instanceof ZodError ? error.issues[0]?.message : "Agent 服务暂时不可用" }, status);
  }
}

export { handle as GET, handle as POST };
