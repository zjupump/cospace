import type { Database } from "./database";
import { hashPassword } from "./passwords";

export async function seed(database: Database, demo: boolean) {
  const existing = await database.query<{ id: string }>("SELECT id FROM workspaces LIMIT 1");
  if (existing.length) return;
  const password = demo ? process.env.COSPACE_DEMO_PASSWORD || "cospace-local-2026" : process.env.COSPACE_ADMIN_PASSWORD;
  const email = demo ? "lin@cospace.local" : process.env.COSPACE_ADMIN_EMAIL?.trim().toLowerCase();
  const name = demo ? "林" : process.env.COSPACE_ADMIN_NAME;
  if (!password || password.length < 12 || !email || !name) {
    throw new Error("首次启动请配置管理员邮箱、姓名与至少 12 位密码，或显式启用本地演示模式。请参考 .env.example。");
  }
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  await database.transaction(async (transaction) => {
    await transaction.query("INSERT INTO workspaces (id,name) VALUES ('workspace-main','产品小队') ON CONFLICT DO NOTHING");
    const members = demo ? [
      ["member-lin", "林", "lin@cospace.local", "owner"],
      ["member-chen", "陈", "chen@cospace.local", "member"],
      ["member-zhou", "周", "zhou@cospace.local", "member"],
    ] : [["member-lin", name, email, "owner"]];
    for (const [id, memberName, memberEmail, role] of members) {
      await transaction.query("INSERT INTO members (id,workspace_id,name,email,password_hash,role) VALUES ($1,'workspace-main',$2,$3,$4,$5) ON CONFLICT DO NOTHING", [id, memberName, memberEmail, passwordHash, role]);
    }
    await transaction.query("INSERT INTO goals (id,workspace_id,title,success_criteria) VALUES ('goal-main','workspace-main',$1,$2) ON CONFLICT DO NOTHING", ["用 CoSpace 跑完一个真实项目", "成员能够独立接手任务、提交成果并完成验收；交接无需口头补充关键背景。"]);
    if (!demo) return;
    await transaction.query("INSERT INTO projects (id,workspace_id,goal_id,title,description,owner_id,created_at) VALUES ('project-mvp','workspace-main','goal-main',$1,$2,'member-lin',$3) ON CONFLICT DO NOTHING", ["CoSpace 内部试用", "将目标、任务、问题和成果串联起来，完成第一次真实协作。", now]);
    const tasks = [
      ["task-review", "任务详情与交接入口", "整理任务目标、材料与最新成果，让接手者找到下一步。", "交接包包含目标、验收标准、成果版本和未决问题。", "member-chen", "member-lin", "in_review"],
      ["task-blocked", "真实项目端到端试跑", "使用成员与验收人账号跑通一次交付。", "任务提交、退回、再次提交、通过均保留完整记录。", "member-zhou", "member-lin", "in_progress"],
      ["task-feedback", "整理首轮试用反馈", "汇总团队使用过程中的困难，并提出下一轮改进建议。", "每项问题包含复现步骤、影响与优先级，并区分事实和假设。", "member-lin", "member-zhou", "todo"],
    ];
    for (const task of tasks) {
      await transaction.query("INSERT INTO tasks (id,project_id,title,description,acceptance_criteria,assignee_id,reviewer_id,status,version,created_at,updated_at) VALUES ($1,'project-mvp',$2,$3,$4,$5,$6,$7,1,$8,$8) ON CONFLICT DO NOTHING", [...task, now]);
    }
    await transaction.query("INSERT INTO submissions (id,task_id,revision,author_id,url,artifact_version,summary,result,created_at) VALUES ('submission-demo','task-review',1,'member-chen',$1,'demo-v1',$2,'pending',$3) ON CONFLICT DO NOTHING", ["https://example.com/cospace-demo", "演示提交：用于体验验收流程，链接为占位地址，不代表真实交付。", now]);
    await transaction.query("INSERT INTO issues (id,task_id,title,helper_id,reported_by,status,created_at) VALUES ('issue-accounts','task-blocked','请确认试跑账号和验收分工','member-lin','member-zhou','open',$1) ON CONFLICT DO NOTHING", [now]);
    await transaction.query("INSERT INTO events (id,project_id,task_id,actor_id,message,created_at) VALUES ('event-demo','project-mvp','task-review','member-chen','提交了第 1 版成果，等待验收',$1) ON CONFLICT DO NOTHING", [now]);
  });
}
