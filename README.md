# CoSpace

小团队的共享项目上下文、任务交接与成果验收工作台。当前为本地可运行 MVP，包含真实服务端持久化与独立账号会话。

![CoSpace 工作台截图，使用演示与验证数据](design/workbench-preview.jpg)

## 产品设计与项目展示

项目围绕一个完整流程设计：明确任务和验收标准 → 负责人执行并提交成果 → 指定成员验收或退回 → 通过后沉淀为可复用资产。

值得查看的实现包括责任人与验收人分离、成果提交历史、阻塞解除确认、任务版本冲突检查，以及带来源的交接上下文导出。已支持外部 Agent 单任务授权与本机 MCP 接入，当前尚未上线。

- [团队功能与试用说明 Word](docs/CoSpace产品功能与团队试用说明.docx)
- [实施方案](docs/implementation-plan.md)
- [验证记录](docs/verification.md)
- [Agent 接入与试用说明](docs/agent-integration.md)
- [作品集介绍与发布范围](docs/portfolio.md)

实现使用了 Codex 辅助开发。作品集中的个人职责应根据实际参与情况说明需求提出、产品取舍、交互评审、代码理解、验证与迭代工作。

## 开始

需要 Node.js 22.14+ 与 npm。

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

打开 http://127.0.0.1:3000。开发服务默认仅监听本机。

### 本地演示账号

| 姓名 | 邮箱 | 分工 |
| --- | --- | --- |
| 林 | lin@cospace.local | 负责项目和验收 |
| 陈 | chen@cospace.local | 执行任务 |
| 周 | zhou@cospace.local | 执行与协助 |

默认演示密码均为 `cospace-local-2026`，仅用于本地演示。`COSPACE_DEMO_PASSWORD` 在数据库首次初始化时生效，修改环境变量不会重置已有账号密码。预置成果链接是明确标注的占位地址。

每个浏览器共享一个账号会话。用退出登录切换账号，或用另一个浏览器/隐私窗口同时体验多人协作。禁止把预置演示账号用于公开部署。

## 已实现

- 团队总览、我的工作、项目列表与任务详情、资产中心。
- 项目和任务创建、责任人与验收人分离。
- 待开始 → 进行中 → 待验收 → 已完成；支持退回修改与多版提交。
- 阻塞报告、协助人提出方案、负责人确认解除。
- 验收通过时可收录资产；所有关键变更保存活动记录。
- 按当前版本导出/复制交接上下文 JSON。
- 在任务详情创建 Agent、生成限时单任务凭证及本机 MCP 配置，随时撤销授权。
- Agent 读取上下文、开始执行、记录进展、报告阻塞、提交成果；执行与提交记录保留 Agent 来源，仍由指定成员验收。
- HttpOnly 会话、密码摘要、登录尝试限制、同源写请求、团队与责任身份校验、事务与乐观并发控制。
- 页面每 30 秒读取共享状态；表单打开时暂停自动刷新，保留提交时的版本检查。

## 验证一条完整流程

1. 林登录，新建任务；负责人选陈，验收人选林，写清背景与验收标准。
2. 陈登录，在“我的工作”中开始执行，提交实际成果链接、版本和完成说明。
3. 林登录，打开待验收任务，填写意见并退回。
4. 陈再次提交，林确认通过并勾选收录资产。
5. 检查任务的两版提交、验收意见、交付计数和资产来源；复制交接上下文。

测试阻塞：周登录查看预置试跑任务；林可以记录解决方案，但只能由周确认解除。

## 数据库

默认使用 **PGlite**，将本地 PostgreSQL 数据持久化在 `.data/cospace`，重启应用后保留。目录包含账号与项目数据，已加入忽略规则。该模式只能运行一个应用进程，不能让开发服务和生产服务同时打开同一目录。

设置 `DATABASE_URL` 后使用 `pg` 连接独立 PostgreSQL，同一套 schema、SQL 和业务逻辑保持不变。通过数据库连接串配置供应商要求的 TLS。切换数据库不会自动搬迁原有数据；当前初始化 schema 在 `src/server/schema.ts`，升级部署前需要版本化迁移。

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/cospace
COSPACE_DEMO_MODE=false
COSPACE_ADMIN_EMAIL=owner@example.com
COSPACE_ADMIN_NAME=Owner
COSPACE_ADMIN_PASSWORD=a-unique-password-at-least-12-characters
```

非演示首次启动仅创建管理员和默认目标，正式成员邀请尚未实现。现阶段请使用本地演示团队完成多人试跑。

## 检查与构建

```powershell
npm run typecheck
npm test
npm run build
npm start
```

本地生产构建试跑需要 `.env.local` 显式启用 `COSPACE_DEMO_MODE=true`，或配置独立数据库和管理员。`npm start` 同样仅监听本机。

## 工程结构

```text
src/app/                 页面、样式与 HTTP 路由
src/components/          交互工作台
src/lib/types.ts         前后端共享的数据类型
src/server/              数据库、认证、事务与业务规则
tests/                   权限、并发、交付流程的集成测试
docs/implementation-plan.md  范围、状态与后续计划
design/                  早期概念稿
```

## 当前边界

没有线上部署；未连接 Supabase 或 Git。Agent 首版通过外部客户端执行、本机 stdio MCP 或 HTTP 接口回传，不包含内置模型执行服务。成员邀请、密码重置、独立决策管理、任务取消、通知推送为下一阶段内容。日期按浏览器本地时区显示。项目风险依据已报告阻塞推导，目标成效仍需团队验证。

本地 PGlite 集成测试不替代独立 PostgreSQL 的上线验收。生产环境还需要正式身份服务、HTTPS、部署配置、共享限流和数据库备份；当前登录尝试限制按邮箱持久化，不是完整的公网滥用防护方案。
