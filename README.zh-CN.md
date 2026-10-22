# Agent Replay

**录制、回放和对比 Coding Agent 完成任务的过程。**

看见 Agent 声称做了什么，也看见工作区实际发生了什么。

[![Public beta](https://img.shields.io/badge/release-v1.0.0--beta.1-blue)](https://github.com/Lyz1116-FOUND/agent-replay/releases/tag/v1.0.0-beta.1)
[![CI](https://github.com/Lyz1116-FOUND/agent-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/Lyz1116-FOUND/agent-replay/actions/workflows/ci.yml)
[English](README.md) · [简体中文](README.zh-CN.md)

[**在线演示**](https://lyz1116-found.github.io/agent-replay/) · [快速开始](#快速开始) · [文档](#文档)

`FAIL → EDIT → REGRESSION → EDIT → RECOVERED`

[![观看 Agent Replay：跟随蓝色角色回溯失败，让细小元素承接每次转场](docs/demo/launch-preview.gif)](https://lyz1116-found.github.io/agent-replay/launch/)

**[观看 24 秒有声短片 →](https://lyz1116-found.github.io/agent-replay/launch/)** · [下载 MP4](https://github.com/Lyz1116-FOUND/agent-replay/releases/download/v1.0.0-beta.1/agent-replay-pointer-final-1080p60.mp4)

无声预览为短片节选。全片由立体角色带领，回看内置 LRU 演示，再进入标注来源的真实产品录屏；转场从游标、下划线和窗口边缘的小点展开。[素材与证据](docs/demo/README.md)。

| 原生采集 | 工作区核验 | 轨迹互操作 |
|---|---|---|
| Codex · Claude Code · OpenCode · ZCode · Qoder | Git · 文件系统 · 解析后的测试 | SWE-agent · 离线 OpenTelemetry OTLP JSON |

在线演示无需安装、API key 或登录。

## 快速开始

**本 beta 仅支持源码安装。** 尚未发布到 npm；npm 上的同名 `agent-replay` 包属于其他项目，请使用下面的源码安装命令。

需要 **Node.js 22.12+**、npm 和 Git。

```bash
git clone https://github.com/Lyz1116-FOUND/agent-replay.git
cd agent-replay
npm ci
npm run dev
```

打开终端打印的地址。

建议按这条路线体验：

1. 在运行列表中打开 **Codex** 的 **Fix LRU cache eviction when capacity=1** 演示，概览会展示最初的失败和后续恢复。
2. 进入详细回放，按 **空格** 播放或暂停，用 **← / →** 逐步查看，也可以拖动游标跳到某次测试或编辑。
3. 选中编辑查看 diff，选中测试阅读输出。切换到 **Flame** 查看耗时和并行执行的步骤。
4. 打开 **对比 / Compare**，选择 LRU 任务，查看 Codex、Claude Code 和 Cursor 三条演示的不同做法。

界面支持中英文，顶部 **中文 / EN** 按钮可随时切换。

## 功能

### 像调试程序一样回放 Agent

先看任务结果和关键转折，再进入 Story 或 Flame 视图逐步追踪。支持 1×、2×、4×、8× 播放、事件跳转和时间轴拖动，方便找到 Agent 花时间最多、开始走偏或修正方向的位置。

![时间线、操作产物与 Inspector 联动的详细回放](docs/replay.png)

### 点开每一步，查看实际产物

选中一个步骤，即可查看代码、Monaco diff、终端输出、测试摘要、搜索结果或公开的推理摘要。Inspector 展示时间、工具属性、原始 span 和父子关系；工作区视图把文件读取、编辑与时间线关联起来。

### 找到失败，对比解决路径

在故事中定位测试失败、回归与恢复。对同一任务最多选择四条运行轨迹，在共享时间尺度上比较结果、测试活动，以及各 Agent 在阅读、编辑和验证上的分配。

![多个 Agent 在同一任务上的对比](docs/compare.png)

### 用工作区变化核对 Agent 的声明

录制器将原生 CLI 事件与 git、文件系统观测结合起来。Agent 上报的编辑可以被实际 diff 证实，也可能显示为未核验。采集来源与时间标签会说明证据来自哪里、哪些时长是估算值。

### 直接使用已有轨迹

支持原生 Agent Replay JSON、SWE-agent 轨迹和离线 OpenTelemetry OTLP JSON。OTel 导入保留父子层级、重叠 span，并支持一个文件中的多条 trace。导入数据留在浏览器，录制文件保存在本地磁盘。

## 不只有内置演示

这个 beta 附带一条新的真实录制：**OpenCode 2.0.32 + `opencode/glm-5.3-flash-free`**，43.4 秒、1 次编辑、2 次测试运行，最终 3/3 测试通过，1 次编辑得到工作区核验，0 次未核验。轨迹在[这里](examples/beta-opencode.trace.json)，[录制证据](docs/demo/REAL_CAPTURE.md)记录了命令、baseline 失败、测试文件校验值和脱敏说明。

短片中的 LRU 故事是**内置演示**，画面中会明确标注；另一条 OpenCode 真实采集轨迹仍作为录制证据提供，新版短片不展示该会话。导入问题或轨迹可以通过 [Issues](https://github.com/Lyz1116-FOUND/agent-replay/issues) 提交。

## 录制会话

先在 Agent Replay 源码目录中构建应用并链接本地 CLI：

```bash
npm run build
npm link
```

然后切换到 **希望 Agent 操作的 Git 项目目录**。请事先安装并登录对应的 Agent CLI；模型调用沿用该 CLI 的供应商与计费配置。

```bash
cd /path/to/your-project
agent-replay record codex --name fix-lru -- "修复 LRU 缓存的淘汰逻辑，并运行测试"
agent-replay open fix-lru
```

录制结果写入目标项目的 `replays/fix-lru.trace.json`。`open` 启动本地查看服务，并在浏览器中打开这条录制。

根据所用 CLI 选择适配器：

| Agent | 命令前缀 | 验证情况 |
|---|---|---|
| Codex | `agent-replay record codex` | 已验证真实录制 |
| Claude Code | `agent-replay record claude` | 已验证真实录制 |
| OpenCode | `agent-replay record opencode` | 已验证真实录制 |
| Qoder CLI | `agent-replay record qoder` | 已验证真实录制 |
| ZCode CLI | `agent-replay record zcode` | 已验证真实录制 |
| Cursor | `agent-replay record cursor` | 已有适配器与 fixture，真机录制待验证 |

真实录制的版本、任务、结果与测量边界见[验证与测量](docs/validation.md)；本次 beta 的 OpenCode 样例见[录制证据](docs/demo/REAL_CAPTURE.md)。

在上面的命令前缀后加上 `--name <名称> -- "<任务描述>"` 即可。需要传入 CLI 自身的额外参数时，使用显式命令包装：

```bash
agent-replay record --adapter opencode --name fix-lru -- \
  opencode run --format json --auto "修复 LRU 缓存的淘汰逻辑，并运行测试"
```

使用桌面 Agent 或交互式工作流时，可以被动录制：

```bash
agent-replay start --name desktop-fix --agent Codex
# 在当前仓库正常使用你的 Agent。
agent-replay run -- npm test   # 可选：明确记录一次测试命令。
agent-replay stop
agent-replay open desktop-fix
```

被动模式观察工作区变化；原生模式还会采集 Agent 的工具事件流。权限设置、通用命令包装与各适配器的细节见[录制指南](docs/recording.md)（英文）。

## 导入轨迹

1. 用 `npm run dev` 启动界面，点击 **导入轨迹 / Import trace**。
2. 拖入文件、从磁盘选择文件，或粘贴内容，然后点击 **导入**。
3. 文件包含多条 trace 或诊断信息时，在对话框中查看提示并选择要打开的轨迹。

| 格式 | 导入内容 | 示例 |
|---|---|---|
| Agent Replay | 录制器或其他工具生成的 `agent-replay/v1` JSON | [原生示例](examples/native-sample.trace.json) |
| SWE-agent | `.traj` 轨迹文件 | [示例轨迹](examples/swe-agent-sample.traj) |
| OpenTelemetry | OTLP JSON 格式的 `ExportTraceServiceRequest` | [OTel fixture 与真实导出样例](examples/otel/) |

导入对话框还提供一个内置 SWE-agent 示例。回放导入文件无需执行 Agent。

**OTel 支持范围：** 仅离线 JSON，不支持 protobuf、gRPC、JSONL 或 collector 接口。OTel span 表达导出的活动，不直接证明编程任务通过；界面会标注未经过工作区核验。时间戳要求见[轨迹格式](docs/trace-formats.md)，兼容性边界见 [OTel 契约](docs/M5_OTEL_CONTRACTS.md)（均为英文）。

## 对比自己的运行

**当前限制：** CLI 尚无独立的任务分组参数。不同名称的录制需要手动统一 trace JSON 的 `task.id`，才能在 Compare 中归到同一任务。

1. 用不同名称录制每次尝试，例如 `codex-fix` 和 `claude-fix`，避免输出文件互相覆盖。
2. 导入前编辑这些 trace JSON，将 `task.id` 统一为同一个值，例如 `lru-fix`；每条轨迹最外层的 `id` 保持各不相同。录制器根据 `--name` 生成 `task.id`，因此不同名称的录制需要这一步才能归到同一任务。
3. 导入文件，打开 **对比 / Compare**，选择该任务，再勾选最多四条运行。

## 常见问题

**Agent Replay 会调用模型吗？**

查看器不调用模型。`record` 会启动你选择的 Agent CLI，沿用它自身的凭据、权限与计费设置。

**数据保存在哪里？**

导入数据保存在浏览器 `localStorage`，录制文件写入目标项目的 `replays/`。Agent Replay 不会自动上传它们。手动分享前，请检查轨迹中的源代码、终端输出和凭据等敏感内容。

**可以对比我自己的运行吗？**

可以。按[对比自己的运行](#对比自己的运行)中的步骤，将录制归入同一任务即可。步骤 URL 只定位某条轨迹中的位置，接收方仍需能访问对应的 trace 数据。

**会采集隐藏思维链吗？**

不会。它展示可观察的工具活动，以及 Agent 产品公开提供的推理摘要，不访问模型内部状态。

## 文档

以下进阶文档为英文：

- [录制指南](docs/recording.md)：原生采集、被动模式、CLI 参数与可信度标签。
- [轨迹格式](docs/trace-formats.md)：原生 schema、SWE-agent 映射与 OTLP JSON 导入。
- [验证与测量](docs/validation.md)：真实录制、任务矩阵、recall、覆盖率与延迟口径。
- [架构](docs/architecture.md)：适配器、事件合并、trace 构建与回放界面。
- [演示素材](docs/demo/README.md) · [真实录制证据](docs/demo/REAL_CAPTURE.md)。
- [发布说明](docs/RELEASE_v1.0.0-beta.1.md) · [变更记录](CHANGELOG.md) · [历史规划（M0–M4）](PLAN.md)。

## 开发

```bash
npm run dev        # Web 开发服务器
npm test           # 单元与集成测试
npm run lint       # 代码检查
npm run build      # 类型检查、Web、录制 CLI 与验证 harness
```

欢迎通过 [Issues](https://github.com/Lyz1116-FOUND/agent-replay/issues)、[Discussions](https://github.com/Lyz1116-FOUND/agent-replay/discussions) 和 Pull Request 反馈问题或贡献代码。报告导入问题时，请附上格式、诊断信息和能复现问题的最小脱敏轨迹。

## 许可证

应用采用 [MIT](LICENSE)。新版宣传片制作流程使用非商业许可的 onetake，详见[媒体授权说明](docs/demo/launch-pointer/README.md#依赖与许可)。
