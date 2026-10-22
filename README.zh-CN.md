# Agent Replay

**回看 Agent 的编程过程，评估 Prompt，对比不同做法。**

Agent Replay 把录制的编程会话变成一条可交互的时间线，将录制器与评测器封装为 **FastAPI 服务**，并在固定任务集上运行可复现的 **Prompt 优化实验**。你可以回看 Agent 读过哪些文件、改了哪里、测试何时失败或恢复，也可以衡量不同 Prompt 的表现。

[![Public beta](https://img.shields.io/badge/release-v1.0.0--beta.1-blue)](https://github.com/Lyz1116-FOUND/agent-replay/releases/tag/v1.0.0-beta.1)
[![CI](https://github.com/Lyz1116-FOUND/agent-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/Lyz1116-FOUND/agent-replay/actions/workflows/ci.yml)

[English](README.md) · [简体中文](README.zh-CN.md)

[**体验在线演示**](https://lyz1116-found.github.io/agent-replay/) · [本地安装](#快速开始) · [录制会话](#录制会话) · [文档](#文档)

[![Agent Replay 宣传片：蓝色角色回溯失败的测试，检查修改，再回放恢复过程](docs/demo/launch-preview.gif)](https://lyz1116-found.github.io/agent-replay/launch/)

[观看 24 秒有声短片](https://lyz1116-found.github.io/agent-replay/launch/) · [下载 MP4](https://github.com/Lyz1116-FOUND/agent-replay/releases/download/v1.0.0-beta.1/agent-replay-pointer-final-1080p60.mp4)

## 快速开始

想先看看效果，可以直接[打开在线演示](https://lyz1116-found.github.io/agent-replay/)，无需安装、API key 或登录。打开 **Codex 的 LRU 缓存演示**，选中失败的测试，再逐步查看后续修改。按 **空格** 播放或暂停，用 **← / →** 切换步骤。

本地运行需要 **Node.js 22.12+**、npm 和 Git：

```bash
git clone https://github.com/Lyz1116-FOUND/agent-replay.git
cd agent-replay
npm ci
npm run dev
```

打开终端打印的地址。界面支持中英文，可通过顶部 **中文 / EN** 按钮切换。

> 本 beta 仅支持源码安装。请勿使用 `npm install agent-replay`：npm 上的同名包属于其他项目。

## 可以用它做什么

- **回放一次编程会话。** 沿时间线查看文件读取、编辑、命令和测试，随时暂停、调整速度或跳到某一步。
- **检查一次失败。** 点开测试输出和前后的代码差异，查看回归或恢复之前发生了什么。
- **对比不同做法。** 将同一任务的最多四条运行并排查看，比较结果、耗时和测试活动。
- **核对修改是否发生。** 区分 Agent 上报的编辑、工作区 diff 已证实的修改，以及尚未核验的声明。

![回放界面：时间线、代码差异、测试输出和步骤详情](docs/replay.png)

## 录制会话

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

## 导入轨迹

已有录制文件时，点击查看器中的 **导入轨迹 / Import trace**，拖入文件或粘贴内容，即可打开回放，无需重新执行 Agent。

| 格式 | 示例 |
|---|---|
| Agent Replay JSON | [原生轨迹](examples/native-sample.trace.json) |
| SWE-agent `.traj` | [示例轨迹](examples/swe-agent-sample.traj) |
| OpenTelemetry OTLP JSON | [导出样例](examples/otel/) |

OpenTelemetry **仅支持离线 JSON**，保留导出的父子层级和重叠活动，但不会核验工作区变化。不支持 protobuf、gRPC、JSONL 或 collector 接口。详细要求见[轨迹格式](docs/trace-formats.md)。

## 对比自己的运行

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

## 服务 API 与 Prompt 实验

录制器和评测器还通过 **FastAPI 服务**和 **Prompt 优化实验框架**对外提供。两者复用与 CLI 相同的执行与可信评测逻辑，因此每个结果都可复现、可审计。

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

### 实测结果

在 `zhipu/glm-5.3-flash` 上完成 30 次运行（3 种 Prompt × 10 个任务）：

| Prompt | 成功率 | 延迟中位数 | Tokens |
|---|---|---|---|
| default | 90.0% (9/10) | 24.0s | 57,118 |
| structured | 100% (10/10) | 22.4s | 57,196 |
| verify | 100% (10/10) | 37.6s | 80,712 |

「成功」由在最终工作树中运行任务自带的 verify 命令判定。structured 和 verify 变体避开了 default 唯一的失败（一次超时，Agent 未做任何编辑）。当前每个任务仅运行一次，请将结果视为观察而非排名。

API 契约、三种 Prompt 变体、固定任务集和复现方法见[后端与实验](docs/backend.md)。

## 文档

以下进阶文档为英文：

- [录制指南](docs/recording.md)：原生采集、被动录制和 CLI 参数。
- [轨迹格式](docs/trace-formats.md)：支持的文件、数据结构与导入限制。
- [验证与测量](docs/validation.md)：已测试的 Agent、任务与证据边界。
- [架构](docs/architecture.md) · [贡献指南](CONTRIBUTING.md)：参与开发。
- [发布说明](docs/RELEASE_v1.0.0-beta.1.md) · [变更记录](CHANGELOG.md) · [演示素材](docs/demo/README.md)。

## 开发

```bash
npm test          # 单元与集成测试
npm run lint      # 代码检查
npm run build     # 构建 Web 查看器和 CLI
```

[反馈问题](https://github.com/Lyz1116-FOUND/agent-replay/issues) · [交流使用方法](https://github.com/Lyz1116-FOUND/agent-replay/discussions)

## 许可证

应用采用 [MIT](LICENSE)。宣传片制作流程使用非商业许可的 onetake，详见[媒体授权说明](docs/demo/launch-pointer/README.md)。
