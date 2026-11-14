import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createLocalDatabase, type Database } from "../src/server/database";
import { schema } from "../src/server/schema";
import { seed } from "../src/server/seed";
import { createService } from "../src/server/service";
import { createAgentService } from "../src/server/agents";
import { login } from "../src/server/auth";
import { GET, POST } from "../src/app/api/agent/[...path]/route";
import { POST as memberPost } from "../src/app/api/[...path]/route";
import type { Member } from "../src/lib/types";

let db: Database;
let service: ReturnType<typeof createService>;
let agents: ReturnType<typeof createAgentService>;
let owner: Member;
let executor: Member;
let agentId: string;
beforeAll(async () => {
  db = await createLocalDatabase();
  await db.exec(schema);
  await seed(db, true);
  service = createService(db); agents = createAgentService(db);
  [owner] = await db.query<Member>("SELECT id,workspace_id,name,email,role FROM members WHERE id='member-lin'");
  [executor] = await db.query<Member>("SELECT id,workspace_id,name,email,role FROM members WHERE id='member-chen'");
  agentId = (await agents.register(executor, { name: "测试 Agent" })).id;
  (globalThis as { cospaceDatabase?: Promise<Database> }).cospaceDatabase = Promise.resolve(db);
});
afterAll(async () => { delete (globalThis as { cospaceDatabase?: Promise<Database> }).cospaceDatabase; await db?.close(); });
async function setup() {
  const { id } = await service.createTask(owner, { title: "Agent 执行任务", description: "根据团队共享上下文完成交付物。", acceptance_criteria: "提供真实成果链接并由指定成员验收。", project_id: "project-mvp", assignee_id: executor.id, reviewer_id: owner.id });
  const grant = await agents.grant(executor, id, { agent_id: agentId, version: 1, expires_hours: 1 });
  return { id, grant };
}
const result = (version: number) => ({ version, url: "https://example.com/result", artifact_version: "v1", summary: "完成本次任务，对照验收标准提交成果。" });
async function http(method: "GET" | "POST", path: string, token?: string, body?: unknown, extra: Record<string, string> = {}) {
  const request = new NextRequest(`http://127.0.0.1:3000/api/agent/${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  return (method === "GET" ? GET : POST)(request, { params: Promise.resolve({ path: path.split("/") }) });
}

describe("Agent 单任务授权闭环", () => {
  it("Agent 开始、进展、提交、退回再提交，最终仍由人工验收", async () => {
    const { id, grant } = await setup();
    expect((await agents.execute(grant.token, "list") as { tasks: unknown[] }).tasks).toHaveLength(1);
    await agents.execute(grant.token, "start", id, { version: 1 });
    await agents.execute(grant.token, "progress", id, { version: 2, message: "已完成第一轮实现，正在验证交付结果。" });
    await agents.execute(grant.token, "submissions", id, result(2));
    await expect(agents.execute(grant.token, "submissions", id, result(2))).rejects.toMatchObject({ status: 409 });
    let workspace = await service.workspace(owner);
    const submission = workspace.submissions.find((s) => s.task_id === id)!;
    expect(submission.author_id).toBe(executor.id);
    expect(submission.agent_id).toBe(agentId);
    expect(submission.agent_run_id).toBeTruthy();
    expect(workspace.tasks.find((t) => t.id === id)?.status).toBe("in_review");
    expect(workspace.agent_run_logs.some((l) => l.message.includes("第一轮"))).toBe(true);
    await service.review(owner, id, { version: 3, decision: "rejected", note: "请补充异常路径说明后再次提交。" });
    const context = await agents.execute(grant.token, "context", id) as { submissions: { review_note: string }[] };
    expect(context.submissions[0].review_note).toContain("异常路径");
    await agents.execute(grant.token, "start", id, { version: 4 });
    await agents.execute(grant.token, "submissions", id, result(4));
    await service.review(owner, id, { version: 5, decision: "approved", note: "已检查全部验收要求，可以通过。", collect_asset: true });
    workspace = await service.workspace(owner);
    expect(workspace.tasks.find((t) => t.id === id)?.status).toBe("done");
    expect(workspace.agent_runs.filter((r) => r.task_id === id)).toHaveLength(2);
    expect(workspace.assets.some((a) => a.task_id === id)).toBe(true);
    expect(workspace.events.some((e) => e.task_id === id && e.message.includes("Agent「测试 Agent」代为"))).toBe(true);
  });

  it("凭证只保存摘要，工作区不泄露摘要或凭证；其他成员不能授权或撤销", async () => {
    const { id, grant } = await setup();
    const [stored] = await db.query<{ token_hash: string }>("SELECT token_hash FROM agent_grants WHERE id=$1", [grant.id]);
    expect(stored.token_hash).not.toBe(grant.token);
    const serialized = JSON.stringify(await service.workspace(owner));
    expect(serialized).not.toContain(grant.token);
    expect(serialized).not.toContain(stored.token_hash);
    await expect(agents.grant(owner, id, { agent_id: agentId, version: 1 })).rejects.toMatchObject({ status: 403 });
    await expect(agents.revoke(owner, grant.id)).rejects.toMatchObject({ status: 404 });
    const otherAgent = await agents.register(owner, { name: "别人的 Agent" });
    await expect(agents.grant(executor, id, { agent_id: otherAgent.id, version: 1 })).rejects.toMatchObject({ status: 403 });
    await expect(agents.grant(executor, id, { agent_id: agentId, version: 99 })).rejects.toMatchObject({ status: 409 });
  });

  it("跨任务访问、过期、撤销和伪造凭证均被拒绝；撤销停止运行", async () => {
    const a = await setup(); const b = await setup();
    await expect(agents.execute(a.grant.token, "context", b.id)).rejects.toMatchObject({ status: 403 });
    await expect(agents.execute("csa_" + "0".repeat(64), "list")).rejects.toMatchObject({ status: 401 });
    await agents.execute(a.grant.token, "start", a.id, { version: 1 });
    await agents.revoke(executor, a.grant.id);
    await expect(agents.execute(a.grant.token, "context", a.id)).rejects.toMatchObject({ status: 401 });
    await expect(agents.execute(a.grant.token, "submissions", a.id, result(2))).rejects.toMatchObject({ status: 401 });
    expect((await service.workspace(executor)).agent_runs.find((r) => r.grant_id === a.grant.id)?.status).toBe("stopped");
    await db.query("UPDATE agent_grants SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=$1", [b.grant.id]);
    await expect(agents.execute(b.grant.token, "list")).rejects.toMatchObject({ status: 401 });
  });

  it("阻塞必须人工确认解除，Agent 不能绕过或自行验收", async () => {
    const { id, grant } = await setup();
    await agents.execute(grant.token, "start", id, { version: 1 });
    const issue = await agents.execute(grant.token, "issues", id, { version: 2, title: "需要补充验收样例", helper_id: owner.id }) as { id: string };
    await expect(agents.execute(grant.token, "submissions", id, result(3))).rejects.toMatchObject({ status: 409 });
    await expect(agents.execute(grant.token, "start", id, { version: 3 })).rejects.toMatchObject({ status: 409 });
    await service.changeIssue(owner, issue.id, "propose", { version: 3, resolution: "已补充完整验收样例，请确认。" });
    await service.changeIssue(executor, issue.id, "resolve", { version: 4, resolution: "已确认样例完整，可以继续推进。" });
    await agents.execute(grant.token, "start", id, { version: 5 });
    await expect(agents.execute(grant.token, "review", id, { version: 5 })).rejects.toMatchObject({ status: 404 });
    await agents.execute(grant.token, "submissions", id, result(5));
  });

  it("并发提交只有一版成功，冲突不会留下多余成果", async () => {
    const { id, grant } = await setup();
    await agents.execute(grant.token, "start", id, { version: 1 });
    const results = await Promise.allSettled([agents.execute(grant.token, "submissions", id, result(2)), agents.execute(grant.token, "submissions", id, result(2))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await service.workspace(owner)).submissions.filter((s) => s.task_id === id)).toHaveLength(1);
  });

  it("同一任务只允许一个活动 Agent，过期后可由新授权接手", async () => {
    const { id, grant } = await setup();
    const another = await agents.grant(executor, id, { agent_id: agentId, version: 1 });
    await agents.execute(grant.token, "start", id, { version: 1 });
    await expect(agents.execute(another.token, "start", id, { version: 2 })).rejects.toMatchObject({ status: 409 });
    await db.query("UPDATE agent_grants SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=$1", [grant.id]);
    await agents.execute(another.token, "start", id, { version: 2 });
    const runs = (await service.workspace(owner)).agent_runs.filter((run) => run.task_id === id);
    expect(runs.filter((run) => run.status === "running")).toHaveLength(1);
    expect(runs.find((run) => run.grant_id === grant.id)?.status).toBe("stopped");
  });

  it("人工接手提交会停止 Agent 当前运行，旧运行不能覆盖新成果", async () => {
    const { id, grant } = await setup();
    await agents.execute(grant.token, "start", id, { version: 1 });
    await service.submit(executor, id, result(2));
    expect((await service.workspace(owner)).agent_runs.find((run) => run.grant_id === grant.id)?.status).toBe("stopped");
    await expect(agents.execute(grant.token, "submissions", id, result(2))).rejects.toMatchObject({ status: 409 });
    await service.review(owner, id, { version: 3, decision: "rejected", note: "请重新检查人工接手的成果。" });
    await expect(agents.execute(grant.token, "submissions", id, result(4))).rejects.toMatchObject({ status: 409 });
  });

  it("增量 schema 可重复应用，保留原有任务和 Agent 授权", async () => {
    const { id, grant } = await setup();
    await db.exec(schema);
    const context = await agents.execute(grant.token, "context", id) as { task: { id: string } };
    expect(context.task.id).toBe(id);
    expect((await service.workspace(owner)).members).toHaveLength(3);
  });

  it("HTTP Bearer 认证与浏览器会话隔离，非法方法和来源不可写入", async () => {
    const { id, grant } = await setup();
    expect((await http("GET", "tasks")).status).toBe(401);
    expect((await http("GET", "tasks", grant.token)).status).toBe(200);
    expect((await http("GET", `tasks/${id}/context`, grant.token, undefined, { Origin: "https://untrusted.example" })).status).toBe(403);
    expect((await http("POST", `tasks/${id}/review`, grant.token, { version: 1 })).status).toBe(404);
    expect((await http("POST", `tasks/${id}/start`, grant.token, { version: 1 })).status).toBe(200);
    expect((await http("POST", `tasks/${id}/submissions`, grant.token, result(2))).status).toBe(200);
    const cookie = await login(db, { email: executor.email, password: "cospace-local-2026" });
    const response = await memberPost(new NextRequest(`http://127.0.0.1:3000/api/tasks/${id}/agent-grants`, { method: "POST", headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000", Cookie: `cospace_session=${cookie}`, "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: agentId, version: 3 }) }), { params: Promise.resolve({ path: ["tasks", id, "agent-grants"] }) });
    expect(response.status).toBe(409); // In-review tasks cannot be newly delegated.
    const other = await setup();
    const authorized = await memberPost(new NextRequest(`http://127.0.0.1:3000/api/tasks/${other.id}/agent-grants`, { method: "POST", headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000", Cookie: `cospace_session=${cookie}`, "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: agentId, version: 1 }) }), { params: Promise.resolve({ path: ["tasks", other.id, "agent-grants"] }) });
    expect(authorized.status).toBe(201);
    expect((await authorized.json()).mcp_config.mcpServers.cospace.args[0]).toContain("agent-mcp.mjs");
  });
});
