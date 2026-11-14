"use client";

import { useState, type FormEvent } from "react";
import { Bot, Copy, Plug, ShieldCheck } from "lucide-react";
import type { Task, Workspace } from "../lib/types";

type Connection = { id: string; token: string; expires_at: string; mcp_config: unknown };
const time = (value: string) => new Date(value).toLocaleString("zh-CN");

export function AgentPanel({ task, workspace, busy, setBusy, refresh }: {
  task: Task; workspace: Workspace; busy: boolean;
  setBusy: (busy: boolean) => void; refresh: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [copied, setCopied] = useState(false);
  const [agentId, setAgentId] = useState("");
  const mine = task.assignee_id === workspace.user.id;
  const agents = workspace.agents.filter((agent) => agent.owner_id === workspace.user.id);
  const grants = workspace.agent_grants.filter((grant) => grant.task_id === task.id);
  const runs = workspace.agent_runs.filter((run) => run.task_id === task.id);
  const agentName = (id: string) => workspace.agents.find((agent) => agent.id === id)?.name || "Agent";
  const labels = { running: "执行中", blocked: "遇到阻塞", submitted: "已提交 · 等待人工验收", stopped: "已停止" };
  async function request<T>(path: string, input: unknown): Promise<T> {
    const response = await fetch(`/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "操作失败，请重试");
    return data;
  }
  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setCopied(false);
    const values = new FormData(event.currentTarget);
    try {
      let id = agentId;
      if (!id) {
        const created = await request<{ id: string }>("agents", { name: values.get("agent_name") });
        id = created.id; setAgentId(id);
      }
      const result = await request<Connection>(`tasks/${task.id}/agent-grants`, { agent_id: id, version: task.version, expires_hours: Number(values.get("hours")) });
      setConnection(result);
      await refresh();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setError("");
    try {
      await request(`agent-grants/${id}/revoke`, {});
      if (connection?.id === id) setConnection(null);
      await refresh();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="detail-section agent-panel">
    <h3><Bot size={16} />Agent 协作</h3>
    <p className="text-small muted">成员负责，Agent 执行，指定验收人确认成果。</p>
    {mine && ["todo", "in_progress"].includes(task.status) && <details className="agent-connect" open={agents.length === 0 && grants.length === 0}>
      <summary><Plug size={14} />连接并授权 Agent</summary>
      <form onSubmit={authorize} className="agent-form">
        <label>选择 Agent<select value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={busy}><option value="">创建新 Agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        {!agentId && <label>Agent 名称<input name="agent_name" placeholder="例如：陈的编码助手" required minLength={2} maxLength={80} disabled={busy} /></label>}
        <label>授权有效期<select name="hours" defaultValue="24" disabled={busy}><option value="1">1 小时</option><option value="24">24 小时</option><option value="168">7 天</option></select></label>
        <p className="form-hint"><ShieldCheck size={13} />仅授权此任务的读取、执行、进展、阻塞和成果提交。不能验收。</p>
        <button className="button secondary full" disabled={busy}>生成连接配置</button>
      </form>
    </details>}
    {connection && <div className="agent-credentials">
      <strong>连接配置仅在本次显示</strong>
      <p className="text-small">复制到本机支持 MCP 的 Agent 工具，保存后关闭此配置。有效期至 {time(connection.expires_at)}。工作台服务需保持运行。</p>
      <textarea aria-label="Agent MCP 连接配置" readOnly value={JSON.stringify(connection.mcp_config, null, 2)} rows={10} spellCheck={false} />
      <div className="issue-actions"><button className="text-button" disabled={busy} onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(connection.mcp_config, null, 2)); setCopied(true); } catch { setError("无法复制，请选中配置手动复制。"); } }}><Copy size={13} />{copied ? "已复制" : "复制配置"}</button><button className="text-button" disabled={busy} onClick={() => setConnection(null)}>关闭并隐藏凭证</button></div>
    </div>}
    {grants.map((grant) => {
      const active = !grant.revoked_at && grant.expires_at > new Date().toISOString();
      return <div className="agent-grant" key={grant.id}>
        <strong>{agentName(grant.agent_id)}</strong><span className="text-small">{grant.revoked_at ? "已撤销" : active ? "已授权" : "已过期"}</span>
        <p className="text-small muted">到期：{time(grant.expires_at)}<br />{grant.last_used_at ? `最近连接：${time(grant.last_used_at)}` : "等待 Agent 首次连接"}</p>
        {active && mine && <button className="text-button" disabled={busy} onClick={() => void revoke(grant.id)}>撤销授权并停止</button>}
      </div>;
    })}
    {mine && grants.some((grant) => !grant.revoked_at && grant.expires_at > new Date().toISOString()) && <p className="form-hint">撤销将阻止后续读取和提交。外部工具中已开始的工作，也需在对应工具中停止。</p>}
    {!grants.length && !mine && <p className="text-small muted">负责人可以为此任务授权自己的 Agent。</p>}
    {!!runs.length && <h4>执行记录</h4>}
    {runs.map((run) => {
      const grant = grants.find((item) => item.id === run.grant_id);
      const expired = (run.status === "running" || run.status === "blocked") && grant && grant.expires_at <= new Date().toISOString();
      const submission = workspace.submissions.find((item) => item.id === run.submission_id);
      const state = run.status === "submitted" && submission?.result === "approved" ? "验收通过" : run.status === "submitted" && submission?.result === "rejected" ? "已退回 · 待修改" : labels[run.status];
      return <details className="agent-run" key={run.id}>
        <summary>{agentName(run.agent_id)} · {expired ? "授权已过期 · 执行中断" : state}</summary>
        <p className="text-small muted">开始：{time(run.started_at)}<br />更新：{time(run.updated_at)}</p>
        {workspace.agent_run_logs.filter((log) => log.run_id === run.id).map((log) => <p className="agent-log prewrap" key={log.id}><span>{time(log.created_at)}</span>{log.message}</p>)}
        {run.submission_id && <p className="text-small">成果已加入下方提交历史。</p>}
      </details>;
    })}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
