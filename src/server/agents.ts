import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Agent, AgentGrant, AgentRun, Member, Task } from "../lib/types";
import type { Database } from "./database";
import { ensure } from "./errors";
import { createService } from "./service";

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const nameInput = z.object({ name: z.string().trim().min(2).max(80) });
const grantInput = z.object({ agent_id: z.string().min(1), version: z.number().int().positive(), expires_hours: z.number().int().min(1).max(168).default(24) });
const versionInput = z.object({ version: z.number().int().positive() });
const progressInput = versionInput.extend({ message: z.string().trim().min(5).max(2000) });

// Reuse the human workflow inside the already-open authorization transaction.
function within(transaction: Database): Database {
  return { ...transaction, transaction: (operation) => operation(transaction) };
}

async function audit(database: Database, user: Member, task: Task, message: string, agentId: string) {
  await database.query("INSERT INTO events (id,project_id,task_id,actor_id,message,created_at,agent_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), task.project_id, task.id, user.id, message, new Date().toISOString(), agentId]);
}

export function createAgentService(database: Database) {
  return {
    async register(user: Member, input: unknown) {
      const { name } = nameInput.parse(input);
      const id = randomUUID();
      await database.query("INSERT INTO agents (id,owner_id,name,created_at) VALUES ($1,$2,$3,$4)", [id, user.id, name, new Date().toISOString()]);
      return { id };
    },

    async grant(user: Member, taskId: string, input: unknown) {
      const data = grantInput.parse(input);
      return database.transaction(async (transaction) => {
        const [task] = await transaction.query<Task>("SELECT t.* FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1 AND p.workspace_id=$2 FOR UPDATE OF t", [taskId, user.workspace_id]);
        ensure(task, 404, "任务不存在或无权访问");
        ensure(task.assignee_id === user.id, 403, "只有负责人可以授权自己的 Agent");
        ensure(task.version === data.version, 409, "任务已更新，请刷新后重新授权");
        ensure(["todo", "in_progress"].includes(task.status), 409, "只有待开始或进行中的任务可以授权");
        const [agent] = await transaction.query<Agent>("SELECT * FROM agents WHERE id=$1 AND owner_id=$2", [data.agent_id, user.id]);
        ensure(agent, 403, "只能授权自己创建的 Agent");
        const token = `csa_${randomBytes(32).toString("hex")}`;
        const id = randomUUID();
        const now = new Date();
        const expires_at = new Date(now.getTime() + data.expires_hours * 3600000).toISOString();
        await transaction.query("INSERT INTO agent_grants (id,agent_id,task_id,granted_by,token_hash,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, agent.id, taskId, user.id, digest(token), expires_at, now.toISOString()]);
        await audit(transaction, user, task, `授权 Agent「${agent.name}」执行此任务`, agent.id);
        return { id, token, expires_at };
      });
    },

    async revoke(user: Member, id: string) {
      return database.transaction(async (transaction) => {
        const [grant] = await transaction.query<AgentGrant>("SELECT * FROM agent_grants WHERE id=$1 AND granted_by=$2 FOR UPDATE", [id, user.id]);
        ensure(grant, 404, "授权不存在或无权撤销");
        const now = new Date().toISOString();
        await transaction.query("UPDATE agent_grants SET revoked_at=COALESCE(revoked_at,$2) WHERE id=$1", [id, now]);
        await transaction.query("UPDATE agent_runs SET status='stopped',updated_at=$2 WHERE grant_id=$1 AND status IN ('running','blocked')", [id, now]);
        const [task] = await transaction.query<Task>("SELECT * FROM tasks WHERE id=$1", [grant.task_id]);
        if (!grant.revoked_at) await audit(transaction, user, task, "撤销 Agent 授权，停止后续访问和提交", grant.agent_id);
        return { id };
      });
    },

    async execute(token: string | undefined, action: string, taskId?: string, input: unknown = {}) {
      ensure(token && /^csa_[a-f0-9]{64}$/.test(token), 401, "请提供有效的 Agent 凭证");
      return database.transaction(async (transaction) => {
        // Serialize use and revocation of the same credential.
        const [grant] = await transaction.query<AgentGrant>("SELECT * FROM agent_grants WHERE token_hash=$1 FOR UPDATE", [digest(token)]);
        const now = new Date().toISOString();
        ensure(grant && !grant.revoked_at && grant.expires_at > now, 401, "Agent 授权已过期或已撤销");
        ensure(!taskId || taskId === grant.task_id, 403, "此凭证只能访问被授权的任务");
        const [task] = await transaction.query<Task>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [grant.task_id]);
        ensure(task && task.assignee_id === grant.granted_by, 403, "任务负责人已变更，请重新授权");
        const [user] = await transaction.query<Member>("SELECT id,workspace_id,name,email,role FROM members WHERE id=$1", [grant.granted_by]);
        const [agent] = await transaction.query<Agent>("SELECT * FROM agents WHERE id=$1 AND owner_id=$2", [grant.agent_id, user.id]);
        ensure(agent, 403, "Agent 所属成员无效");
        await transaction.query("UPDATE agent_grants SET last_used_at=$2 WHERE id=$1", [grant.id, now]);
        const db = within(transaction);
        if (action === "list") return { tasks: [task], agent: { id: agent.id, name: agent.name }, expires_at: grant.expires_at };
        if (action === "context") return createService(db).context(user, task.id);
        const { version } = versionInput.parse(input);
        ensure(task.version === version, 409, "任务已更新，请重新获取上下文后操作");
        ensure(["todo", "in_progress"].includes(task.status), 409, "任务当前不能执行，请等待验收或查看最新状态");
        let run: AgentRun | undefined = (await transaction.query<AgentRun>("SELECT * FROM agent_runs WHERE task_id=$1 AND status IN ('running','blocked') FOR UPDATE", [task.id]))[0];
        // Expired grants cannot keep a task permanently occupied.
        if (run && run.grant_id !== grant.id) {
          const [active] = await transaction.query<AgentGrant>("SELECT id FROM agent_grants WHERE id=$1 AND revoked_at IS NULL AND expires_at>$2", [run.grant_id, now]);
          ensure(!active, 409, "此任务已有 Agent 正在执行，请先撤销原授权");
          await transaction.query("UPDATE agent_runs SET status='stopped',updated_at=$2 WHERE id=$1", [run.id, now]);
          run = undefined;
        }
        if (action === "start") {
          const [issue] = await transaction.query("SELECT id FROM issues WHERE task_id=$1 AND status<>'resolved'", [task.id]);
          ensure(!issue, 409, "请先由负责人确认解除阻塞");
          if (!run) {
            const id = randomUUID();
            [run] = await transaction.query<AgentRun>("INSERT INTO agent_runs (id,grant_id,agent_id,task_id,status,started_at,updated_at) VALUES ($1,$2,$3,$4,'running',$5,$5) RETURNING *", [id, grant.id, agent.id, task.id, now]);
          } else await transaction.query("UPDATE agent_runs SET status='running',updated_at=$2 WHERE id=$1", [run.id, now]);
          const service = createService(db, { id: agent.id, name: agent.name, run_id: run.id });
          if (task.status === "todo") await service.start(user, task.id, { version });
          await audit(transaction, user, task, `Agent「${agent.name}」已连接并开始执行`, agent.id);
          return { run_id: run.id, task_version: task.status === "todo" ? version + 1 : version };
        }
        ensure(run && run.grant_id === grant.id, 409, "请先调用 start_task 开始执行");
        const service = createService(db, { id: agent.id, name: agent.name, run_id: run.id });
        if (action === "progress") {
          const { message } = progressInput.parse(input);
          await transaction.query("INSERT INTO agent_run_logs (id,run_id,message,created_at) VALUES ($1,$2,$3,$4)", [randomUUID(), run.id, message, now]);
          await transaction.query("UPDATE agent_runs SET updated_at=$2 WHERE id=$1", [run.id, now]);
          return { run_id: run.id, task_version: version };
        }
        if (action === "issues") {
          const result = await service.reportIssue(user, task.id, input);
          await transaction.query("UPDATE agent_runs SET status='blocked',updated_at=$2 WHERE id=$1", [run.id, now]);
          return { ...result, run_id: run.id, task_version: version + 1 };
        }
        if (action === "submissions") {
          const result = await service.submit(user, task.id, input);
          await transaction.query("UPDATE agent_runs SET status='submitted',submission_id=$2,updated_at=$3 WHERE id=$1", [run.id, result.id, now]);
          return { ...result, run_id: run.id, task_version: version + 1 };
        }
        ensure(false, 404, "Agent 操作不存在");
      });
    },
  };
}
