import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalDatabase, type Database } from "../src/server/database";
import { schema } from "../src/server/schema";
import { seed } from "../src/server/seed";
import { createService } from "../src/server/service";
import { authenticate, login, logout } from "../src/server/auth";
import type { Member, Task } from "../src/lib/types";

let database: Database;
let service: ReturnType<typeof createService>;
let owner: Member;
let executor: Member;
let colleague: Member;
let outsider: Member;

beforeAll(async () => {
  database = await createLocalDatabase();
  await database.exec(schema);
  await seed(database, true);
  service = createService(database);
  const members = await database.query<Member>("SELECT id,workspace_id,name,email,role FROM members");
  owner = members.find((member) => member.id === "member-lin")!;
  executor = members.find((member) => member.id === "member-chen")!;
  colleague = members.find((member) => member.id === "member-zhou")!;
  await database.query("INSERT INTO workspaces (id,name) VALUES ('other-workspace','其他团队')");
  await database.query("INSERT INTO members (id,workspace_id,name,email,password_hash,role) VALUES ('outsider','other-workspace','外部成员','outside@example.com','unused','member')");
  [outsider] = await database.query<Member>("SELECT id,workspace_id,name,email,role FROM members WHERE id='outsider'");
});

afterAll(async () => { await database?.close(); });

async function newTask() {
  return service.createTask(owner, {
    title: "验证成果交接流程",
    description: "团队成员可以提交一个明确版本的交付物。",
    acceptance_criteria: "通过后计入完成，历史与验收记录保持完整。",
    assignee_id: executor.id,
    reviewer_id: owner.id,
    project_id: "project-mvp",
  });
}

async function task(id: string) {
  return (await service.workspace(owner)).tasks.find((item) => item.id === id) as Task;
}

const submission = (version: number) => ({ version, url: "https://example.com/deliverable", artifact_version: "commit-abc123", summary: "已完成实现与验证，对照标准提交本次交付物。" });

