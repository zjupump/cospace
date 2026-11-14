"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronRight, Circle, CircleCheck, CircleDot, Clock3, Copy, FileCheck2, FileText, Flag, FolderKanban, Layers3, LayoutDashboard, Library, LoaderCircle, LogOut, MessageSquareText, Plus, RefreshCw, Search, ShieldCheck, Sparkles, TriangleAlert, Users, X } from "lucide-react";
import { AgentPanel } from "./agent-panel";
import { statusLabels, type Issue, type Task, type Workspace } from "../lib/types";

type Page = "team" | "mine" | "projects" | "assets";
type ModalKind = "project" | "task" | "submit" | "approve" | "reject" | "issue" | "propose" | "resolve" | "context";
type ModalState = { kind: ModalKind; task?: Task; issue?: Issue; context?: string };

class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new RequestError(data.error || "请求未成功，请稍后重试", response.status);
  return data as T;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return <span className={`avatar ${small ? "avatar-small" : ""}`}>{name.slice(0, 1)}</span>;
}

function Status({ task, blocked = false }: { task: Task; blocked?: boolean }) {
  const Icon = task.status === "done" ? CircleCheck : task.status === "in_review" ? FileCheck2 : task.status === "in_progress" ? CircleDot : Circle;
  return <span className={`status status-${task.status}`}><Icon size={13} />{statusLabels[task.status]}{blocked && <span className="blocked-dot" title="存在未解除的阻塞" />}</span>;
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><Layers3 size={28} strokeWidth={1.5} /><h3>{title}</h3><p>{children}</p></div>;
}

