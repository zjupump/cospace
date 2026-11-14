# CoSpace MVP 实施方案

## 本次交付边界

本地可运行的真实协作流程：登录 → 创建项目与任务 → 执行 → 提交成果 → 验收通过或退回 → 查询历史与交接上下文。支持关联阻塞，以及验收时收录资产。页面和 API 使用同一套业务规则，数据存入服务端数据库。

首版采用单团队模型。团队中的成员可以读取团队项目；任务执行、验收、阻塞确认按责任身份校验。本地演示提供三个独立账号，不用前端身份切换冒充登录。

## 页面

1. 团队总览：当前目标、待处理事项、项目验收比例与风险。
2. 我的工作：执行任务、待验收成果、需要协助的问题。
3. 项目：项目切换、任务列表、新建任务、最近活动。
4. 资产中心：验收通过时收录的成果索引，含原始链接、维护人与提交版本。
5. 任务详情：上下文、责任人、标准、阻塞、成果与验收历史；支持直接打开链接，以及 Agent 单任务授权、连接配置和执行记录。

## 数据关系

- Workspace → Members、Goals、Projects。
- Goal → Projects；Project → Tasks。
- Task → Submissions、Issues、Events。
- Submission → 一次验收结果；新提交生成新版本，历史只追加。
- 验收通过的 Submission 可生成 Asset；Asset 保留来源任务和提交版本。
- 每个 Task 带 version；写操作检查版本，防止覆盖他人的新进展。
- Session 仅保存随机令牌的摘要，浏览器使用 HttpOnly cookie。
- Member → Agents → AgentGrants（限时单任务凭证摘要）→ AgentRuns → AgentRunLogs；成果与活动同时记录授权成员和实际 Agent。

## 状态与权限

任务状态：todo → in_progress → in_review → done。退回进入 in_progress。提交和开始执行由任务负责人或其授权的 Agent 操作；验收由指定人类验收人操作；验收人不得与负责人相同。Agent 仅能处理授权任务，不能自行验收或解除阻塞。

阻塞是独立记录，不新增任务状态。任务负责人报告阻塞，指定协助人；负责人或协助人记录解决方案；负责人确认解除。未解除的阻塞禁止提交或通过验收。

任何团队成员可以创建项目和任务，且只能分配给本团队成员。所有读取限定当前团队。任务写入、提交、验收、收录资产、活动记录在一个事务中完成。重复提交同一任务版本会返回冲突，而不会重复记录。

## 技术实现

Next.js App Router + TypeScript + PostgreSQL。开发默认使用 PGlite 将 PostgreSQL 数据持久化到 .data/cospace；配置 DATABASE_URL 后使用 pg 连接独立 PostgreSQL。两种实现共享 SQL schema、查询和事务逻辑。

本地引擎只支持单应用进程；多实例、正式部署使用独立 PostgreSQL。本地数据库不会自动复制到新的 DATABASE_URL。首版 schema 作为初始化版本；后续升级需增加版本化迁移。

## API

- POST /api/auth/login、POST /api/auth/logout、GET /api/auth/me
- GET /api/workspace
- POST /api/projects、POST /api/tasks
- POST /api/tasks/:id/start
- POST /api/tasks/:id/submissions
- POST /api/tasks/:id/review
- POST /api/tasks/:id/issues
- POST /api/issues/:id/propose、POST /api/issues/:id/resolve
- GET /api/tasks/:id/context

写接口要求同源 JSON 请求、有效会话和对象权限；任务变更携带 version。交接接口返回任务版本、项目目标、标准、成果和未决问题。

Agent 管理沿用浏览器会话与同源规则：`POST /api/agents`、`POST /api/tasks/:id/agent-grants`、`POST /api/agent-grants/:id/revoke`。外部 Agent 使用独立 Bearer 认证入口 `/api/agent/tasks/...`，具体接口、MCP 工具和边界见 [Agent 接入说明](agent-integration.md)。授权检查和任务写入处于同一事务，串行处理凭证使用与撤销；同一任务只能有一个活动 Agent 执行记录。

## 验证重点

跨账号提交与验收；无权操作被拒绝；退回后可再次提交且旧记录保留；过期版本返回冲突；阻塞解除需要负责人确认；验收后计数和资产自动更新；跨团队读取与分配被拒绝。

## 后续迭代

正式身份服务和邀请、密码找回、细粒度团队角色；独立 Decision 对象与编辑历史；任务取消；通知；内置 Agent 执行服务与远程 MCP 托管；外部文件同步；版本化数据库迁移与生产运维。

本次不连接真实外部服务或发布线上环境。演示数据、预置密码只用于本地试跑。生产部署须关闭演示模式，配置身份管理、HTTPS、数据库备份和共享登录限流。
