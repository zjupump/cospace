import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Activity, Asset, Goal, Issue, Member, Project, Submission, Task, Workspace } from "../lib/types";
import type { Database } from "./database";
import { ensure } from "./errors";

const title = z.string().trim().min(2, "标题至少 2 个字").max(120);
const text = z.string().trim().min(5, "请填写至少 5 个字的具体说明").max(6000);
const identifier = z.string().min(1).max(100);
const versioned = z.object({ version: z.number().int().positive() });
const safeUrl = z.string().trim().url("请填写完整的成果链接").max(2000).refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "成果链接仅支持不含账号密码的 HTTP / HTTPS 地址");

const projectInput = z.object({ title, description: text, goal_id: identifier });
const taskInput = z.object({
  project_id: identifier,
  title,
  description: text,
  acceptance_criteria: text,
  assignee_id: identifier,
  reviewer_id: identifier,
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "截止日期无效").nullable().optional(),
});
const submissionInput = versioned.extend({ url: safeUrl, artifact_version: z.string().trim().min(1).max(120), summary: text });
const reviewInput = versioned.extend({ decision: z.enum(["approved", "rejected"]), note: text, collect_asset: z.boolean().default(false) });
const issueInput = versioned.extend({ title, helper_id: identifier });
const resolutionInput = versioned.extend({ resolution: text });

async function projectFor(database: Database, user: Member, id: string) {
  const [project] = await database.query<Project>("SELECT * FROM projects WHERE id=$1 AND workspace_id=$2", [id, user.workspace_id]);
  ensure(project, 404, "项目不存在或无权访问");
  return project;
}

async function taskFor(database: Database, user: Member, id: string, lock = false) {
  const [task] = await database.query<Task>(`SELECT tasks.* FROM tasks JOIN projects ON projects.id=tasks.project_id WHERE tasks.id=$1 AND projects.workspace_id=$2${lock ? " FOR UPDATE OF tasks" : ""}`, [id, user.workspace_id]);
  ensure(task, 404, "任务不存在或无权访问");
  return task;
}

async function verifyMembers(database: Database, user: Member, ids: string[]) {
  const members = await database.query<Member>("SELECT id FROM members WHERE workspace_id=$1 AND id=ANY($2::text[])", [user.workspace_id, ids]);
  ensure(new Set(ids).size === members.length, 400, "请选择当前团队的成员");
}