describe("真实共享工作流", () => {
  it("独立登录会话不返回密码；退出使原令牌失效", async () => {
    const token = await login(database, { email: "CHEN@COSPACE.LOCAL", password: "cospace-local-2026" });
    const user = await authenticate(database, token);
    expect(user.id).toBe(executor.id);
    expect(user).not.toHaveProperty("password_hash");
    const sessions = await database.query<{ token_hash: string }>("SELECT token_hash FROM sessions");
    expect(sessions.some((session) => session.token_hash === token)).toBe(false);
    await logout(database, token);
    await expect(authenticate(database, token)).rejects.toMatchObject({ status: 401 });
    await expect(authenticate(database, "forged-session")).rejects.toMatchObject({ status: 401 });
  });

  it("错误密码不会获得会话，连续失败后限制尝试", async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(login(database, { email: "missing@example.com", password: "wrong" })).rejects.toMatchObject({ status: 401 });
    }
    await expect(login(database, { email: "missing@example.com", password: "wrong" })).rejects.toMatchObject({ status: 429 });
  });

  it("创建项目可被同团队另一成员读取，创建者成为项目负责人", async () => {
    const created = await service.createProject(executor, { title: "第二轮试用", description: "完成第二轮真实用户的项目验证。", goal_id: "goal-main" });
    const workspace = await service.workspace(colleague);
    expect(workspace.projects.find((project) => project.id === created.id)?.owner_id).toBe(executor.id);
    expect(workspace.events.some((event) => event.project_id === created.id)).toBe(true);
  });

  it("负责人执行、独立验收人通过后才完成，同时收录有来源的资产", async () => {
    const { id } = await newTask();
    await service.start(executor, id, { version: 1 });
    await service.submit(executor, id, submission(2));
    expect((await task(id)).status).toBe("in_review");
    expect((await service.workspace(owner)).assets.filter((asset) => asset.task_id === id)).toHaveLength(0);
    await expect(service.review(executor, id, { version: 3, decision: "approved", note: "我已确认完成全部验收要求。" })).rejects.toMatchObject({ status: 403 });
    expect((await task(id)).version).toBe(3);
    await service.review(owner, id, { version: 3, decision: "approved", note: "逐项检查通过，版本和内容符合要求。", collect_asset: true });
    const workspace = await service.workspace(executor);
    expect(workspace.tasks.find((item) => item.id === id)?.status).toBe("done");
    const asset = workspace.assets.find((item) => item.task_id === id)!;
    expect(asset.artifact_version).toBe("commit-abc123");
    expect(workspace.submissions.find((item) => item.id === asset.submission_id)?.reviewed_by).toBe(owner.id);
    await expect(service.review(owner, id, { version: 3, decision: "approved", note: "重复点击同一个验收通过按钮。", collect_asset: true })).rejects.toMatchObject({ status: 409 });
    expect((await service.workspace(owner)).assets.filter((item) => item.task_id === id)).toHaveLength(1);
  });

  it("退回后允许重新提交，保留此前成果与退回意见", async () => {
    const { id } = await newTask();
    await service.start(executor, id, { version: 1 });
    await service.submit(executor, id, submission(2));
    await service.review(owner, id, { version: 3, decision: "rejected", note: "缺少异常路径验证，需要补充后再提交。" });
    expect((await task(id)).status).toBe("in_progress");
    await service.submit(executor, id, { ...submission(4), artifact_version: "commit-def456" });
    const submissions = (await service.workspace(owner)).submissions.filter((item) => item.task_id === id);
    expect(submissions.map((item) => item.revision)).toEqual([2, 1]);
    expect(submissions[1].review_note).toContain("缺少异常路径验证");
    expect(submissions[1].result).toBe("rejected");
    expect(submissions[0].result).toBe("pending");
  });

  it("阻塞在负责人确认前持续有效，协助人提出方案不能擅自解除", async () => {
    const { id } = await newTask();
    await service.start(executor, id, { version: 1 });
    const issue = await service.reportIssue(executor, id, { version: 2, title: "缺少用于验收的测试账号", helper_id: colleague.id });
    await expect(service.submit(executor, id, submission(3))).rejects.toMatchObject({ status: 409 });
    await service.changeIssue(colleague, issue.id, "propose", { version: 3, resolution: "测试账号已准备好，请确认登录和权限。" });
    await expect(service.changeIssue(colleague, issue.id, "resolve", { version: 4, resolution: "我认为测试账号已经可以使用。" })).rejects.toMatchObject({ status: 403 });
    await expect(service.submit(executor, id, submission(4))).rejects.toMatchObject({ status: 409 });
    await service.changeIssue(executor, issue.id, "resolve", { version: 4, resolution: "已实际登录并确认角色权限，可以恢复。" });
    await service.submit(executor, id, submission(5));
    expect((await task(id)).status).toBe("in_review");
  });

  it("待验收期间发现新阻塞会禁止通过，但仍可退回", async () => {
    const { id } = await newTask();
    await service.start(executor, id, { version: 1 });
    await service.submit(executor, id, submission(2));
    await service.reportIssue(executor, id, { version: 3, title: "交付链接暂时无法访问", helper_id: colleague.id });
    await expect(service.review(owner, id, { version: 4, decision: "approved", note: "希望在链接恢复前提前验收。" })).rejects.toMatchObject({ status: 409 });
    await service.review(owner, id, { version: 4, decision: "rejected", note: "请恢复交付链接并重新提交验收。" });
    expect((await task(id)).status).toBe("in_progress");
  });

  it("同版本并发提交只有一次成功，失败事务不留下重复记录", async () => {
    const { id } = await newTask();
    await service.start(executor, id, { version: 1 });
    const results = await Promise.allSettled([service.submit(executor, id, submission(2)), service.submit(executor, id, submission(2))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const workspace = await service.workspace(owner);
    expect(workspace.submissions.filter((item) => item.task_id === id)).toHaveLength(1);
    expect(workspace.events.filter((item) => item.task_id === id && item.message.includes("提交了"))).toHaveLength(1);
  });

  it("另一团队无法读取上下文、修改任务或将成员分配到本团队", async () => {
    const { id } = await newTask();
    const foreign = await service.workspace(outsider);
    expect(foreign.tasks).toEqual([]);
    expect(foreign.projects).toEqual([]);
    expect(foreign.members.map((member) => member.id)).toEqual([outsider.id]);
    await expect(service.context(outsider, id)).rejects.toMatchObject({ status: 404 });
    await expect(service.start(outsider, id, { version: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(service.createTask(owner, { project_id: "project-mvp", title: "尝试跨团队指派", description: "这条任务不应该被创建成功。", acceptance_criteria: "系统应拒绝跨团队成员的指派。", assignee_id: outsider.id, reviewer_id: owner.id })).rejects.toMatchObject({ status: 400 });
    await expect(service.createProject(outsider, { title: "尝试关联别的团队", description: "不应该使用其他团队的目标。", goal_id: "goal-main" })).rejects.toMatchObject({ status: 400 });
  });

  it("普通协作者无法替负责人开始、提交或报告阻塞", async () => {
    const { id } = await newTask();
    await expect(service.start(colleague, id, { version: 1 })).rejects.toMatchObject({ status: 403 });
    await service.start(executor, id, { version: 1 });
    await expect(service.submit(colleague, id, submission(2))).rejects.toMatchObject({ status: 403 });
    await expect(service.reportIssue(colleague, id, { version: 2, title: "冒充负责人提交的问题", helper_id: owner.id })).rejects.toMatchObject({ status: 403 });
    expect((await task(id)).version).toBe(2);
  });

  it("交接包包含同一任务版本、真实成果和仍未解除的问题", async () => {
    const { id } = await newTask();
    await service.start(executor, id, { version: 1 });
    const issue = await service.reportIssue(executor, id, { version: 2, title: "需要补充验收输入材料", helper_id: colleague.id });
    const context = await service.context(owner, id);
    expect(context.task_version).toBe(3);
    expect(context.task.version).toBe(3);
    expect(context.goal.id).toBe("goal-main");
    expect(context.unresolved_issues[0].id).toBe(issue.id);
    expect(context.members.map((member) => member.id).sort()).toEqual([executor.id, owner.id].sort());
    expect(context.task.acceptance_criteria).toContain("历史与验收记录");
  });

  it("拒绝可执行链接和自己验收自己的任务", async () => {
    const { id } = await newTask();
    await service.start(executor, id, { version: 1 });
    await expect(service.submit(executor, id, { ...submission(2), url: "javascript:alert(1)" })).rejects.toBeDefined();
    await expect(service.submit(executor, id, { ...submission(2), url: "https://secret:password@example.com" })).rejects.toBeDefined();
    await expect(service.createTask(owner, { project_id: "project-mvp", title: "尝试自己验收自己", description: "这个任务应被规则明确拒绝。", acceptance_criteria: "负责人和验收人必须是不同成员。", assignee_id: owner.id, reviewer_id: owner.id })).rejects.toMatchObject({ status: 400 });
    expect((await task(id)).version).toBe(2);
  });
});
