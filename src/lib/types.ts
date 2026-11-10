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
};

export const statusLabels: Record<TaskStatus, string> = {
  todo: "待开始",
  in_progress: "进行中",
  in_review: "待验收",
  done: "已完成",
};
