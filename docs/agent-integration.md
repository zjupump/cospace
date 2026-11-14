# Agent 接入第一版

CoSpace 管理任务、共享上下文和人工验收；外部 Agent 在自己的工具环境中执行。第一版支持本机 stdio MCP 和独立 HTTP 接口，不包含工作台内的模型聊天、自动调度、代码执行环境或远程 MCP 托管服务。

## 试用步骤

1. 启动工作台，使用任务负责人账号登录（例如陈）。
2. 打开自己负责的待开始或进行中任务，在“Agent 协作”中展开“连接并授权 Agent”。
3. 创建 Agent 或选择已有 Agent，选择 1 小时、24 小时或 7 天有效期，生成配置。
4. 将配置复制到支持本机 stdio MCP 的 Agent 客户端。配置中的 `mcpServers` 是通用 JSON 示例，具体客户端的配置界面可能不同。`node` 需在客户端可用，脚本路径指向本项目，依赖需已安装。
5. 让 Agent 调用 `list_my_tasks`、`get_task_context`，再开始执行。要求它完成真实交付物后提交实际成果地址。
6. 验收人登录并验收。退回后，Agent 重新读取意见、调用 `start_task` 开启新一轮记录，然后再提交。

连接配置包含任务凭证，仅在生成后的当前页面显示。关闭、切换任务或刷新后不能再次取回；丢失时撤销旧授权并生成新配置。数据库只保存凭证摘要。不要将配置提交到仓库或发到公开聊天中。配置里的有效期由服务端校验。

任务负责人保持为人类成员；提交同时记录负责人、Agent 和执行记录。Agent 无法通过该接口创建项目、浏览整个工作区、访问其他任务、解除阻塞或验收。阻塞由成员协助后，由负责人确认解除。

“撤销授权并停止”会使后续接口调用失败并结束工作台内的活动执行记录，**不能强制终止外部客户端的本地进程或撤回已读取的数据**。需要停止本机生成或运行程序时，也应在对应客户端停止执行。

## MCP 工具

| 工具 | 参数 | 作用 |
| --- | --- | --- |
| `list_my_tasks` | 无 | 返回此凭证授权的一个任务、Agent 身份及到期时间 |
| `get_task_context` | `task_id` | 获取当前版本、背景、验收要求、提交和退回意见、未解决阻塞 |
| `start_task` | `task_id`, `version` | 开始或恢复执行；退回后开启新一轮执行记录 |
| `report_progress` | 上述参数及 `message` | 保存进展或执行错误说明，不增加任务版本 |
| `report_blocker` | `task_id`, `version`, `title`, `helper_id` | 报告阻塞；协助人可使用上下文中的验收人 ID |
| `submit_result` | `task_id`, `version`, `url`, `artifact_version`, `summary` | 提交成果，进入人工待验收 |

开始待开始任务、报告阻塞和提交成果会增加任务版本，返回 `task_version`；恢复已进行中的任务不增加版本。收到 `409` 时重新获取上下文，根据实际状态决定下一步，不能盲目重试提交。同一任务只能有一个活动 Agent 执行记录；切换 Agent 时先撤销原授权。过期的活动记录不会阻止新的有效授权开始执行。

MCP 适配器使用官方 SDK 的 stdio 传输，将工具调用转发到工作台 HTTP 接口。协议参考：[MCP stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[工具规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。

## HTTP 接口

外部工具使用 `Authorization: Bearer <任务凭证>`；不要使用成员的浏览器 Cookie。Agent 接口拒绝带 `Origin` 的浏览器来源请求，不提供跨域浏览器访问能力。

| 方法和路径 | 请求内容 |
| --- | --- |
| `GET /api/agent/tasks` | 无 |
| `GET /api/agent/tasks/:id/context` | 无 |
| `POST /api/agent/tasks/:id/start` | `{ "version": 1 }` |
| `POST /api/agent/tasks/:id/progress` | `{ "version": 2, "message": "已经完成第一轮实现，正在验证。" }` |
| `POST /api/agent/tasks/:id/issues` | `{ "version": 2, "title": "缺少必要样例", "helper_id": "成员ID" }` |
| `POST /api/agent/tasks/:id/submissions` | `{ "version": 2, "url": "https://你的真实成果地址", "artifact_version": "v1", "summary": "对照验收要求说明完成情况。" }` |

写接口需要 `Content-Type: application/json`。`401` 表示凭证无效、过期或撤销；`403` 表示超出授权；`409` 表示版本或任务状态冲突。验收沿用原有成员接口和权限。

非本机连接应使用 HTTPS。MCP 配置默认指向工作台所在机器上的脚本；在另一台机器使用时，应在客户端机器准备本项目及依赖、修改脚本路径，并将 `COSPACE_URL` 设置为可访问的 HTTPS 工作台地址。

## 验证

`npm test` 包含权限隔离、凭证摘要、过期撤销、阻塞、并发提交以及退回重提测试。对使用独立测试数据库启动的本地工作台运行：

```powershell
node scripts/agent-smoke.mjs http://127.0.0.1:3100
```

此脚本通过真实 MCP 客户端验证初始化、工具发现、六个工具、两轮提交和人工验收；会写入带“验证”标记的演示数据，不要对正式数据库执行。
