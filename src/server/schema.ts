export const schema = `
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','member'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  expires_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  email text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  reset_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS goals (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  title text NOT NULL,
  success_criteria text NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  goal_id text NOT NULL REFERENCES goals(id),
  title text NOT NULL,
  description text NOT NULL,
  owner_id text NOT NULL REFERENCES members(id),
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  title text NOT NULL,
  description text NOT NULL,
  acceptance_criteria text NOT NULL,
  assignee_id text NOT NULL REFERENCES members(id),
  reviewer_id text NOT NULL REFERENCES members(id),
  status text NOT NULL CHECK (status IN ('todo','in_progress','in_review','done')),
  version integer NOT NULL DEFAULT 1,
  due_date text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CHECK (assignee_id <> reviewer_id)
);
CREATE TABLE IF NOT EXISTS submissions (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  revision integer NOT NULL,
  author_id text NOT NULL REFERENCES members(id),
  url text NOT NULL,
  artifact_version text NOT NULL,
  summary text NOT NULL,
  result text NOT NULL CHECK (result IN ('pending','approved','rejected')),
  review_note text,
  reviewed_by text REFERENCES members(id),
  reviewed_at text,
  created_at text NOT NULL,
  UNIQUE (task_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_submission ON submissions(task_id) WHERE result = 'pending';
CREATE TABLE IF NOT EXISTS issues (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  title text NOT NULL,
  helper_id text NOT NULL REFERENCES members(id),
  reported_by text NOT NULL REFERENCES members(id),
  status text NOT NULL CHECK (status IN ('open','proposed','resolved')),
  resolution text,
  resolved_by text REFERENCES members(id),
  created_at text NOT NULL,
  resolved_at text
);
CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  task_id text NOT NULL REFERENCES tasks(id),
  submission_id text NOT NULL UNIQUE REFERENCES submissions(id),
  title text NOT NULL,
  url text NOT NULL,
  artifact_version text NOT NULL,
  maintainer_id text NOT NULL REFERENCES members(id),
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  task_id text REFERENCES tasks(id),
  actor_id text NOT NULL REFERENCES members(id),
  message text NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS submissions_task ON submissions(task_id);
CREATE INDEX IF NOT EXISTS issues_task ON issues(task_id);
CREATE INDEX IF NOT EXISTS events_project ON events(project_id, created_at);
CREATE INDEX IF NOT EXISTS projects_workspace ON projects(workspace_id);
CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES members(id),
  name text NOT NULL,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_grants (
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id),
  task_id text NOT NULL REFERENCES tasks(id),
  granted_by text NOT NULL REFERENCES members(id),
  token_hash text NOT NULL UNIQUE,
  expires_at text NOT NULL,
  revoked_at text,
  last_used_at text,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id text PRIMARY KEY,
  grant_id text NOT NULL REFERENCES agent_grants(id),
  agent_id text NOT NULL REFERENCES agents(id),
  task_id text NOT NULL REFERENCES tasks(id),
  status text NOT NULL CHECK (status IN ('running','blocked','submitted','stopped')),
  submission_id text REFERENCES submissions(id),
  started_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_agent_run ON agent_runs(task_id) WHERE status IN ('running','blocked');
CREATE TABLE IF NOT EXISTS agent_run_logs (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_runs(id),
  message text NOT NULL,
  created_at text NOT NULL
);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS agent_id text REFERENCES agents(id);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS agent_run_id text REFERENCES agent_runs(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS agent_id text REFERENCES agents(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS agent_run_id text REFERENCES agent_runs(id);
CREATE INDEX IF NOT EXISTS agent_grants_task ON agent_grants(task_id);
CREATE INDEX IF NOT EXISTS agent_runs_task ON agent_runs(task_id);
`;
