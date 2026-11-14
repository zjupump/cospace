export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";

export type Member = {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  role: "owner" | "member";
};

export type Goal = {
  id: string;
  workspace_id: string;
  title: string;
  success_criteria: string;
};

export type Project = {
  id: string;
  workspace_id: string;
  goal_id: string;
  title: string;
  description: string;
  owner_id: string;
  created_at: string;
};

export type Task = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  acceptance_criteria: string;
  assignee_id: string;
  reviewer_id: string;
  status: TaskStatus;
  version: number;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

export type Submission = {
  id: string;
  task_id: string;
  revision: number;
  author_id: string;
  agent_id?: string | null;
  agent_run_id?: string | null;
  url: string;
  artifact_version: string;
  summary: string;
  result: "pending" | "approved" | "rejected";
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type Issue = {
  id: string;
  task_id: string;
  title: string;
  helper_id: string;
  reported_by: string;
  status: "open" | "proposed" | "resolved";
  resolution: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type Asset = {
  id: string;
  project_id: string;
  task_id: string;
  submission_id: string;
  title: string;
  url: string;
  artifact_version: string;
  maintainer_id: string;
  created_at: string;
};

export type Activity = {
  id: string;
  project_id: string;
  task_id: string | null;
  actor_id: string;
  message: string;
  created_at: string;
};

export type Workspace = {
  user: Member;
  members: Member[];
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  submissions: Submission[];
  issues: Issue[];
  assets: Asset[];
  events: Activity[];
  agents: Agent[];
  agent_grants: AgentGrant[];
  agent_runs: AgentRun[];
  agent_run_logs: AgentRunLog[];
};

export type Agent = { id: string; owner_id: string; name: string; created_at: string };
export type AgentGrant = {
  id: string; agent_id: string; task_id: string; granted_by: string;
  expires_at: string; revoked_at: string | null; last_used_at: string | null; created_at: string;
};
export type AgentRun = {
  id: string; grant_id: string; agent_id: string; task_id: string;
  status: "running" | "blocked" | "submitted" | "stopped";
  submission_id: string | null; started_at: string; updated_at: string;
};
export type AgentRunLog = { id: string; run_id: string; message: string; created_at: string };

export const statusLabels: Record<TaskStatus, string> = {
  todo: "待开始",
  in_progress: "进行中",
  in_review: "待验收",
  done: "已完成",
};