async function event(database: Database, user: Member, projectId: string, taskId: string | null, message: string) {
  await database.query("INSERT INTO events (id,project_id,task_id,actor_id,message,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [randomUUID(), projectId, taskId, user.id, message, new Date().toISOString()]);
}

export function createService(database: Database) {
  async function changeTask<T>(user: Member, id: string, version: number, operation: (transaction: Database, task: Task) => Promise<T>) {
    return database.transaction(async (transaction) => {
      const task = await taskFor(transaction, user, id, true);
      ensure(task.version === version, 409, "任务已被更新，请刷新后查看最新内容再操作");
      const result = await operation(transaction, task);
      await transaction.query("UPDATE tasks SET version=version+1,updated_at=$2 WHERE id=$1", [id, new Date().toISOString()]);
      return result;
    });
  }

  async function requireUnblocked(transaction: Database, taskId: string) {
    const issues = await transaction.query<Issue>("SELECT id FROM issues WHERE task_id=$1 AND status <> 'resolved'", [taskId]);
    ensure(issues.length === 0, 409, "请先确认解除未解决的阻塞");
  }

  return {
    async workspace(user: Member): Promise<Workspace> {
      const workspaceId = [user.workspace_id];
      const [members, goals, projects, tasks, submissions, issues, assets, events] = await Promise.all([
        database.query<Member>("SELECT id,workspace_id,name,email,role FROM members WHERE workspace_id=$1 ORDER BY name", workspaceId),
        database.query<Goal>("SELECT * FROM goals WHERE workspace_id=$1", workspaceId),
        database.query<Project>("SELECT * FROM projects WHERE workspace_id=$1 ORDER BY created_at DESC,id", workspaceId),
        database.query<Task>("SELECT tasks.* FROM tasks JOIN projects ON projects.id=tasks.project_id WHERE projects.workspace_id=$1 ORDER BY tasks.created_at DESC,tasks.id", workspaceId),
        database.query<Submission>("SELECT submissions.* FROM submissions JOIN tasks ON tasks.id=submissions.task_id JOIN projects ON projects.id=tasks.project_id WHERE projects.workspace_id=$1 ORDER BY submissions.revision DESC", workspaceId),
        database.query<Issue>("SELECT issues.* FROM issues JOIN tasks ON tasks.id=issues.task_id JOIN projects ON projects.id=tasks.project_id WHERE projects.workspace_id=$1 ORDER BY issues.created_at DESC", workspaceId),
        database.query<Asset>("SELECT assets.* FROM assets JOIN projects ON projects.id=assets.project_id WHERE projects.workspace_id=$1 ORDER BY assets.created_at DESC", workspaceId),
        database.query<Activity>("SELECT events.* FROM events JOIN projects ON projects.id=events.project_id WHERE projects.workspace_id=$1 ORDER BY events.created_at DESC LIMIT 100", workspaceId),
      ]);
      return { user, members, goals, projects, tasks, submissions, issues, assets, events };
    },

    async createProject(user: Member, input: unknown) {
      const data = projectInput.parse(input);
      return database.transaction(async (transaction) => {
        const [goal] = await transaction.query<Goal>("SELECT id FROM goals WHERE id=$1 AND workspace_id=$2", [data.goal_id, user.workspace_id]);
        ensure(goal, 400, "请选择当前团队的目标");
        const id = randomUUID();
        await transaction.query("INSERT INTO projects (id,workspace_id,goal_id,title,description,owner_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, user.workspace_id, data.goal_id, data.title, data.description, user.id, new Date().toISOString()]);
        await event(transaction, user, id, null, `创建项目「${data.title}」`);
        return { id };
      });
    },

    async createTask(user: Member, input: unknown) {
      const data = taskInput.parse(input);
      ensure(data.assignee_id !== data.reviewer_id, 400, "负责人和验收人需要是不同成员");
      return database.transaction(async (transaction) => {
        await projectFor(transaction, user, data.project_id);
        await verifyMembers(transaction, user, [data.assignee_id, data.reviewer_id]);
        const id = randomUUID();
        const now = new Date().toISOString();
        await transaction.query("INSERT INTO tasks (id,project_id,title,description,acceptance_criteria,assignee_id,reviewer_id,status,version,due_date,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'todo',1,$8,$9,$9)", [id, data.project_id, data.title, data.description, data.acceptance_criteria, data.assignee_id, data.reviewer_id, data.due_date || null, now]);
        await event(transaction, user, data.project_id, id, `创建任务「${data.title}」`);
        return { id };
      });
    },

    async start(user: Member, id: string, input: unknown) {
      const data = versioned.parse(input);
      return changeTask(user, id, data.version, async (transaction, task) => {
        ensure(task.assignee_id === user.id, 403, "只有任务负责人可以开始执行");
        ensure(task.status === "todo", 409, "该任务已开始或已结束");
        await transaction.query("UPDATE tasks SET status='in_progress' WHERE id=$1", [id]);
        await event(transaction, user, task.project_id, id, "开始执行任务");
        return { id };
      });
    },

    async submit(user: Member, id: string, input: unknown) {
      const data = submissionInput.parse(input);
      return changeTask(user, id, data.version, async (transaction, task) => {
        ensure(task.assignee_id === user.id, 403, "只有任务负责人可以提交成果");
        ensure(task.status === "in_progress", 409, "请先开始任务，或等待当前成果验收结束");
        await requireUnblocked(transaction, id);
        const [latest] = await transaction.query<{ revision: number }>("SELECT revision FROM submissions WHERE task_id=$1 ORDER BY revision DESC LIMIT 1", [id]);
        const revision = (latest?.revision || 0) + 1;
        const submissionId = randomUUID();
        await transaction.query("INSERT INTO submissions (id,task_id,revision,author_id,url,artifact_version,summary,result,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)", [submissionId, id, revision, user.id, data.url, data.artifact_version, data.summary, new Date().toISOString()]);
        await transaction.query("UPDATE tasks SET status='in_review' WHERE id=$1", [id]);
        await event(transaction, user, task.project_id, id, `提交了第 ${revision} 版成果，等待验收`);
        return { id: submissionId, revision };
      });
    },

    async review(user: Member, id: string, input: unknown) {
      const data = reviewInput.parse(input);
      return changeTask(user, id, data.version, async (transaction, task) => {
        ensure(task.reviewer_id === user.id, 403, "只有指定验收人可以验收");
        ensure(task.status === "in_review", 409, "该任务当前没有待验收成果");
        if (data.decision === "approved") await requireUnblocked(transaction, id);
        const [submission] = await transaction.query<Submission>("SELECT * FROM submissions WHERE task_id=$1 AND result='pending'", [id]);
        ensure(submission, 409, "成果已经处理，请刷新后重试");
        const now = new Date().toISOString();
        await transaction.query("UPDATE submissions SET result=$2,review_note=$3,reviewed_by=$4,reviewed_at=$5 WHERE id=$1", [submission.id, data.decision, data.note, user.id, now]);
        await transaction.query("UPDATE tasks SET status=$2 WHERE id=$1", [id, data.decision === "approved" ? "done" : "in_progress"]);
        if (data.decision === "approved" && data.collect_asset) {
          await transaction.query("INSERT INTO assets (id,project_id,task_id,submission_id,title,url,artifact_version,maintainer_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [randomUUID(), task.project_id, id, submission.id, task.title, submission.url, submission.artifact_version, task.assignee_id, now]);
        }
        await event(transaction, user, task.project_id, id, `${data.decision === "approved" ? "验收通过" : "退回修改"}第 ${submission.revision} 版成果${data.decision === "approved" && data.collect_asset ? "，已收录为团队资产" : ""}`);
        return { id };
      });
    },

    async reportIssue(user: Member, id: string, input: unknown) {
      const data = issueInput.parse(input);
      return changeTask(user, id, data.version, async (transaction, task) => {
        ensure(task.assignee_id === user.id, 403, "只有任务负责人可以报告阻塞");
        ensure(task.status !== "done", 409, "已完成任务不能新增阻塞");
        await verifyMembers(transaction, user, [data.helper_id]);
        const issueId = randomUUID();
        await transaction.query("INSERT INTO issues (id,task_id,title,helper_id,reported_by,status,created_at) VALUES ($1,$2,$3,$4,$5,'open',$6)", [issueId, id, data.title, data.helper_id, user.id, new Date().toISOString()]);
        await event(transaction, user, task.project_id, id, `报告阻塞：${data.title}`);
        return { id: issueId };
      });
    },

    async changeIssue(user: Member, issueId: string, action: "propose" | "resolve", input: unknown) {
      const data = resolutionInput.parse(input);
      const [reference] = await database.query<{ task_id: string }>("SELECT issues.task_id FROM issues JOIN tasks ON tasks.id=issues.task_id JOIN projects ON projects.id=tasks.project_id WHERE issues.id=$1 AND projects.workspace_id=$2", [issueId, user.workspace_id]);
      ensure(reference, 404, "问题不存在或无权访问");
      return changeTask(user, reference.task_id, data.version, async (transaction, task) => {
        const [issue] = await transaction.query<Issue>("SELECT * FROM issues WHERE id=$1", [issueId]);
        ensure(issue.status !== "resolved", 409, "问题已解除，请刷新后查看");
        if (action === "propose") {
          ensure(user.id === issue.helper_id || user.id === task.assignee_id, 403, "只有协助人或任务负责人可以提交解决方案");
          await transaction.query("UPDATE issues SET status='proposed',resolution=$2 WHERE id=$1", [issueId, data.resolution]);
          await event(transaction, user, task.project_id, task.id, `提出解决方案：${issue.title}`);
        } else {
          ensure(user.id === task.assignee_id, 403, "只有任务负责人可以确认恢复推进");
          await transaction.query("UPDATE issues SET status='resolved',resolution=$2,resolved_by=$3,resolved_at=$4 WHERE id=$1", [issueId, data.resolution, user.id, new Date().toISOString()]);
          await event(transaction, user, task.project_id, task.id, `确认解除阻塞：${issue.title}`);
        }
        return { id: issueId };
      });
    },

    async context(user: Member, id: string) {
      return database.transaction(async (transaction) => {
        const task = await taskFor(transaction, user, id, true);
        const project = await projectFor(transaction, user, task.project_id);
        const [goal] = await transaction.query<Goal>("SELECT * FROM goals WHERE id=$1", [project.goal_id]);
        const submissions = await transaction.query<Submission>("SELECT * FROM submissions WHERE task_id=$1 ORDER BY revision DESC", [id]);
        const issues = await transaction.query<Issue>("SELECT * FROM issues WHERE task_id=$1 AND status <> 'resolved'", [id]);
        const members = await transaction.query<Pick<Member, "id" | "name">>("SELECT id,name FROM members WHERE workspace_id=$1 AND id=ANY($2::text[])", [user.workspace_id, [task.assignee_id, task.reviewer_id]]);
        return { generated_at: new Date().toISOString(), source: `/api/tasks/${id}/context`, task_version: task.version, goal, project, task, members, submissions, unresolved_issues: issues };
      });
    },
  };
}
