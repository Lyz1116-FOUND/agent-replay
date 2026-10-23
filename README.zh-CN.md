# Agent Replay

**回放 Agent 的编程过程，也运行、验证和评测你自己的 Harness。**

Agent Replay 现在有两个互补的能力：

| 能力 | 作用 |
|---|---|
| **回放与评估现有 Agent** | 录制 Codex、Claude Code、OpenCode、Qoder、ZCode、Cursor 会话，转为可交互时间线；导入原生、SWE-agent、OTLP 轨迹；并通过 FastAPI 提供录制与评测服务。 |
| **运行最小 Coding Agent Harness** | 原生 Python ReAct Harness（M0–M11）：Context Manager、OpenAI-compatible Model Client、六个工具、Tool Registry、Harness 持有的 Grader、Grader 驱动的重试、Replay 产物、上下文压缩、Skills、MCP、Reviewer 与 Multi-Agent。 |

[![Public beta](https://img.shields.io/badge/release-v1.0.0--beta.1-blue)](https://github.com/Lyz1116-FOUND/agent-replay/releases/tag/v1.0.0-beta.1)
[![CI](https://github.com/Lyz1116-FOUND/agent-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/Lyz1116-FOUND/agent-replay/actions/workflows/ci.yml)

[English](README.md) · [简体中文](README.zh-CN.md)

[**在线演示**](https://lyz1116-found.github.io/agent-replay/) · [Harness 快速开始](#运行-harness) · [实测结果](#实测结果) · [M0m11-状态](#m0m11-状态) · [文档](#文档)

[![Agent Replay 宣传片：蓝色角色回溯失败的测试，检查修改，再回放恢复过程](docs/demo/launch-preview.gif)](https://lyz1116-found.github.io/agent-replay/launch/)

[观看 24 秒有声短片](https://lyz1116-found.github.io/agent-replay/launch/) · [下载 MP4](https://github.com/Lyz1116-FOUND/agent-replay/releases/download/v1.0.0-beta.1/agent-replay-pointer-final-1080p60.mp4)

## 运行 Harness

Harness 需要 Python 3.10+。它在一次性的 Git 工作区中运行模型，并由 **Harness 而不是模型的“完成了”** 决定成功。

```bash
git clone https://github.com/Lyz1116-FOUND/agent-replay.git
cd agent-replay
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'

python -m agent_replay.harness list
python -m agent_replay.harness run task_004_parser_empty --backend scripted
python -m agent_replay.harness validate-tasks
```

`scripted` 后端是确定性的 oracle fixture，不是 LLM；它用于演示循环并生成真实产物，不需要 API key。

使用真实模型时，接入任意 OpenAI-compatible chat-completions 端点：

```bash
export AGENT_REPLAY_MODEL_BASE_URL="https://your-endpoint/v1"
export AGENT_REPLAY_MODEL_API_KEY="..."
python -m agent_replay.harness run task_004_parser_empty --backend openai --model your-model
```

每次运行写入：

```
results/harness/runs/<run_id>/
  task.json        config.json       events.jsonl
  messages.jsonl   patch.diff        test_results.json
  grade.json       metrics.json      result.json
  trace.json       # 可直接导入 Agent Replay 查看器
```

命令行入口 `agent-replay-harness` 与 Python 模块等价；`agent-replay` 仍是 Node 录制器/查看器 CLI。

核心流程：

```
Task → Context → Model → Tool → Observation → Loop → Verification → Grader → Retry / Finish
```

- **Harness 持有成功裁决权。** 模型不调用工具只代表“声明完成”；测试与受保护文件哈希决定最终结果。
- **统一工具结果。** `read_file`、`grep`、`write_file`、`shell`、`run_tests`、`git_diff` 都返回 `ToolResult`。
- **反馈重试。** 验证失败会把 Grader 反馈写回同一工作区，继续下一轮。
- **同一套事实生成 Replay。** 每次运行都保存事件、消息、patch、测试、评分和原生 `trace.json`。
- **Reviewer 只提供建议。** Multi-Agent 轮次可以补充反馈，但不能覆盖 Grader 的裁决。

## M0–M11 状态

| 阶段 | 实现 | 证据 |
|---|---|---|
| **M0 Contracts** | `TaskSpec`、`RunState`、`ModelTurn`、`ToolResult`、`GradeResult`（[`harness/types.py`](agent_replay/harness/types.py)） | 契约与序列化测试 |
| **M1 Single-Agent Loop** | ReAct 循环、OpenAI-compatible client、步数/时间/token 预算、abort、stuck-loop | Loop 与本地假端点集成测试 |
| **M2 Built-in Tools** | 六个工具 + Tool Registry + 工作区边界 | 工具、路径、registry 与边界测试 |
| **M3 Verification + Retry** | Test / Constraint / Composite Grader；受保护路径；反馈重试 | Grader 与 loop 测试 |
| **M4 Replay + Observability** | `events.jsonl`、消息、patch、测试、评分、metrics、result、原生 trace | Replay 测试；trace 经查看器 schema 校验 |
| **M5 Context Management** | full / truncated / compressed、结构化状态、预算终止 | Context 与边界测试 |
| **M6 Benchmark + Metrics** | 10 个 Python 任务；成功率、验证成功、Pass@1、重试恢复、回归、误完成、工具、token、延迟、context | Scripted 与 live 报告 |
| **M7 Skills** | 加载器、任务匹配、内置 Python 调试 Skill | Skill 测试与 NoSkill/Skill 实验 |
| **M8 MCP** | stdio JSON-RPC client + 原生 `Tool` adapter | adapter、半包、超时、通知测试 |
| **M9 Reviewer** | 只读 Reviewer、严格 JSON、建议反馈 | Reviewer 与 supervisor 测试 |
| **M10 Multi-Agent** | 有界 coder → grader → reviewer 轮次、`MultiAgentState` | Supervisor 测试 |
| **M11 A2A** | 内部 `AgentMessage` / `MessageBus`；不声称外部协议 | A2A 与 supervisor 测试 |
| **可选 Memory** | JSON key/value memory，按任务召回，与 context 分离 | Memory 测试 |

架构、证据等级、实验变体、失败分类与审核清单见 [docs/harness.md](docs/harness.md)。

## 实测结果

### Live 模型：`spark-x2.6`（2026-10-23）

**130 runs = 13 变体 × 10 任务；每格一次；共 2,423,838 tokens。** 这是真实运行观察，不是排名或显著性结论。

| 变体 | Harness | 事后验证 | Tokens | 平均 context |
|---|---:|---:|---:|---:|
| harness | 10/10 | 10/10 | 190,162 | 11,972 |
| 单轮基线（`single_shot`） | 0/10 | 0/10 | 10,707 | 254 |
| 关闭验证 | 10/10 | 10/10 | 230,947 | 15,094 |
| 开启验证 | 9/10 | 9/10 | 227,731 | 14,965 |
| context full | 10/10 | 10/10 | 229,321 | 14,558 |
| context truncated | 10/10 | 10/10 | 155,643 | 8,177 |
| context compressed | 10/10 | 10/10 | 107,161 | 4,161 |
| 单 Agent | 10/10 | 10/10 | 189,752 | 12,048 |
| coder + reviewer | 10/10 | 10/10 | 220,387 | 13,138 |
| 无 Skill | 10/10 | 10/10 | 220,019 | 14,314 |
| 有 Skill | 10/10 | 10/10 | 192,007 | 11,632 |
| 不重试 | 10/10 | 10/10 | 216,854 | 14,005 |
| 重试一次 | 10/10 | 10/10 | 233,147 | 15,001 |

需要一起读的边界：

- **上下文压缩：** 三种策略都是 10/10；compressed 只使用 full 约 **47%** 的总 tokens 和 **29%** 的平均 context tokens。
- **Reviewer：** coder+reviewer 同样 10/10，但多消耗约 **30.6k tokens**、1.5 次模型调用；本次运行不能证明成功率提升。
- **验证：** live 模型即使关闭 Grader 也实际修好了任务，因此 live false completion 为 0；受控的误接受证据来自下面的 scripted no-op 实验（10/10 被接受、10/10 事后测试失败）。
- **单轮基线：** `single_shot` 的唯一一轮用于查看文件，没有完成编辑；0/10 是单轮预算的结果，不是通用单 prompt 结论。
- **重试：** `no_retry` 已经 10/10，live 没有首轮失败，所以重试恢复未被触发；受控证据是 scripted `fail_first`。
- **一次 `verified` 失败** 是 provider timeout，分类为 `I1` 基础设施，而不是测试失败。

### Scripted 机制验证（受控，不是模型能力）

确定性 oracle 会刻意触发失败路径：

- `no_verification`：接受 **10/10** 个提前完成声明；事后测试 10/10 失败。
- `verified`：**0/10** 被接受；Grader 拦下所有误声明。
- `retry_once`：Pass@1 **0%**，重试恢复 **10/10**。
- context full / truncated / compressed：成功率 **100%**，平均 context 为 **12,860 / 4,362 / 2,997** tokens。

`scripted` 是 oracle fixture，只证明 Harness 循环、Grader、重试、指标与产物正确，**不衡量模型能力**。完整表格与限制见 [docs/harness.md](docs/harness.md)。Live 原始产物保存在本地 `results/live-bench/full-spark-20261023/`；API key 只通过环境变量传入，不写入仓库或产物。

## 回放现有会话

[打开在线演示](https://lyz1116-found.github.io/agent-replay/) 无需安装、API key 或登录。打开 **Codex 的 LRU 缓存演示**，选中失败的测试，再逐步查看后续修改。按 **空格** 播放或暂停，用 **← / →** 切换步骤。

本地运行查看器需要 **Node.js 22.12+**、npm 和 Git：

```bash
git clone https://github.com/Lyz1116-FOUND/agent-replay.git
cd agent-replay
npm ci
npm run dev
```

打开终端打印的地址。界面支持中英文，可通过顶部 **中文 / EN** 按钮切换。

> 本 beta 仅支持源码安装。请勿使用 `npm install agent-replay`：npm 上的同名包属于其他项目。

### 可以用它做什么

- **回放一次编程会话。** 沿时间线查看文件读取、编辑、命令和测试，随时暂停、调整速度或跳到某一步。
- **检查一次失败。** 点开测试输出和前后的代码差异，查看回归或恢复之前发生了什么。
- **对比不同做法。** 将同一任务的最多四条运行并排查看，比较结果、耗时和测试活动。
- **核对修改是否发生。** 区分 Agent 上报的编辑、工作区 diff 已证实的修改，以及尚未核验的声明。

![回放界面：时间线、代码差异、测试输出和步骤详情](docs/replay.png)

### 录制会话

先在 **Agent Replay 源码目录**构建应用，并将 CLI 加入命令行：

```bash
npm run build
npm link
```

然后切换到 **希望 Agent 操作的 Git 项目目录**。使用前，请先安装并登录对应的 Agent CLI。下面的命令会实际启动该 Agent，沿用它自身的权限、凭据与计费设置。

```bash
cd /path/to/your-project
agent-replay record codex --name fix-lru -- "修复 LRU 缓存的淘汰逻辑，并运行测试"
agent-replay open fix-lru
```

录制结果保存在项目中的 `replays/fix-lru.trace.json`，`open` 会用本地查看器打开它。查看器本身不调用模型。

| Agent | 适配器名称 | 录制状态 |
|---|---|---|
| Codex | `codex` | 已测试真实录制 |
| Claude Code | `claude` | 已测试真实录制 |
| OpenCode | `opencode` | 已测试真实录制 |
| Qoder CLI | `qoder` | 已测试真实录制 |
| ZCode CLI | `zcode` | 已测试真实录制 |
| Cursor | `cursor` | 已有适配器，真实录制尚未验证 |

将命令中的 `codex` 换成需要的适配器即可。桌面 Agent、交互式会话和额外 CLI 参数的用法见[录制指南](docs/recording.md)。已测试版本和采集边界见[验证与测量](docs/validation.md)。

### 导入轨迹

已有录制文件时，点击查看器中的 **导入轨迹 / Import trace**，拖入文件或粘贴内容，即可打开回放，无需重新执行 Agent。

| 格式 | 示例 |
|---|---|
| Agent Replay JSON | [原生轨迹](examples/native-sample.trace.json) |
| SWE-agent `.traj` | [示例轨迹](examples/swe-agent-sample.traj) |
| OpenTelemetry OTLP JSON | [导出样例](examples/otel/) |

OpenTelemetry **仅支持离线 JSON**，保留导出的父子层级和重叠活动，但不会核验工作区变化。不支持 protobuf、gRPC、JSONL 或 collector 接口。详细要求见[轨迹格式](docs/trace-formats.md)。

### 对比自己的运行

打开 **对比 / Compare**，可以先体验内置的 LRU 演示。对比自己的录制时，各条记录需要共用一个 `task.id`，才能归入同一任务。

<details>
<summary>为自己的录制设置任务分组</summary>

CLI 目前根据 `--name` 生成 `task.id`，尚无独立的任务分组参数。

1. 为每次尝试使用不同名称，例如 `codex-fix` 和 `claude-fix`，避免覆盖文件。
2. 导入前编辑 trace JSON，将 `task.id` 改成相同值，例如 `lru-fix`；每条轨迹最外层的 `id` 保持不同。
3. 导入文件，打开 **对比 / Compare**，选择该任务，再勾选最多四条运行。

例如，在已有的 Codex 轨迹中修改下面这些字段，其余内容保留：

```json
{
  "id": "codex-fix",
  "task": { "id": "lru-fix" }
}
```

另一条轨迹的 `id` 使用 `claude-fix`，`task.id` 同样使用 `lru-fix`。

</details>

## 数据与证据

录制文件保存在项目的 `replays/` 目录，导入的轨迹保存在浏览器 `localStorage`。Agent Replay 不会自动上传这些数据。请保留原始轨迹文件：清除该站点的浏览器数据会移除已导入的运行。分享前，请检查文件中的源代码、终端输出和凭据等敏感内容。

采集标签会区分 Agent 上报的活动与工作区已核验的变化。查看器展示可观察的工具活动，以及 Agent 产品公开提供的推理摘要，不访问隐藏思维链或模型内部状态。

内置示例标有 **DEMO**。宣传片重构了其中一条演示，并包含标注来源的产品录屏。仓库还附有一条[真实 OpenCode 录制](examples/beta-opencode.trace.json)，其命令、测试结果和核验过程见[录制证据](docs/demo/REAL_CAPTURE.md)。

Harness 结果标记为 **live** 或 **mechanics**。当后端未上报 token 使用时，指标显示 unavailable，不会把它伪造成 0。边界见 [Harness limits](docs/harness.md#known-limits)。

## 服务 API 与 Prompt 实验

录制器和 Prompt 评测器还通过 **FastAPI 服务**和 **Prompt 优化实验框架**对外提供。两者复用与 CLI 相同的执行与可信评测逻辑。

```
Task → Agent → Execution → Patch → Tests → Evaluator → Replay / Report
```

### 启动 API

```bash
# 本地
pip install -e .                            # 安装 agent_replay + experiments
uvicorn agent_replay.api.main:app --reload   # http://127.0.0.1:8000/docs

# Docker
docker build -t agent-replay .
docker run -p 8000:8000 agent-replay
curl http://127.0.0.1:8000/health           # {"status":"ok"}
```

### API 调用示例

```bash
curl -X POST http://127.0.0.1:8000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"task": "single-file-bug", "prompt_template": "structured"}'

curl -X POST http://127.0.0.1:8000/tasks/<task_id>/run
curl http://127.0.0.1:8000/runs/<run_id>
```

### 运行 Prompt 实验

```bash
python -m experiments.prompt_eval \
  --prompts default,structured,verify --tasks all --runs 1
# → results/<experiment_id>/{raw_runs.jsonl, summary.json, summary.csv, report.md}
```

在 `zhipu/glm-5.3-flash` 上完成 30 次运行（3 种 Prompt × 10 个任务）：

| Prompt | 成功率 | 延迟中位数 | Tokens |
|---|---|---|---|
| default | 90.0% (9/10) | 24.0s | 57,118 |
| structured | 100% (10/10) | 22.4s | 57,196 |
| verify | 100% (10/10) | 37.6s | 80,712 |

「成功」由在最终工作树中运行任务自带的 verify 命令判定。当前每个任务仅运行一次，请将结果视为观察而非排名。API 契约、三种 Prompt 变体和复现方法见[后端与实验](docs/backend.md)。

## 文档

以下进阶文档为英文：

- [Harness 架构与审核](docs/harness.md)：M0–M11、工具、上下文、Replay、实验、限制与审核清单。
- [独立审核记录](docs/harness-audit-20261023.md)：25 项边界检查、修复与 live 验证。
- [录制指南](docs/recording.md)：原生采集、被动录制和 CLI 参数。
- [轨迹格式](docs/trace-formats.md)：支持的文件、数据结构与导入限制。
- [验证与测量](docs/validation.md)：已测试的 Agent、任务与证据边界。
- [架构](docs/architecture.md) · [贡献指南](CONTRIBUTING.md)：参与开发。
- [发布说明](docs/RELEASE_v1.0.0-beta.1.md) · [变更记录](CHANGELOG.md) · [演示素材](docs/demo/README.md)。

## 开发

```bash
npm test          # Node 单元与集成测试（210）
npm run lint      # Node lint
npm run build     # Web 查看器 + CLI

pip install -e '.[dev]'
python -m pytest  # Python Harness/服务测试（139）
python -m agent_replay.harness validate-tasks
```

[反馈问题](https://github.com/Lyz1116-FOUND/agent-replay/issues) · [交流使用方法](https://github.com/Lyz1116-FOUND/agent-replay/discussions)

## 许可证

应用采用 [MIT](LICENSE)。宣传片制作流程使用非商业许可的 onetake，详见[媒体授权说明](docs/demo/launch-pointer/README.md)。
