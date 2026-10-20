# Agent Replay — 产品与技术规划

> **Build the "Transformer Explainer for Coding Agents": an interactive, time-based visual replay system that lets users inspect how an agent reads, searches, edits, runs, fails, recovers and finishes a software task.**

本文档整合了原规划、对参考项目的调研结论，以及本次实现（Milestone 0–4）的技术决策。产品 UI 使用英文，文档使用中文。

---

## 1. 定位

Agent Replay 不是又一个 LLM observability dashboard。

| | Langfuse / Phoenix | Agent Replay |
|---|---|---|
| 问题 | "生产环境里发生了什么？" | "这个 Agent 是如何解决任务的？" |
| 核心对象 | 请求、成本、延迟、评分 | 一段可回放、可解释、可比较的工作过程 |
| 主要交互 | 筛选、聚合、告警 | 播放、逐帧检查、联动高亮、对比 |
| 用户 | 平台 / SRE / 产品 | Agent 开发者、研究者、学习者 |

核心动词：**Record + Replay + Explain + Compare**。

M4 之前，项目证明“给我一个高质量 Trace，我能展示得很好”；M4 之后，用户可以从真实 Codex/Claude Code/Cursor 会话自动得到 Trace，形成完整闭环。

三层递进的信息架构，对应 Transformer Explainer 的 Progressive Disclosure：

```
Run  →  Step  →  Operation Detail
```

---

## 2. 调研结论

### 2.1 SWE-agent：trajectory 已经是一个成熟对象

