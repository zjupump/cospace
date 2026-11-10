import assert from "node:assert/strict";

const base = process.argv[2] || "http://127.0.0.1:3100";
assert.equal(new URL(base).hostname, "127.0.0.1", "Smoke testing is restricted to local loopback.");

async function request(route, { body, cookie, origin = base } = {}) {
  const response = await fetch(`${base}/api/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

async function signIn(email) {
  const { response } = await request("auth/login", { body: { email, password: process.env.COSPACE_DEMO_PASSWORD || "cospace-local-2026" } });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie.includes("HttpOnly"));
  return cookie.split(";")[0];
}

assert.equal((await fetch(base)).status, 200);
assert.equal((await request("workspace")).response.status, 401);
assert.equal((await request("auth/login", { body: {}, origin: "https://unrelated.example" })).response.status, 403);
assert.equal((await request("auth/login", { body: {}, origin: "invalid-origin" })).response.status, 403);
const owner = await signIn("lin@cospace.local");
const executor = await signIn("chen@cospace.local");
const workspace = (await request("workspace", { cookie: owner })).data;
assert.equal(workspace.members.length, 3);
assert.ok(!JSON.stringify(workspace).includes("password_hash"));
const project = await request("projects", { cookie: owner, body: { title: "HTTP 验收流程验证", description: "验证真实接口、独立会话和持久化交付流程。", goal_id: workspace.goals[0].id } });
assert.equal(project.response.status, 201);
const created = await request("tasks", { cookie: owner, body: { project_id: project.data.id, title: "验证从提交到验收的接口", description: "通过两个独立账号完成任务交付与验收。", acceptance_criteria: "验收后状态、历史、资产和上下文一致。", assignee_id: "member-chen", reviewer_id: "member-lin" } });
assert.equal(created.response.status, 201);
const id = created.data.id;
assert.equal((await request(`tasks/${id}/start`, { cookie: owner, body: { version: 1 } })).response.status, 403);
assert.equal((await request(`tasks/${id}/start`, { cookie: executor, body: { version: 1 } })).response.status, 200);
const submitted = await request(`tasks/${id}/submissions`, { cookie: executor, body: { version: 2, url: "https://example.com/smoke-only", artifact_version: "smoke-v1", summary: "自动化验证用成果占位地址，用于检查状态流转。" } });
assert.equal(submitted.response.status, 201);
assert.equal((await request(`tasks/${id}/review`, { cookie: executor, body: { version: 3, decision: "approved", note: "负责人不能自行通过本次验收。" } })).response.status, 403);
assert.equal((await request(`tasks/${id}/review`, { cookie: owner, body: { version: 3, decision: "approved", note: "已核对接口和状态变化，符合验收要求。", collect_asset: true } })).response.status, 200);
assert.equal((await request(`tasks/${id}/review`, { cookie: owner, body: { version: 3, decision: "approved", note: "重复提交应当被版本检查拒绝。" } })).response.status, 409);
const context = (await request(`tasks/${id}/context`, { cookie: executor })).data;
assert.equal(context.task.status, "done");
assert.equal(context.task_version, 4);
assert.equal(context.submissions[0].result, "approved");
const after = (await request("workspace", { cookie: owner })).data;
assert.equal(after.assets.filter((asset) => asset.task_id === id).length, 1);
await request("auth/logout", { cookie: owner, body: {} });
assert.equal((await request("workspace", { cookie: owner })).response.status, 401);
await request("auth/logout", { cookie: executor, body: {} });
console.log(`PASS: HTTP auth, CSRF, role checks, submission, review, conflict, assets, context, logout. Task: ${id}`);
