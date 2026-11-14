import assert from "node:assert/strict";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const base = process.argv[2] || "http://127.0.0.1:3100";
assert.equal(new URL(base).hostname, "127.0.0.1", "Run against a local disposable test database only.");
async function request(path, body, cookie, token) {
  const response = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json", ...(!token ? { Origin: base } : {}) }), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
async function signIn(email) {
  const response = await request("auth/login", { email, password: process.env.COSPACE_DEMO_PASSWORD || "cospace-local-2026" });
  assert.equal(response.status, 200); return response.cookie;
}
const owner = await signIn("lin@cospace.local");
const executor = await signIn("chen@cospace.local");
const project = await request("tasks", { title: "MCP 接入自动验证", description: "仅用于本地 MCP 工具连接、交付与撤销授权测试。", acceptance_criteria: "通过真实 MCP 协议完成两轮提交与人工验收。", project_id: "project-mvp", assignee_id: "member-chen", reviewer_id: "member-lin" }, owner);
assert.equal(project.status, 201);
const id = project.data.id;
const registered = await request("agents", { name: "MCP 验证助手" }, executor);
assert.equal(registered.status, 201);
const grant = await request(`tasks/${id}/agent-grants`, { version: 1, agent_id: registered.data.id, expires_hours: 1 }, executor);
assert.equal(grant.status, 201);
const client = new Client({ name: "cospace-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("scripts/agent-mcp.mjs")], env: { ...process.env, COSPACE_URL: base, COSPACE_AGENT_TOKEN: grant.data.token }, stderr: "pipe" });
try {
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ["get_task_context", "list_my_tasks", "report_blocker", "report_progress", "start_task", "submit_result"].sort());
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, `MCP ${name} failed`);
    return JSON.parse(result.content[0].text);
  }
  assert.equal((await call("list_my_tasks")).tasks[0].id, id);
  assert.equal((await call("get_task_context", { task_id: id })).task_version, 1);
  await call("start_task", { task_id: id, version: 1 });
  await call("report_progress", { task_id: id, version: 2, message: "真实 MCP 客户端已连接，完成工具调用验证。" });
  await call("report_blocker", { task_id: id, version: 2, title: "验证需人工解除的阻塞", helper_id: "member-lin" });
  const context = await call("get_task_context", { task_id: id });
  const issueId = context.unresolved_issues[0].id;
  assert.equal((await request(`issues/${issueId}/propose`, { version: 3, resolution: "验证需要的样例已经补充完整。" }, owner)).status, 200);
  assert.equal((await request(`issues/${issueId}/resolve`, { version: 4, resolution: "已确认样例可用，解除本次验证阻塞。" }, executor)).status, 200);
  await call("start_task", { task_id: id, version: 5 });
  const result = { task_id: id, version: 5, url: "https://example.com/mcp-smoke-only", artifact_version: "mcp-smoke-v1", summary: "此链接为自动化验证占位地址，验证 Agent 提交与人工验收链路。" };
  await call("submit_result", result);
  assert.equal((await request(`tasks/${id}/review`, { version: 6, decision: "rejected", note: "验证退回后 Agent 能读取意见并再次提交。" }, owner)).status, 200);
  assert.equal((await call("get_task_context", { task_id: id })).submissions[0].result, "rejected");
  await call("start_task", { task_id: id, version: 7 });
  await call("submit_result", { ...result, version: 7, artifact_version: "mcp-smoke-v2" });
  assert.equal((await request(`tasks/${id}/review`, { version: 8, decision: "approved", note: "两轮提交与真实 MCP 连接流程验证通过。", collect_asset: true }, owner)).status, 200);
  const workspace = (await request("workspace", undefined, owner)).data;
  assert.equal(workspace.tasks.find((task) => task.id === id).status, "done");
  assert.equal(workspace.agent_runs.filter((run) => run.task_id === id).length, 2);
  assert.equal(workspace.submissions.filter((item) => item.task_id === id && item.agent_id === registered.data.id).length, 2);
  assert.ok(!JSON.stringify(workspace).includes(grant.data.token));
  assert.equal((await request(`agent-grants/${grant.data.id}/revoke`, {}, executor)).status, 200);
  assert.equal((await client.callTool({ name: "list_my_tasks", arguments: {} })).isError, true);
  console.log("PASS: real MCP initialization, six tools, task scope, progress, blockers, resubmission, human review, attribution and revoked access.");
} finally {
  await client.close();
  await request("auth/logout", {}, owner);
  await request("auth/logout", {}, executor);
}