来源：[SWE-agent](https://github.com/SWE-agent/SWE-agent)、[Output files 文档](https://swe-agent.com/latest/usage/trajectories/)

`.traj` 是 JSON，顶层为 `trajectory[]`、`info`、`environment`、`history`。每个 step：

```json
{
  "response": "LM 原始输出",
  "thought": "解析出的思考摘要",
  "action": "ls -F\n",
  "observation": "命令输出",
  "state": "{\"open_file\": \"...\", \"working_dir\": \"...\"}",
  "query": [{ "role": "system", "content": "..." }]
}
```

`info` 含 `exit_status`、`submission`、`model_stats`。SWE-agent 1.1.0 之前用 `message`，之后改为 `query`。

**关键发现：`.traj` 没有时间戳。** 因此适配器必须：

1. 用 step 顺序重建时间轴；
2. 用 observation 长度、action 类型确定性地合成 duration（并在 UI 上标注 `estimated timing`，不伪装成真实耗时）；
3. 从 ACI 命令（`open` / `search_dir` / `edit` / `submit` 等）归类 span type。

我们不复刻 SWE-agent Inspector（上一页/下一页、gold patch），而是把它的 trajectory 接入我们的时间轴和空间视图。

### 2.2 Transformer Explainer：可解释性的交互哲学

来源：[poloclub/transformer-explainer](https://github.com/poloclub/transformer-explainer)、[论文](https://arxiv.org/html/2408.04619v1)

- Svelte + D3；浏览器内跑 GPT-2（ONNX）。
- 不是"展示数据"，而是"展示正在发生的过程"。
- **Progressive Disclosure**：Overview（完整流水线）→ Component（Attention）→ Math（QKV/Softmax）。
- **Linked views**：hover 一个 token，Sankey、attention matrix、输出概率同时高亮。
- 视觉：中性背景 + 单一强调色，monospace 呈现矩阵/代码，动画 200–400ms。

对 Agent Replay 的映射：

- Overview：Run 的步骤序列 + 时间轴
- Component：单个 Step 的 Stage（Diff / Terminal / Tests）
- Math：Inspector 中的字段、关联 observation 与 consequence
- Linked views：Timeline ↔ Stage ↔ Inspector ↔ Scrubber 全部共享 hover/select 状态

### 2.3 TensorFlow Playground：控制与结果同屏

来源：[playground.tensorflow.org](https://playground.tensorflow.org)

顶部全局控制条（learning rate、activation 等）常驻，改动立即反映到输出。拒绝多页跳转式后台。

映射：Replay 页顶部常驻 Run 元信息（agent、model、status、duration）；底部常驻播放器；中间三栏联动，不做"Timeline 一页、Diff 一页、Tests 一页"。

### 2.4 Netron：信息密度极高的 Inspector

来源：[lutzroeder/netron](https://github.com/lutzroeder/netron)

左侧图 / 右侧文档的分栏是成熟的专业工具范式。节点按语义着色（蓝 Conv、红 Relu、绿 Pool），右侧展示属性与文档。

映射：右侧 Inspector 展示 event type、tool、file、duration、attributes、artifacts，并且必须解释"这一步为什么发生"。

### 2.5 Chrome DevTools Performance：时间是一条轴

来源：[Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance)

- x = time，事件按时长占据宽度；
- zoom / pan / range select / flame chart / hover 详情；
- 能一眼回答"时间花在哪了"。

映射：第二时间轴视图（Flame），按类型分泳道：Reason / Read / Search / Edit / Shell / Test。与 Story 视图共存：
- **Story** 服务 explain（普通观看者）
- **Flame** 服务 debug（Agent 研究者）

### 2.6 Algorithm Visualizer：渲染与数据解耦

来源：[algorithm-visualizer/algorithm-visualizer](https://github.com/algorithm-visualizer/algorithm-visualizer)

架构是 `algorithm → tracer → visualization commands → UI`。核心是算法实现与可视化分离。

映射（最关键的一条工程原则）：

```
Raw trace (native JSON / SWE-agent .traj / OTel)
        ↓  Adapter
Normalized AgentReplayTrace
        ↓  Renderer registry
UI (Stage / Timeline / Inspector)
```

绝不在 UI 中写 `if (agent === "codex")`。

### 2.7 OpenTelemetry：数据模型不要自创

来源：[OTel Traces](https://opentelemetry.io/docs/concepts/signals/traces/)

Trace → Span（start/end、attributes、events、status、parent/children）。OpenAI Agents SDK 也是层级 span（Agent / Turn / Generation / Function）。

我们的 native schema 采用 **Trace + 扁平 span 数组 + parentId**（而非嵌套 `steps[]`），便于：
- 适配 OTel / OpenInference；
- 后续支持并行 span、sub-agent；
- 渲染层用 O(n) 建立索引。

---

## 3. 数据模型（agent-replay/v1）

TypeScript + Zod 双源：Zod schema 为运行时真源，类型由 `z.infer` 导出。

```ts
Trace {
  schemaVersion: "agent-replay/v1"
  id, task: { id, title, description?, repo?, baseCommit? }
  agent: { name, version?, model? }
  status: "pass" | "fail" | "partial" | "running"
  startedAt: ISO string; endedAt: ISO string; durationMs: number
  result: {
    summary, exitCode?
    tests?: { passed, failed, total }
    filesChanged?: string[]
    patch?: string            // unified diff
  }
  spans: Span[]               // flat, ordered by startMs
  metadata?: Record<string, unknown>
}

Span {
  id, parentId?
  type: "agent" | "reasoning" | "read" | "search" | "edit"
      | "shell" | "test" | "browser" | "tool" | "checkpoint" | "final"
  name, summary?
  startMs, endMs              // relative to trace start
  status: "ok" | "error" | "warning" | "running"
  files?: string[]
  attributes?: Record<string, string | number | boolean>
  artifacts?: Artifact[]
}

Artifact =
  | { kind: "code"; path; language; content; startLine? }
  | { kind: "diff"; path; before; after; language? }
  | { kind: "terminal"; command; output; exitCode; cwd? }
  | { kind: "test"; command; passed; failed; total; output; failedTests? }
  | { kind: "search"; query; results: { path; line; preview }[] }
  | { kind: "reasoning"; content }
  | { kind: "patch"; diff }
  | { kind: "markdown"; content }
  | { kind: "browser"; url; actions: string[]; screenshot? }
```

设计约束：

- **不存 chain-of-thought。** 只记录产品实际暴露的 `reasoningSummary`、message、action、observation。
- `type` 是封闭枚举，渲染器用 registry 映射；未知类型回退到 `GenericRenderer`。
- 时间统一用相对毫秒，避免时区问题；顶层保留 ISO 时间用于展示。
- 所有 duration 显式声明是否 estimated：`attributes.estimatedTiming = true`。

---

## 4. 信息架构

### 4.1 Runs（`/`）

首页就是 Runs，不做 dashboard。

- 搜索（task / agent / status）
- 状态过滤（All / Passed / Failed）
- 行内信息：task、agent、model、status、duration、steps、files、startedAt
- 主操作：`Import trace`（native JSON / SWE-agent `.traj`）
- 每行可进入 Replay，或加入 Compare

### 4.2 Replay（`/runs/:id`）

灵魂页面。全视口，三栏 + 底部播放器：

```
┌──────────────────────────────────────────────────────────────┐
│ ← Runs   Fix LRU cache capacity=1      Codex · gpt-5   PASS  │
├───────────────┬───────────────────────────────┬──────────────┤
│ TIMELINE      │ STAGE                         │ INSPECTOR    │
│ Story | Flame │ Artifact | Workspace          │ Event        │
│               │                               │ Why          │
│ 01 Task       │ README.md                     │ Next         │
│ 02 Read       │ ...                           │ Attributes   │
│ ...           │                               │ Artifacts    │
├───────────────┴───────────────────────────────┴──────────────┤
│ ▶  ⏮ ⏭   00:17.4 / 00:53.2   ━━━●━━━━━━━   1x   ⌘K hints  │
└──────────────────────────────────────────────────────────────┘
```

- **Story**：按步骤的叙述列表，适合 explain。
- **Flame**：按类型泳道的时间轴，适合 debug，支持点击 seek。
- **Stage**：`renderer[span.type]` 自动切换。
- **Workspace**：文件维度的时间轨迹（read / edit / test 标记），体现 Spatial Replay。
- **Inspector**：type、tool、start、duration、status、files、attributes、artifacts，以及：
  - **Why this step**：前一个 observation / reasoning 的摘要
  - **What followed**：下一步及其结果，形成因果链
- **Player**：Space 播放/暂停，←/→ 上一步/下一步，1/2/4/8x，scrubber 上显示事件刻度，拖动即 seek。

### 4.3 Compare（`/compare?ids=...`）

同 task 的多次 run 并列：

- 结果、耗时、步数、文件数、tests、token（若有）
- 同步比例的泳道 timeline，一眼看出谁在反复读、谁在反复试
- Agent fingerprint（按 span type 的耗时/次数分布）

---

## 5. 设计系统

方向：**VS Code × GitHub Primer × Chrome DevTools**，拒绝紫色渐变、玻璃拟态、满屏圆角卡片、AI 星星。

### Tokens

| Token | Dark（默认） | 用途 |
|---|---|---|
| `--bg` | `#0b0d10` | 应用背景 |
| `--panel` | `#101318` | 面板 |
| `--panel-2` | `#151920` | 悬浮/选中底 |
| `--line` | `#232a34` | 1px 分隔线 |
| `--text` | `#e6e9ef` | 主文本 |
| `--muted` | `#8b939f` | 次要文本 |
| `--faint` | `#5b6472` | 三级文本 |
| `--accent` | `#4d9bff` | 唯一强调色（选中、播放头） |
| `--pass` | `#3fb950` | 通过 |
| `--fail` | `#f85149` | 失败 |
| `--warn` | `#d29922` | 警告 |
| `--edit` | `#a371f7` 使用受限 | 仅 edit 语义（非装饰） |

- 字体：UI `Inter Variable`；代码/数字 `JetBrains Mono Variable`。
- 圆角：2–6px；按钮 4px；代码面板 6px。禁止大圆角。
- 动画：150–250ms，`prefers-reduced-motion` 下关闭。
- 图标：Lucide，16px，stroke 1.75。
- 信息密度优先：13px 正文，11px 大写 letterspaced 区域标题。

### 语义色规则

状态色只用于状态；type 色只用于 type 图标与时间轴块；selected 只用 accent + 低透明度底。

---

## 6. 技术栈与架构

### 决策

| 项 | 选择 | 理由 |
|---|---|---|
| 框架 | **Vite + React 19 + TS** | 纯客户端可视化，无 SSR 需求；Monaco/播放器在 Next SSR 下反而增加复杂度。原规划允许 Vite。 |
| 样式 | Tailwind v4 + CSS variables | tokens 驱动，易做主题 |
| 路由 | React Router 7 | Runs / Replay / Compare |
| 状态 | Zustand | 播放时钟、选中/hover span 跨面板共享 |
| 校验 | Zod 4 | import 时给出结构化错误 |
| 代码 | Monaco（本地 worker） | 真实 DiffEditor，不连 CDN |
| 图标 | Lucide | |
| 字体 | Fontsource 本地打包 | 离线可用 |
| 时间轴 | CSS/SVG 绝对值定位 | 第一版不引入 D3，避免过度设计 |
| 部署 | 静态托管（Vercel/任意 static） | 前端无后端 |
| Recorder | Node CLI + esbuild bundle | `agent-replay` 可独立运行；与前端共享 schema/Zod |
| 观测面 | git + workspace + process output | 第一版不 hook agent 内部，避免被各家 agent 绑定 |

### 目录

```
cli/
├── index.ts               # start / stop / run / record / open / list
└── lib/
    ├── git.ts             # baseline, status, diff, patch
    ├── workspace.ts       # polling watcher + edit reconciliation
    ├── testParser.ts      # pytest/jest/node:test/cargo/mocha/phpunit
    ├── traceBuilder.ts    # events → agent-replay/v1
    ├── recorder.ts        # session orchestration
    ├── openServer.ts      # local static server for `open`
    └── traces.ts          # replay discovery

src/
├── adapters/              # import.ts + sweAgent.ts
├── data/                  # demo repository + four traces + sample .traj
├── schema/trace.ts        # Zod schema + trace-level invariants
├── store/                 # replay clock, imported/transient runs
├── components/
│   ├── replay/            # Overview, timelines, stage, inspector, player
│   ├── shell/             # TopBar, ImportDialog, RemoteTraceLoader
│   └── ui/
├── pages/                 # Runs, Replay, Compare
└── lib/                   # trace indexing, artifacts, story, Monaco
```

不一开始做 monorepo。`schema / adapters / CLI / renderers` 的边界已经足够清晰，未来可无痛抽成 packages。

### Recorder 数据流（M4.6）

```
                 Coding Agent
                     │
          ┌──────────┴───────────┐
          │                      │
 Native event stream       Workspace facts
 Codex / Cursor / Claude / OpenCode / Qoder   Git / FS / Commands
          │                      │
    AgentStreamAdapter      WorkspaceWatcher
          │                      │
          └──────────┬───────────┘
                     ▼
                 EventMerger
        （tool start/end 配对、edit 验证、
         真实 overlap、delete/rename）
                     ▼
              TraceBuilder
                     ▼
              agent-replay/v1
                     ▼
               Existing UI
```

实现选择：

- **Native adapters 不生成 Trace**。Codex `exec --json`、Cursor `stream-json`、Claude `stream-json`、OpenCode `run --format json`、Qoder `stream-json` 统一解析为 `AgentEvent`（tool.started / tool.completed / message / final），由 EventMerger 配对和归一化。
- **真实时间**。span 保留原生 start/end，不做全局 cursor 串行化；Flame 允许重叠。瞬时事件可用 `visualDurationMs` 仅做视觉最小宽度，不改变实际时间。
- **Agent + Environment**。native edit tool 与 workspace diff 按文件和时间窗口匹配；未匹配的 agent edit 标记 `workspaceVerified=false`，不会假装文件真的变了。
- **Fidelity**。`capture.fidelity` 为 `workspace | wrapped-output | native-events | native+workspace`；`capture.timing` 为 `observed | mixed | estimated`。Overview 明确显示。
- **时间标注**。native/workspace 事实为 observed；stdout detected test 为 estimated；baseline/checkpoint/final 为 synthetic；每个 span 带 `timingKind`。
- `start` 保存 HEAD、初始 status、dirty 文件内容，并启动 detached watcher；`stop` 对 watcher 未捕获的最终状态做 reconciliation。
- 编辑按 watcher poll batch 合并成一个 edit span；区分 create / modify / delete / git rename。
- `run -- <command>` 在已有 session 中执行测试，保留真实 command/exit/duration/output。
- generic `record` 保留 stdout scanner 作为 fallback；native `record cursor/codex/claude` 优先使用结构化事件流。
- `open` 启动 127.0.0.1 静态服务器，通过 `?trace=/__agent_replay/trace.json` 把本地 trace 注入现有 UI。
- trace 仍经过同一个 Zod schema 与语义校验；录制失败不会清掉 session，便于排查。

### 播放模型

- `playheadMs` 是唯一时钟状态（由 rAF 推进，乘 speed）。
- 当前 span = 最后一个 `startMs <= playheadMs` 的叶子 span；span 可以重叠，Flame 按真实时间绘制，Story 按 start 排序。
- 播放到末尾自动暂停。
- 拖动 scrubber 立即 seek；hover step 只改变 `hoveredSpanId`，不改变播放位置。
- 暂停时 Stage 显示当前 span；播放时若进入新 span 自动切换。

---

## 7. 演示剧本（Demo Script）

任务：**Fix LRU cache eviction when capacity=1**，repo `acme/cachekit`。

精心设计 failure → recovery：

```
Task received
Read README.md
Search "class LRUCache"
Read src/cachekit/lru.py
Read tests/test_lru.py
Run pytest            FAIL 3 failed
Reason: capacity=1 时 evict 条件？
Edit lru.py           ✗ wrong fix（> 改为 >=，但未处理 self.size）
Run pytest            FAIL 2 failed
Reason: 为什么仍失败？观察 traceback
Search "def _evict"
Read lru.py
Edit lru.py           ✓ correct fix
Run pytest            PASS 14 passed
Checkpoint git diff --stat
Final
```

Agent：Codex / gpt-5-codex，59.2s，16 steps，1 个变更文件（另读取 3 个文件）。另有 Claude（成功，63s，多读文档并补回归测试）与 Cursor（失败，96s，两次错误假设）用于 Compare。

目的：让用户拖动时间轴时，能清楚看到"错误假设 → 失败反馈 → 重新观察 → 修正"。

---

## 8. 里程碑与状态

| Milestone | 内容 | 状态 |
|---|---|---|
| **M0** Visual prototype | Runs / Replay / 三栏 / 联动 / 假数据 | **本次实现** |
| **M1** Native trace | schema + JSON import + sample traces | **本次实现** |
| **M2** SWE-agent import | `.traj` adapter + 归类 + 合成时长标注 | **本次实现** |
| **M3** Compare | 同任务多 run 汇总 + 同步 timeline | **本次实现** |
| **M4.1** Git recorder | baseline / final diff / patch / checkpoint | **本次实现** |
| **M4.2** Test recorder | `run` 捕获命令、输出、exit、duration、test counts | **本次实现** |
| **M4.3** Workspace watcher | 轮询 edit、before/after diff、reconciliation | **本次实现** |
| **M4.4** Open | 本地服务器 + `?trace=` 注入前端 | **本次实现** |
| **M4.5** Overview / Recovery / Outcome story | 总览、恢复标记、Compare 自动摘要 | **本次实现** |
| **M4.6** Native agent capture | AgentEvent + Cursor/Codex/Claude/OpenCode/Qoder/ZCode adapters + EventMerger | **本次实现** |
| **M4.6** Real timing + fidelity | 去串行化、overlap、capture fidelity、instant/synthetic 标注 | **本次实现** |
| **M4.6** Delete / rename | watcher/reconcile 区分 create/modify/delete/rename | **本次实现** |
| **M4.7** Real agent validation | OpenCode + Claude + Qoder + GLM + ZCode live；9 个免费模型矩阵 | **已完成** |
| **M4.8** Measurement integrity | termination taxonomy + environment fingerprint + capture integrity + 措辞清理 | **本次实现** |
| **v0.3.0 beta** | CI、LICENSE、CONTRIBUTING、CHANGELOG、adapter 状态表 | **本次实现** |
| **M4.9** Codex / Cursor live | Codex 真机通过；Cursor 装好但需浏览器登录 | **进行中** |
| M5 OTel import | OTLP/JSON → Trace | 暂缓 |

### 验收标准（本次）

- `npm run build` 通过，无 TS 错误。
- Runs 搜索/过滤可用；三条同任务 run 可进入 Compare。
- Replay：播放/暂停/seek/上一步下一步；Story 与 Flame 都驱动同一个播放头；Stage 在 read/edit/shell/test/search/reasoning/final 间正确切换。
- hover 任一 step，Flame 对应块、Scrubber 区间、Inspector 同步高亮。
- Workspace 视图随时间显示文件 read/edit/test 状态。
- Import 支持 native JSON 与 `.traj`；非法输入显示可读错误；导入后可回放。
- 浏览器实测主路径 + 边界（空搜索、单 span、导入失败）。

### 本次验收记录（2026-10-20）

- `npm run build`：通过（Monaco 独立 lazy chunk，首屏约 432 KB）。
- `npm test`：95 个测试通过，覆盖 schema 语义约束、五家 native adapter fixtures、EventMerger、真实 overlap、recorder 输出解析、trace builder、recovery story、workspace delete/rename 与 demo 数据一致性。
- 泛用 Recorder E2E（临时 git repo + 脚本化 agent）：`record` 自动得到 3 次真实 `node --test` 结果、2 次文件编辑、recovery/regression 标记；`start` + `run` + `stop` 同样通过；无 watcher 残留进程。
- Native E2E（fake `cursor-agent` 输出官方形状的 stream-json）：`record cursor -- "..."` 生成 `native+workspace` trace，2 个 edit 均通过 workspace diff 验证，failing test 与期间的 edit 在 Flame 中真实重叠，capture timing 为 observed。
- File-ops E2E：删除 + `git mv` rename + 修改被记录为 delete/rename/modify，并在 Inspector 中可见。
- `agent-replay open`：本地服务器返回构建产物与 trace JSON；浏览器通过 `?trace=` 加载后进入 Overview，刷新可重新加载。
- M4.7 已完成四个真实 agent/model 组合：OpenCode 2.0.32（DeepSeek 免费）、Claude Code 2.1.304（haiku）、Qoder CLI 1.1.74（DeepSeek-Flash，0 credits）、OpenCode + `glm-5.3-flash-free`，均在同一 bug-fix 任务上生成 `native+workspace` trace，1 个 edit verified、3/3 tests、0 unverified。Codex/Cursor 尚未安装，因此未做完整 3×3 matrix。
- ZCode CLI（`zcode-app-cli` 3.15.3-37）已安装，BigModel 登录成功，但该账号无资源包，模型调用返回 `[1113] 余额不足或无可用资源包`；未尝试充值。免费 GLM-5.3-Flash 验证改用 opencode 的 free 端点。
- Qoder CLI 1.1.74 当前只暴露 `DeepSeek-V4-Pro` / `DeepSeek-Flash`；`DeepSeek-V4.1` 字面 ID 会回落到 Auto，因此真实录制使用免费的 `DeepSeek-Flash`。Qoder Desktop 注入的 `QODER_AGENT_SDK_ENTRYPOINT` 由 Qoder adapter 在子进程环境中移除。
- 真实 Claude 首跑暴露绝对/相对路径不匹配，已修复 EventMerger 的路径归一化并用真实 trace 回归。
- Chrome 1560×960 实测：Runs 搜索/过滤、Replay 播放/step/seek、Story/Flame 切换、Workspace、Compare 选择、导入与持久化、Escape 关闭、Monaco diff、键盘快捷键均通过；无 console error。
- 导入：native sample、`.traj` sample、真实 recorder 输出成功；非法 schema 显示结构化错误；手动导入持久化到 localStorage，`open` 的 trace 作为 transient 运行并可通过 URL 重新加载。
- ZCode CLI（`zcode-app-cli` 3.15.3-37）adapter 完成：`--json` 只输出一个多行 summary，没有实时流，因此缓冲 stdout 取 sessionId，再按 session 读回 `part` / `tool_usage`（`node:sqlite`，Node >= 22.5）。时间戳用 ZCode 自己记录的 epoch ms，换算成相对会话起点；无 `node:sqlite` 时降级为 workspace-only。
- ZCode 真实录制：`bigmodel-standard-api-2/GLM-5.3-Flash`，PASS · 61.9s · 1 edit verified · 0 unverified · 3/3 tests，trace 固化为 `examples/real-zcode.trace.json`。账号浏览器登录仍返回 `[1113] 余额不足`，走的是 API-key provider；`bigmodel-standard-api` 曾返回 429，换第二个 provider 成功。
- 本轮修掉三个采集层缺陷：
  1. `resolveCwd` 未做 realpath，macOS 的 `/tmp → /private/tmp` 会让 native 路径与 git 路径不一致，所有 edit 都变成 unverified。
  2. 子进程 spawn 时只设 `cwd` 不设 `PWD`，而 OpenCode 用 `$PWD` 解析工作区，导致它在父目录里执行工具、报出带父目录前缀的路径。现在 spawn 同时写 `PWD=meta.cwd`。
  3. EventMerger 的 `normalizeFile` 增加单层父目录前缀剥离（`repo-name/src/file.ts` → `src/file.ts`），仅在 workspace diff 能对上时才计为 verified。
- 免费模型矩阵方法论修正：早前 5 条结果作废——OpenCode 复用了绑定到旧目录的后台 server，模型在 `~/Downloads` 和兄弟目录里找文件。现行跑法为每模型独立 git repo + 独立 XDG 目录 + `PWD` 校正，trace 保留在 `examples/matrix/`。
- 免费模型矩阵结果（9 个 OpenCode 免费模型，同一 bug-fix 任务）：8 PASS / 1 FAIL。最快 `glm-5.3-flash-free` 8.7s，最慢 `mimo-v2.6-flash-free` 35.5s，全部 3/3 tests、1 edit verified、0 unverified、0 越界。唯一 FAIL 是 `beam-free`，provider 返回 `This model is not available in your country (HTTP 403)`，属于地区限制，不是模型能力结论。
- 空 XDG 配置下 `minimax-m3.1-flash-free` / `beam-free` 报 `provider.no-route: Model unavailable`，去掉隔离后 minimax 正常通过；矩阵账本里已标注这两条的运行方式差异。
- 错误保真度修正：OpenCode 的 `error` 事件原来只保留通用文案，现在读取 `error.message` 与 `error.status`，trace 里能直接看到 `HTTP 403` 这类真实原因。
- 校验：106 tests passed，`npm run build` 通过，`npm run lint` 0 warnings / 0 errors。Codex / Cursor 仍未安装，3×3 matrix 仍缺两列。

- 截图：`docs/overview.png`、`docs/recorded.png`、`docs/replay.png`、`docs/flame.png`、`docs/workspace.png`、`docs/compare.png`、`docs/fingerprint.png`、`docs/runs.png`。

---

## 8.5 M4.8 测量完整性（本次）

项目的第三层：不只记录 Agent 做了什么，还要区分「任务失败 / Agent 失败 / provider 失败 / harness 失败」。

### 三个新字段

| 字段 | 回答的问题 | 取值 |
|---|---|---|
| `termination` | 这次运行有没有得到公平尝试 | `completed` / `task_failure` / `provider_unavailable` / `rate_limited` / `permission_denied` / `timeout` / `agent_error` / `recorder_error` |
| `environment` | 这次运行的软硬件与隔离条件 | `isolation` / `provider` / `harnessVersion` / `platform` / `nodeVersion` |
| `capture.integrity` | 环境能印证多少 Agent 声称的行为 | `nativeEdits` / `workspaceEdits` / `matchedEdits` / `unverifiedEdits` / `outsideWorkspaceEdits` / `nativeTestRuns` / `parsedTestRuns` / `capturedTests` |

`status` 的语义不变，仍是 `pass | fail | partial`，只看任务自身的测试。聚合时把 unavailable 类别从能力分母里剔除，单独作为可用性指标汇报——否则 5 次 provider 403 会被摊成 75% 成功率。

### 指标定义

- Edit verification recall = `matchedEdits / nativeEdits`，分母为 0 时不定义，不默认 100%。
- Test capture recall = `parsedTestRuns / nativeTestRuns`。
- `outsideWorkspaceEdits` 统计归一化后仍越出仓库根的 native edit。

### 设计原则

> Environment correctness is part of measurement correctness.

同一模型在同一任务上从 31.9s 降到 8.7s，唯一变化是修好了 `PWD`——之前它一直在父目录里找文件。harness 缺陷会被误读成模型能力差异，所以采集层的正确性属于测量正确性，不是工程细节。

### Adapter 状态

| Adapter | Implementation | Fixture | Live |
|---|---|---|---|
| OpenCode | ✓ | ✓ | ✓ |
| Claude Code | ✓ | ✓ | ✓ |
| Qoder CLI | ✓ | ✓ | ✓ |
| ZCode CLI | ✓ | ✓ | ✓ |
| Codex | ✓ | ✓ | ✓ |
| Cursor | ✓ | ✓ | 装好待登录 |

### M4.9 真机验证进展

- Codex 0.163.0 真机通过：`codex exec --json -s danger-full-access`，PASS · 53.5s · 1 edit verified · 2 test runs · recovery，trace 固化为 `examples/real-codex.trace.json`。
- Codex 环境注意：嵌套 sandbox 在本机报 `sandbox-exec: sandbox_apply: Operation not permitted`，需 `-s danger-full-access`；`chatgpt.com` 必须显式走 `HTTPS_PROXY=http://127.0.0.1:7892`（默认代理返回 502）。
- 真机暴露并修掉一个测试识别缺口：`isTestCommand` 的边界字符类不含引号，导致 `sh -lc 'node --test test.mjs'` 这类包装命令不被识别为测试，整条 run 被记成 `partial`。已把 `'"`(` 与 `)` `,` 纳入边界，并补 4 条断言。
- Cursor CLI 2026.10.19 已安装（`~/.local/bin/cursor-agent`），但 `cursor-agent -p` 直接返回 `Authentication required`，需要 `agent login` 浏览器授权；登录流程已启动，等用户确认。

### 3 task × N agent × 3 run 验证（本次启动）

- 任务集 `examples/tasks/`：`single-file-bug`（基线 0/3 失败）、`multi-file-bug`（基线 1/4，需改 `lib/cart.mjs` + `lib/discount.mjs`）、`small-feature`（基线 0/4，需实现 `slugify`/`uniqueSlug` 并在 `index.mjs` 导出）。
- 每个任务都验证过「参考修复后全绿」，避免任务本身不可解。
- `scripts/validation-matrix.py`：每 (task, agent, run) 一个全新 git repo，`task.json` 不进入 agent 可见目录，输出 `examples/validation/runs.jsonl` + `summary.json` + 全部 trace。
- 指标口径修正：`matchedEdits` 是一对一，`confirmedEdits` 是文件级（同名文件在窗口内确实变了）。首次跑 `small-feature` 时 agent 对 `lib/slug.mjs` 连改 4 次、watcher 只产出 3 个批次，旧口径把 2 次记成 unverified——文件没丢，是指标把「批次被前一次吃掉」误判成漏录。recall 改用 `confirmedEdits`，`unverifiedEdits` 只统计「声称改了但窗口内该文件根本没变」。

### 下一阶段（未开始）

3 task × 4 agent × 3 runs = 36 次验证，任务为单文件 bug / 多文件 bug / 小功能，记录 task outcome、availability outcome、tool calls、verified/unverified/outside edits、test runs、recovery、wall clock、capture fidelity，用来发现 Agent Replay 自身的系统性漏录。

## 9. 非目标（至少第一版）

- 不做后端、数据库、认证、LLM API 调用、实时监控。
- 不展示原始 chain-of-thought；只展示产品暴露的 reasoning summary；native adapters 忽略 thinking 块。
- 不做"自动评分/实验管理"（Phoenix/Langfuse 的领域）。
- 不做多人协作与分享链接（后续可加 URL-encoded trace / gist）。
- 不 hook Codex/Cursor/Claude 内部 tool calls 或隐藏推理；第一版只观察 workspace facts。
- 不为单个 agent 写分支 UI。

---

## 10. 收益与风险

**差异化**：时间驱动的 replay、空间化的 workspace、因果链 Inspector、双时间轴、跨 agent 对比。区别于"更漂亮的 trace 列表"。

**风险**：
- Monaco + 大 trace 的性能 → 按需懒加载、只渲染当前 span。
- 没有真实时长（SWE-agent）→ 明确标注 estimated，不误导。
- Schema 过拟合 demo → 用封闭枚举 + 未知类型回退；保留 attributes 扩展位；增加 trace-level 语义校验。
- Recorder 解析依赖测试输出格式 → 常见框架规则解析 + native terminal events + `run` 精确捕获；detected timing 明确标注 estimated。
- Native CLI 事件 schema 可能随版本变化 → adapter 对未知 type 忽略；fixtures + OpenCode/Claude/Qoder 真实 trace 覆盖当前形状；Codex/Cursor 仍需真机验证。
- 真实时间与 synthetic 注释混淆 → 每个 span 标记 timingKind；baseline/checkpoint/final 明确 synthetic，不移动真实事件时间。
- dirty worktree 下最终 patch 可能包含启动前改动 → CLI 启动时警告，建议先 commit/stash。
- 演示数据可信度 → 代码、测试输出、diff 必须自洽，能通过阅读验证。

---

## 11. 参考资料

- [Transformer Explainer](https://poloclub.github.io/transformer-explainer/) / [repo](https://github.com/poloclub/transformer-explainer) / [arXiv](https://arxiv.org/html/2408.04619v1)
- [SWE-agent](https://github.com/SWE-agent/SWE-agent) / [trajectory 格式](https://swe-agent.com/latest/usage/trajectories/)
- [OpenHands](https://github.com/All-Hands-AI/OpenHands)
- [Netron](https://github.com/lutzroeder/netron)
- [TensorFlow Playground](https://playground.tensorflow.org)
- [Algorithm Visualizer](https://github.com/algorithm-visualizer/algorithm-visualizer)
- [OpenTelemetry Traces](https://opentelemetry.io/docs/concepts/signals/traces/)
- [OpenAI Agents SDK Tracing](https://openai.github.io/openai-agents-python/tracing/)
- [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance)
- [Monaco Editor](https://github.com/microsoft/monaco-editor)
- [GitHub Primer](https://primer.style)
- [Langfuse](https://github.com/langfuse/langfuse) / [Phoenix](https://github.com/Arize-ai/phoenix)
