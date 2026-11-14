import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDatabase } from "../../../server/database";
import { authenticate, login, logout, sessionCookie, sessionSeconds } from "../../../server/auth";
import { AppError, ensure } from "../../../server/errors";
import { createService } from "../../../server/service";
import { createAgentService } from "../../../server/agents";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const route = path.join("/");
    let input: unknown = {};
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      let sameOrigin = false;
      try {
        const parsed = new URL(origin || "");
        sameOrigin = parsed.host === request.headers.get("host") && parsed.protocol === request.nextUrl.protocol;
      } catch {}
      ensure(sameOrigin, 403, "写入操作必须来自当前工作台");
      ensure(request.headers.get("content-type")?.includes("application/json"), 415, "请使用 JSON 请求");
      const body = await request.text();
      ensure(Buffer.byteLength(body, "utf8") <= 32000, 413, "提交内容过长");
      try { input = JSON.parse(body); } catch { throw new AppError(400, "请求内容不是有效 JSON"); }
    }
    const database = await getDatabase();
    const token = request.cookies.get(sessionCookie)?.value;
    const response = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
    if (route === "auth/login" && request.method === "POST") {
      const session = await login(database, input);
      const result = response({ ok: true });
      result.cookies.set(sessionCookie, session, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", maxAge: sessionSeconds, path: "/" });
      return result;
    }
    if (route === "auth/logout" && request.method === "POST") {
      await logout(database, token);
      const result = response({ ok: true });
      result.cookies.set(sessionCookie, "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" });
      return result;
    }
    const user = await authenticate(database, token);
    const service = createService(database);
    if (request.method === "GET") {
      if (route === "auth/me") return response({ user });
      if (route === "workspace") return response(await service.workspace(user));
      if (path.length === 3 && path[0] === "tasks" && path[2] === "context") return response(await service.context(user, path[1]));
    }
    if (request.method === "POST") {
      const agents = createAgentService(database);
      if (route === "agents") return response(await agents.register(user, input), 201);
      if (path.length === 3 && path[0] === "tasks" && path[2] === "agent-grants") {
        const grant = await agents.grant(user, path[1], input);
        return response({ ...grant, mcp_config: { mcpServers: { cospace: { command: "node", args: [join(process.cwd(), "scripts", "agent-mcp.mjs")], env: { COSPACE_URL: request.nextUrl.origin, COSPACE_AGENT_TOKEN: grant.token } } } } }, 201);
      }
      if (path.length === 3 && path[0] === "agent-grants" && path[2] === "revoke") return response(await agents.revoke(user, path[1]));
      if (route === "projects") return response(await service.createProject(user, input), 201);
      if (route === "tasks") return response(await service.createTask(user, input), 201);
      if (path.length === 3 && path[0] === "tasks") {
        if (path[2] === "start") return response(await service.start(user, path[1], input));
        if (path[2] === "submissions") return response(await service.submit(user, path[1], input), 201);
        if (path[2] === "review") return response(await service.review(user, path[1], input));
        if (path[2] === "issues") return response(await service.reportIssue(user, path[1], input), 201);
      }
      if (path.length === 3 && path[0] === "issues" && (path[2] === "propose" || path[2] === "resolve")) {
        return response(await service.changeIssue(user, path[1], path[2], input));
      }
    }
    throw new AppError(404, "接口不存在");
  } catch (error) {
    const status = error instanceof AppError ? error.status : error instanceof ZodError ? 400 : 500;
    const message = error instanceof AppError ? error.message : error instanceof ZodError ? error.issues[0]?.message : "服务暂时不可用，请检查服务端配置后重试";
    if (status === 500) console.error("CoSpace request failed", error);
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export { handle as GET, handle as POST };