function Dialog({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose: () => void; busy: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="dialog" aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-head"><div><span className="eyebrow">COSPACE / WORKFLOW</span><h2 id="dialog-title">{title}</h2></div><button className="icon-button" aria-label="关闭弹窗" disabled={busy} onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}

function Login({ demo, onLogin }: { demo: boolean; onLogin: () => Promise<void> }) {
  const [email, setEmail] = useState(demo ? "lin@cospace.local" : "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("auth/login", { email, password }); await onLogin(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="login-page">
    <section className="login-story"><div className="brand"><span className="brand-mark">co</span>CoSpace<span className="brand-dot">.</span></div><div className="login-copy"><span className="eyebrow">A SHARED SPACE TO MOVE FORWARD</span><h1>共同的目标。<br />接得上的下一步。</h1><p>让每一次进展都有出处，<br />让每一份成果都有下一位接手的人。</p><div className="flow-illustration"><div><Flag size={21} /><span>明确目标</span></div><ArrowRight size={17} /><div><Users size={21} /><span>协作推进</span></div><ArrowRight size={17} /><div><CheckCheck size={21} /><span>验收沉淀</span></div></div></div><span className="login-foot">为小团队和各自的 Agent，准备同一份工作上下文。</span></section>
    <section className="login-form-wrap"><form onSubmit={submit} className="login-form"><span className="kicker">WELCOME TO YOUR WORKSPACE</span><h2>回到协作发生的地方</h2><p className="muted">登录后，继续推进团队的下一步。</p>
      {demo && <div className="demo-note"><Sparkles size={16} /><div><strong>本地试跑工作区</strong><p>林负责验收，陈与周参与执行。数据会保存在本机服务端。</p></div></div>}
      {demo && <div className="account-picks" aria-label="选择演示账号">{[["林", "lin"], ["陈", "chen"], ["周", "zhou"]].map(([name, account]) => <button type="button" key={account} className={email === `${account}@cospace.local` ? "selected" : ""} aria-pressed={email === `${account}@cospace.local`} onClick={() => setEmail(`${account}@cospace.local`)}><Avatar name={name} small />{name}</button>)}</div>}
      <label>邮箱<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>密码<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入工作区密码" /></label>
      {demo && <p className="form-hint">默认演示密码：<code>cospace-local-2026</code><br />如已配置自定义密码，请使用配置值。</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="button primary login-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}进入工作区</button>
      <div className="login-security"><ShieldCheck size={14} />独立会话 · 服务端权限校验 · 提交版本留痕</div>
    </form></section>
  </div>;
}

export function Workbench({ demo }: { demo: boolean }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [page, setPage] = useState<Page>("team");
  const [projectId, setProjectId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    try {
      const data = await api<Workspace>("workspace");
      setWorkspace(data); setLoadError("");
      setProjectId((current) => data.projects.some((project) => project.id === current) ? current : data.projects[0]?.id || "");
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) { setWorkspace(null); setModal(null); }
      else { setLoadError((error as Error).message); throw error; }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh().catch(() => {}); }, [refresh]);
  useEffect(() => {
    if (!workspace || modal || busy) return;
    const update = () => { if (document.visibilityState === "visible") void refresh().catch(() => {}); };
    const timer = window.setInterval(update, 30000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [!!workspace, modal, busy, refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function open(next: ModalState) { setFormError(""); setModal(next); }
  function navigate(next: Page) { setPage(next); setFilter("all"); setQuery(""); }

  async function perform(path: string, body: unknown, message: string) {
    setBusy(true); setFormError("");
    try {
      const result = await api<{ id: string }>(path, body);
      setModal(null); setNotice(message);
      if (path === "tasks") { setSelectedId(result.id); setProjectId((body as { project_id: string }).project_id); setFilter("all"); setQuery(""); setPage("projects"); }
      if (path === "projects") { setProjectId(result.id); setPage("projects"); }
      await refresh();
    } catch (error) {
      const message = (error as Error).message;
      setFormError(message);
      if (!modal) setNotice(message);
      if (error instanceof RequestError && error.status === 401) { setWorkspace(null); setModal(null); }
    } finally { setBusy(false); }
  }

  async function context(task: Task) {
    setBusy(true);
    try {
      const result = await api<unknown>(`tasks/${task.id}/context`);
      open({ kind: "context", task, context: JSON.stringify(result, null, 2) });
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="loading"><div className="brand-mark">co</div><LoaderCircle className="spin" size={22} /><p>正在打开共享工作区…</p></div>;
  if (!workspace) return <>{loadError && <div className="startup-error" role="alert">{loadError}<button onClick={() => void refresh().catch(() => {})}>重试连接</button></div>}<Login demo={demo} onLogin={refresh} /></>;

  const { user, members, projects, tasks, submissions, issues, goals, assets, events } = workspace;
  const memberName = (id: string) => members.find((member) => member.id === id)?.name || "成员";
  const unresolved = issues.filter((issue) => issue.status !== "resolved");
  const isBlocked = (id: string) => unresolved.some((issue) => issue.task_id === id);
  const isMine = (task: Task) => task.assignee_id === user.id || (task.reviewer_id === user.id && task.status === "in_review") || unresolved.some((issue) => issue.task_id === task.id && issue.helper_id === user.id);
  const pendingReview = tasks.filter((task) => task.status === "in_review" && task.reviewer_id === user.id).length;
  const assistance = unresolved.filter((issue) => issue.helper_id === user.id).length;
  const activeMine = tasks.filter((task) => task.assignee_id === user.id && ["todo", "in_progress"].includes(task.status)).length;
  const activeProject = projects.find((project) => project.id === projectId);
  const goal = goals.find((item) => item.id === activeProject?.goal_id) || goals[0];
  const scopedTasks = tasks.filter((task) => (page !== "projects" || task.project_id === projectId) && (page !== "mine" || isMine(task)));
  const matchesFilter = (task: Task) => {
    if (filter === "all") return true;
    if (filter === "blocked") return isBlocked(task.id);
    if (filter === "needs_review") return task.status === "in_review" && task.reviewer_id === user.id;
    if (filter === "needs_help") return unresolved.some((issue) => issue.task_id === task.id && issue.helper_id === user.id);
    if (filter === "active") return task.assignee_id === user.id && ["todo", "in_progress"].includes(task.status);
    return task.status === filter;
  };
  const visibleTasks = scopedTasks.filter((task) =>
    matchesFilter(task) &&
    `${task.title} ${task.description} ${memberName(task.assignee_id)}`.toLowerCase().includes(query.toLowerCase()),
  ).sort((first, second) => {
    const score = (task: Task) => task.status === "in_review" && task.reviewer_id === user.id ? 0 : isBlocked(task.id) ? 1 : task.status === "done" ? 4 : task.assignee_id === user.id ? 2 : 3;
    return score(first) - score(second);
  });
  const selected = visibleTasks.find((task) => task.id === selectedId) || visibleTasks[0];
  const selectedSubmissions = submissions.filter((submission) => submission.task_id === selected?.id);
  const selectedIssues = issues.filter((issue) => issue.task_id === selected?.id);
  const selectedProject = projects.find((project) => project.id === selected?.project_id);
  const complete = scopedTasks.filter((task) => task.status === "done").length;
  const titles: Record<Page, [string, string]> = {
    team: ["把下一步推进起来", "目标、进展与成果，在这里连成一条线。"],
    mine: [`${user.name}，从这里继续`, "你的执行任务、待验收成果和协助事项。"],
    projects: [activeProject?.title || "每个想法，从一个项目开始", activeProject?.description || "创建项目，把目标拆成可以交付的工作。"],
    assets: ["让成果，成为新的起点", "已验收的交付物，带着版本与上下文留在团队里。"],
  };
  const modalTitles: Record<ModalKind, string> = { project: "创建一个项目", task: "定义下一项工作", submit: "提交成果，发起验收", approve: "确认验收通过", reject: "退回并说明改进要求", issue: "报告阻塞，找到协助人", propose: "记录解决方案", resolve: "确认可以继续推进", context: "交接上下文" };

  async function submitModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const version = modal.task?.version;
    const taskId = modal.task?.id;
    if (modal.kind === "project") await perform("projects", values, "项目已创建，现在可以拆解第一项任务。");
    if (modal.kind === "task") await perform("tasks", { ...values, due_date: values.due_date || null }, "任务已创建，负责人和验收要求已同步。");
    if (modal.kind === "submit") await perform(`tasks/${taskId}/submissions`, { ...values, version }, "成果已提交，正在等待验收。");
    if (modal.kind === "approve" || modal.kind === "reject") await perform(`tasks/${taskId}/review`, { version, note: values.note, decision: modal.kind === "approve" ? "approved" : "rejected", collect_asset: values.collect_asset === "on" }, modal.kind === "approve" ? "验收通过，任务完成情况已更新。" : "已退回，意见和提交版本均已保留。");
    if (modal.kind === "issue") await perform(`tasks/${taskId}/issues`, { ...values, version }, "阻塞已记录，已进入协助人的工作队列。");
    if (modal.kind === "propose" || modal.kind === "resolve") await perform(`issues/${modal.issue?.id}/${modal.kind}`, { ...values, version }, modal.kind === "propose" ? "解决方案已记录，等待任务负责人确认。" : "阻塞已解除，可以继续推进。");
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="CoSpace 首页"><span className="brand-mark">co</span>CoSpace<span className="brand-dot">.</span></a>
      <div className="workspace-identity"><span className="workspace-icon"><Users size={17} /></span><div><strong>产品小队</strong><span>{members.length} 位成员 · 共享工作区</span></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="主导航">{([["team", LayoutDashboard, "团队总览"], ["mine", CircleCheck, "我的工作"], ["projects", FolderKanban, "项目"], ["assets", Library, "资产中心"]] as const).map(([key, Icon, label]) => <button key={key} className={`nav-item ${page === key ? "active" : ""}`} onClick={() => navigate(key)} aria-current={page === key ? "page" : undefined}><Icon size={18} /><span>{label}</span>{key === "mine" && pendingReview > 0 && <span className="nav-count">{pendingReview}</span>}</button>)}</nav>
      <div className="nav-label project-nav-title">正在推进<button aria-label="创建项目" className="sidebar-icon" onClick={() => open({ kind: "project" })}><Plus size={15} /></button></div>
      <div className="project-nav">{projects.map((project) => <button key={project.id} className={page === "projects" && projectId === project.id ? "chosen" : ""} onClick={() => { setProjectId(project.id); navigate("projects"); }}><span className="project-dot" />{project.title}</button>)}{projects.length === 0 && <span className="sidebar-hint">从第一个项目开始</span>}</div>
      <div className="sidebar-bottom"><div className="shared-note"><span className="live-dot" />共享状态已连接<span>每 30 秒同步</span></div><div className="user-row"><Avatar name={user.name} /><div><strong>{user.name}</strong><span>{user.role === "owner" ? "工作区负责人" : "团队成员"}</span></div><button className="sidebar-icon" aria-label="退出登录" disabled={busy} onClick={async () => { try { await api("auth/logout", {}); setWorkspace(null); } catch (error) { setNotice((error as Error).message); } }}><LogOut size={17} /></button></div></div>
    </aside>

    <div className="app-main">
      <header className="topbar"><div className="breadcrumbs">产品小队<ChevronRight size={13} /><span>{page === "team" ? "团队总览" : page === "mine" ? "我的工作" : page === "projects" ? "项目" : "资产中心"}</span></div><div className="topbar-right">{demo && <span className="demo-pill">本地试跑</span>}<button className="icon-button" aria-label="刷新共享状态" disabled={busy} onClick={() => void refresh().then(() => setNotice("已同步最新共享状态")).catch(() => {})}><RefreshCw size={16} /></button><span className="topbar-divider" /><Avatar name={user.name} small /><button className="icon-button mobile-logout" aria-label="退出登录" disabled={busy} onClick={async () => { try { await api("auth/logout", {}); setWorkspace(null); } catch (error) { setNotice((error as Error).message); } }}><LogOut size={16} /></button></div></header>
      <main className="page-content">
        <div className="page-heading"><div><div className="eyebrow">{page === "team" ? "THE TEAM, IN SYNC" : page === "mine" ? "YOUR NEXT MOVE" : page === "projects" ? "FROM INTENT TO IMPACT" : "BUILT ON WHAT WE KNOW"}</div><h1>{titles[page][0]}</h1><p>{titles[page][1]}</p></div><div className="heading-actions">{page === "projects" && <button className="button secondary" onClick={() => open({ kind: "project" })}><Plus size={16} />新建项目</button>}{page !== "assets" && <button className="button primary" onClick={() => open({ kind: projects.length ? "task" : "project" })}><Plus size={17} />{projects.length ? "新建任务" : "创建项目"}</button>}</div></div>
        {loadError && <div className="error banner" role="alert">{loadError} · 页面保留上次读取结果，请刷新重试。</div>}
        {page !== "assets" && page !== "mine" && goal && <section className="goal-banner"><div className="goal-icon"><Flag size={21} /></div><div className="goal-copy"><span className="kicker">共同目标</span><h2>{goal.title}</h2><p>{goal.success_criteria}</p></div><span className="goal-state"><span />成效待验证</span></section>}
        {(page === "team" || page === "mine") && <div className="action-stats"><button onClick={() => { navigate("mine"); setFilter("needs_review"); }}><div><span>待我验收</span><strong>{String(pendingReview).padStart(2, "0")}</strong></div><FileCheck2 size={23} /><span className="stat-footer">让成果进入下一步<ArrowUpRight size={14} /></span></button><button onClick={() => { navigate("mine"); setFilter("needs_help"); }}><div><span>需要我协助</span><strong>{String(assistance).padStart(2, "0")}</strong></div><TriangleAlert size={23} /><span className="stat-footer">解除协作中的阻塞<ArrowUpRight size={14} /></span></button><button onClick={() => { navigate("mine"); setFilter("active"); }}><div><span>我的待推进任务</span><strong>{String(activeMine).padStart(2, "0")}</strong></div><CircleDot size={23} /><span className="stat-footer">继续执行与尚未开始的工作<ArrowUpRight size={14} /></span></button></div>}

        {page === "assets" ? <section className="assets-section"><div className="section-heading"><h2>团队资产 <span>{assets.length}</span></h2><span className="muted text-small">收录于验收通过时</span></div>{assets.length === 0 ? <Empty title="第一份可复用的成果，等你收录">验收通过时勾选“收录为团队资产”，成果与版本将出现在这里。</Empty> : <div className="asset-grid">{assets.map((asset) => <article className="asset-card" key={asset.id}><div className="asset-card-top"><span className="asset-icon"><FileText size={23} /></span><span className="status status-done"><Check size={12} />已验收</span></div><h3>{asset.title}</h3><p>{projects.find((project) => project.id === asset.project_id)?.title}</p><div className="asset-meta"><span>版本 <strong>{asset.artifact_version}</strong></span><span>维护人 {memberName(asset.maintainer_id)}</span></div><div className="asset-card-bottom"><button className="text-button" onClick={() => { setProjectId(asset.project_id); setSelectedId(asset.task_id); navigate("projects"); }}>查看来源任务<ChevronRight size={13} /></button><a href={asset.url} target="_blank" rel="noopener noreferrer">打开成果<ArrowUpRight size={15} /></a></div></article>)}</div>}<div className="asset-footnote"><ShieldCheck size={15} />这里记录验收时的成果版本；外部原文件后续变更需重新确认。</div></section> : <div className="work-grid">
          <section className="work-list">
            <div className="section-heading"><h2>{page === "projects" ? "项目任务" : "需要推进的工作"}<span>{scopedTasks.length}</span></h2>{page === "projects" && <select aria-label="选择项目" className="project-select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select>}</div>
            <div className="list-toolbar"><div className="filter-tabs" aria-label="任务筛选">{[["all", "全部"], ["in_review", "待验收"], ["blocked", "阻塞"], ["done", "已完成"]].map(([value, label]) => <button key={value} className={filter === value ? "selected" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}{["needs_review", "needs_help", "active"].includes(filter) && <button className="selected" aria-pressed="true" onClick={() => setFilter("all")}>{filter === "needs_review" ? "待我验收" : filter === "needs_help" ? "我来协助" : "我的待推进"} ×</button>}</div><label className="search"><Search size={15} /><input aria-label="搜索任务或负责人" placeholder="查找任务" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
            <div className="task-list">{visibleTasks.length === 0 ? <Empty title={tasks.length ? "这里暂时没有待处理的工作" : "把第一步，变成一项任务"}>{tasks.length ? "试试其他筛选条件，或创建下一项工作。" : "写清负责人、输入背景和验收标准，就可以开始协作。"}</Empty> : visibleTasks.map((task) => <button key={task.id} className={`task-card ${selected?.id === task.id ? "selected" : ""}`} onClick={() => setSelectedId(task.id)} aria-pressed={selected?.id === task.id}><div className="task-card-header"><Status task={task} blocked={isBlocked(task.id)} /><span className="task-project">{projects.find((project) => project.id === task.project_id)?.title}</span></div><h3>{task.title}</h3><p>{isBlocked(task.id) ? unresolved.find((issue) => issue.task_id === task.id)?.title : task.status === "in_review" ? `成果已提交，等待${memberName(task.reviewer_id)}验收` : task.description}</p><div className="task-card-footer"><span><Avatar name={memberName(task.assignee_id)} small />{memberName(task.assignee_id)}<span className="role-separator">→</span>{memberName(task.reviewer_id)}验收</span>{isBlocked(task.id) ? <span className="warning-text"><TriangleAlert size={13} />待解除阻塞</span> : task.due_date ? <span><Clock3 size={12} />{task.due_date.slice(5)}</span> : <span className="muted">v{task.version}</span>}</div></button>)}</div>
            <section className="project-health"><div className="section-heading"><h2>交付情况</h2><span className={scopedTasks.some((task) => isBlocked(task.id)) ? "health-risk" : "health-normal"}>{scopedTasks.some((task) => isBlocked(task.id)) ? "存在阻塞" : "暂无已报告阻塞"}</span></div><div className="delivery-numbers"><strong>{complete}<span> / {scopedTasks.length}</span></strong><span>项任务已验收</span></div><div className="progress-track" role="progressbar" aria-label="任务验收比例" aria-valuenow={scopedTasks.length ? Math.round(complete / scopedTasks.length * 100) : 0} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${scopedTasks.length ? complete / scopedTasks.length * 100 : 0}%` }} /></div><p className="text-small muted">自动依据任务验收记录统计，目标成效另行验证。</p></section>
            <section className="activity-section"><div className="section-heading"><h2>最近发生</h2><span className="text-small muted">留下一点进展</span></div>{events.filter((item) => page !== "projects" || item.project_id === projectId).slice(0, 5).map((item) => <div className="activity" key={item.id}><Avatar name={memberName(item.actor_id)} small /><div><p><strong>{memberName(item.actor_id)}</strong> {item.message}</p><span>{dateTime(item.created_at)}</span></div></div>)}{events.length === 0 && <p className="muted text-small">第一次工作更新会出现在这里。</p>}</section>
          </section>

          {selected ? <aside className="task-detail" aria-label={`任务详情：${selected.title}`}><div className="detail-eyebrow"><span>任务详情</span><span>v{selected.version}</span></div><div className="detail-title"><Status task={selected} blocked={isBlocked(selected.id)} /><h2>{selected.title}</h2><p>{selectedProject?.title}</p></div><div className="people-grid"><div><span className="label">负责人</span><div><Avatar name={memberName(selected.assignee_id)} small />{memberName(selected.assignee_id)}</div></div><div><span className="label">验收人</span><div><Avatar name={memberName(selected.reviewer_id)} small />{memberName(selected.reviewer_id)}</div></div></div>
            <div className="detail-section"><h3><Flag size={15} />任务背景</h3><p className="prewrap">{selected.description}</p></div><div className="detail-section acceptance"><h3><CheckCheck size={16} />怎样算完成</h3><p className="prewrap">{selected.acceptance_criteria}</p></div>
            <AgentPanel key={selected.id} task={selected} workspace={workspace} busy={busy} setBusy={setBusy} refresh={refresh} />
            {selectedIssues.length > 0 && <div className="detail-section"><h3><TriangleAlert size={15} />问题与阻塞</h3>{selectedIssues.map((issue) => <div className={`issue-box ${issue.status === "resolved" ? "resolved" : ""}`} key={issue.id}><div className="issue-label">{issue.status === "resolved" ? "已解除" : issue.status === "proposed" ? "方案已提出 · 待确认" : "待协助"}</div><strong>{issue.title}</strong><p>协助人：{memberName(issue.helper_id)}</p>{issue.resolution && <p className="prewrap">{issue.resolution}</p>}{issue.status !== "resolved" && <div className="issue-actions">{(user.id === issue.helper_id || user.id === selected.assignee_id) && <button className="text-button" disabled={busy} onClick={() => open({ kind: "propose", task: selected, issue })}>记录方案</button>}{user.id === selected.assignee_id && <button className="text-button" disabled={busy} onClick={() => open({ kind: "resolve", task: selected, issue })}>确认解除<Check size={13} /></button>}</div>}</div>)}</div>}
            <div className="detail-section"><h3><FileText size={15} />成果与验收历史<span className="inline-count">{selectedSubmissions.length}</span></h3>{selectedSubmissions.length === 0 ? <p className="muted text-small">成果提交后，版本和验收意见会保留在这里。</p> : selectedSubmissions.map((submission) => <article className="submission" key={submission.id}><div className="submission-heading"><strong>第 {submission.revision} 次提交</strong><span className={`review-result ${submission.result}`}>{submission.result === "approved" ? "通过" : submission.result === "rejected" ? "已退回" : "待验收"}</span></div><p className="prewrap">{submission.summary}</p><a className="artifact-link" href={submission.url} target="_blank" rel="noopener noreferrer"><FileText size={14} /><span>{submission.artifact_version}</span><ArrowUpRight size={14} /></a>{submission.review_note && <div className="review-note"><MessageSquareText size={14} /><p className="prewrap">{memberName(submission.reviewed_by || "")}：{submission.review_note}</p></div>}<span className="text-small muted">{memberName(submission.author_id)}{submission.agent_id ? ` · ${workspace.agents.find((agent) => agent.id === submission.agent_id)?.name || "Agent"} 代为提交` : ""} · {dateTime(submission.created_at)}</span></article>)}</div>
            <div className="detail-actions"><button className="button secondary full" disabled={busy} onClick={() => void context(selected)}><Copy size={15} />获取交接上下文</button>{selected.assignee_id === user.id && selected.status === "todo" && <button className="button primary full" disabled={busy} onClick={() => void perform(`tasks/${selected.id}/start`, { version: selected.version }, "已开始执行任务。 ")}><ArrowRight size={15} />开始执行</button>}{selected.assignee_id === user.id && selected.status === "in_progress" && <button className="button primary full" disabled={busy || isBlocked(selected.id)} onClick={() => open({ kind: "submit", task: selected })}><ArrowUpRight size={16} />提交成果</button>}{selected.reviewer_id === user.id && selected.status === "in_review" && <div className="review-buttons"><button className="button secondary" disabled={busy} onClick={() => open({ kind: "reject", task: selected })}>退回修改</button><button className="button primary" disabled={busy || isBlocked(selected.id)} onClick={() => open({ kind: "approve", task: selected })}><Check size={15} />验收通过</button></div>}{selected.assignee_id === user.id && selected.status !== "done" && <button className="text-button report-button" disabled={busy} onClick={() => open({ kind: "issue", task: selected })}><TriangleAlert size={14} />报告阻塞</button>}{isBlocked(selected.id) && <p className="text-small warning-text">未解除的阻塞将暂停成果提交和验收通过。</p>}<p className="detail-updated">最近更新于 {dateTime(selected.updated_at)}</p></div>
          </aside> : <aside className="task-detail empty-detail"><FileCheck2 size={32} strokeWidth={1.3} /><h3>给每一项工作<br />完整的上下文</h3><p>选择任务，查看验收标准、<br />责任人和最新成果。</p></aside>}
        </div>}
        <footer className="page-footer"><span>CoSpace · Shared context. Real progress.</span><span>每一步推进，都有迹可循。</span></footer>
      </main>
    </div>
    {notice && <div className="toast" role="status"><CircleCheck size={18} /><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice("")}><X size={15} /></button></div>}
    {modal && <Dialog title={modalTitles[modal.kind]} onClose={() => setModal(null)} busy={busy}>
      {modal.kind === "context" ? <div className="context-dialog"><p className="form-hint">包含读取时的任务版本、目标、验收要求、提交与未决问题。可交给下一位成员或 Agent。</p><textarea aria-label="交接上下文 JSON" readOnly value={modal.context} rows={15} /><div className="dialog-footer"><button className="button secondary" onClick={() => { const blob = new Blob([modal.context || ""], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `cospace-${modal.task?.id}-context.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }}><ArrowDownToLine size={15} />下载</button><button className="button primary" onClick={async () => { try { await navigator.clipboard.writeText(modal.context || ""); setNotice("交接上下文已复制。"); } catch { setFormError("无法访问剪贴板，请选中文本复制或下载。"); } }}><Copy size={15} />复制上下文</button></div>{formError && <p role="alert" className="error">{formError}</p>}</div> : <form onSubmit={submitModal} className="dialog-form">
        <fieldset disabled={busy}>
          {modal.task && <div className="form-task-caption"><FolderKanban size={16} /><span>{modal.task.title}</span><span>v{modal.task.version}</span></div>}
          {modal.kind === "project" && <><label>项目名称<input name="title" required minLength={2} maxLength={120} placeholder="例如：首轮用户试用" /></label><label>关联目标<select name="goal_id" defaultValue={goal?.id}>{goals.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>要交付什么<textarea name="description" required minLength={5} maxLength={6000} rows={3} placeholder="说明这个项目的交付范围与价值" /></label></>}
          {modal.kind === "task" && <><label>任务名称<input name="title" required minLength={2} maxLength={120} placeholder="用一句话描述要完成的工作" /></label><label>所属项目<select name="project_id" defaultValue={projectId}>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><div className="form-columns"><label>负责人<select name="assignee_id" defaultValue={user.id}>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label>验收人<select name="reviewer_id" defaultValue={members.find((member) => member.id !== user.id)?.id}>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label></div><label>背景与输入材料<textarea name="description" required minLength={5} maxLength={6000} rows={3} placeholder="为什么做？从哪里开始？需要哪些资料？" /></label><label>验收标准<textarea name="acceptance_criteria" required minLength={5} maxLength={6000} rows={3} placeholder="写明可以检查的完成条件" /></label><label>截止日期 <span className="muted">（选填）</span><input name="due_date" type="date" /></label></>}
          {modal.kind === "submit" && <><label>成果链接<input name="url" type="url" required maxLength={2000} placeholder="https://… 文档、PR 或可访问的交付物" /></label><label>成果版本<input name="artifact_version" required maxLength={120} placeholder="例如：v1.0 或 Git commit SHA" /></label><label>完成说明<textarea name="summary" required minLength={5} maxLength={6000} rows={4} placeholder="对照验收标准，说明完成内容和验证方式" /></label><div className="form-info"><ShieldCheck size={16} />提交后进入待验收，通过后才计入已完成。</div></>}
          {(modal.kind === "approve" || modal.kind === "reject") && <><div className="criteria-reminder"><span className="label">本次验收标准</span><p className="prewrap">{modal.task?.acceptance_criteria}</p></div><label>{modal.kind === "approve" ? "验收说明" : "需要改进的内容"}<textarea name="note" required minLength={5} maxLength={6000} rows={4} placeholder={modal.kind === "approve" ? "记录检查结果，以及通过的依据" : "写清未满足的要求和预期修改"} /></label>{modal.kind === "approve" && <label className="checkbox-label"><input type="checkbox" name="collect_asset" /><span>同时收录为团队资产<small>保留交付链接、成果版本和维护人。</small></span></label>}</>}
          {modal.kind === "issue" && <><label>是什么阻止了推进？<textarea name="title" required minLength={2} maxLength={120} rows={3} placeholder="说明问题，以及需要的具体帮助" /></label><label>需要谁协助<select name="helper_id" defaultValue={modal.task?.reviewer_id}>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label></>}
          {(modal.kind === "propose" || modal.kind === "resolve") && <><div className="criteria-reminder">{modal.issue?.title}</div><label>{modal.kind === "propose" ? "解决方案" : "恢复推进的确认依据"}<textarea name="resolution" required minLength={5} maxLength={6000} rows={4} defaultValue={modal.issue?.resolution || ""} placeholder="记录已采取的行动和确认结果" /></label><p className="form-hint">方案由协助人提出，任务负责人确认后解除阻塞。</p></>}
        </fieldset>
        {formError && <div className="error" role="alert">{formError}{formError.includes("刷新") && <button type="button" className="text-button" onClick={() => { setModal(null); void refresh().catch(() => {}); }}>关闭并读取最新状态</button>}</div>}
        <div className="dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => setModal(null)}>取消</button><button className="button primary" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{modal.kind === "approve" ? "确认通过" : modal.kind === "reject" ? "确认退回" : modal.kind === "submit" ? "提交验收" : "保存并同步"}</button></div>
      </form>}
    </Dialog>}
  </div>;
}
