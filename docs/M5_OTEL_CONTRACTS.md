# M5 — OpenTelemetry Interoperability 实施契约

状态：已实现（离线 OTLP/JSON 导入）。本文件是验收规格，不是路线说明；每条契约都能在代码与测试里找到对应位置。

范围边界：**不做** backend、collector、实时流、数据库、账号、告警、SaaS。二进制 protobuf、gRPC、JSONL、厂商自定义信封（例如 OpenAI Agents API 分页响应里的 `data[].otlp.resourceSpans`）不在第一版内。

---

## A. 输入与多 Trace

| 契约 | 实现 |
|---|---|
| 入口是 `ExportTraceServiceRequest` 形状：`resourceSpans → scopeSpans → spans` | `src/adapters/otel.ts` `isOtlpTraceJson` |
| camelCase 与 snake_case 都接受（结构字段与 AnyValue 字段） | `field()` / `arrayField()` / `anyValueField()`；fixture `snake-case.json` |
| 按 `traceId` 分组，不按 resource；一个 trace 可跨多个 resource/scope | `byTrace` Map；fixture `multi-trace.json` |
| 一个文件多个 trace：全部导入并在对话框列出，不静默取第一条 | `importTraceFile()` 返回 `traces[]`；`ImportDialog` 多 trace 列表 |
| hex ID 大小写不敏感：`traceId`/`spanId`/`parentSpanId` 先小写规范化，再分组、查父、查环、去重 | `toLowerCase()` 在入组前；raw 保留原文大小写 |
| 每个 trace 只保留自己用到的 resource，`span.raw.resourceIndex` 是**本地索引**，必可解引用 | `usedResourceIndexes` + `localResourceIndex` |
| 一个 trace 跨多个服务时，`agent.name` 取最早 span 所属 resource 的 `service.name`，全部服务名记入 `metadata.otel.services` | `primaryResource` |
| `trace.id = otel_<traceId>`，重复导入幂等 | 测试 `produces stable ids for repeated imports` |
| `span.id = spanId`；同 trace 内重复视为重传，首个保留原 id、后续追加 `~2` 并诊断，子节点按首个解析；跨 trace 重复合法 | `duplicateSpanIds` 诊断 |
| ID 必须是 32/16 位 hex 且非全零；非法 `parentSpanId` 拒绝 | `isHexId` / `isZeroId`；反例测试 |
| 上限：32M 字符、20000 spans | `import.ts` `MAX_IMPORT_CHARS`；`otel.ts` `MAX_SPANS` |

## B. 时间精度

- `startTimeUnixNano` / `endTimeUnixNano` 必须是**十进制字符串**，用 `BigInt` 求差后再换算毫秒（`nsToMs`）。
- 裸数字时间戳**拒绝导入**：`JSON.parse` 在适配器看到之前就已经把 64 位整数舍入，接受它等于假装保住了纳秒精度。错误信息要求改用字符串重新导出。
- 1 ns 差保留为 `0.000001ms`；零时长保留 `endMs === startMs`（Flame 的 3px 最小宽度只是视觉，不改数据）。
- `end < start`、缺失、非数字：拒绝并给出 span 位置。
- 绝对起点：`baseUnixNano` 存于 `trace.metadata.otel.timing`，`startedAt/endedAt` 由它换算（毫秒精度，ISO 字符串本身只有 ms）。
- 跨度超过 2^53 ns（约 104 天）时给出精度告警，不静默四舍五入。
- `intValue` 以不安全 JSON number 表示时（`!Number.isSafeInteger`）同样视为已丢精度：不进入平铺属性，计入 `unsupported.unsafeNumericValues` 并给出 warning。

证据：`timing-precision.json`、测试 `keeps nanosecond precision and int64 attributes exact`、反例 `rejects numeric nanosecond timestamps`。

## C. 层级、缺父与异步子 span

- `parentSpanId` 原样成为 `parentId`，不重排、不裁剪、不拉长父节点；大小写规范化后再查父。
- OTel 允许父 span 结束后子 span 继续运行：`capture.fidelity === 'otel'` 时放宽 schema 的「子必须落在父区间内」校验（`src/schema/trace.ts` `partialExport`）。
- 缺父节点：保留悬挂 `parentId`，写入 `metadata.otel.orphanParentIds` 并产生 warning 诊断；**不**改挂到根、不伪造父节点。
- 父链成环、自父：拒绝（`traceSchema` 环检测 + 适配器自父检查）。
- 原生录制（`fidelity !== 'otel'`）保持严格包含校验，不因 M5 放松。

证据：`async-child.json`、反例测试 `rejects a parent cycle` / `rejects a self-parenting span`。

## D. 原始数据与属性

- 每个 span 的原始 OTLP 对象存入 `span.raw.otlp`，`raw.resourceIndex` / `raw.scopeIndex` 指向**本条 trace 的本地数组**，导入后保证可解引用。
- `metadata.otel.resources` 保存当前 trace 用到的 resource：`index`（原文件位置）、`schemaUrl`、`attributes`、`droppedAttributesCount`、**完整 `resource` 对象**，以及 scopes 列表；每个 scope 保存 `index`、名称/版本、`schemaUrl`、`attributes`、`droppedAttributesCount`、`spanCount`、**完整 `scope` 对象**。resource/scope 的字段不会因为模型不认识而消失。
- 平铺 `span.attributes` 只收标量与同型**基本**数组（string/number/boolean）；`kvlistValue`、混合数组、**数组套数组**、`bytesValue` 只进 raw，并产生「raw only」诊断，绝不 stringify 后当标量。
- `intValue` 超出 `2^53` 且以字符串给出时保留精确十进制字符串；以 number 给出的不安全值只留 raw 并计数。
- resource 属性与 span 属性分开保存，同名键不互相覆盖。
- `events` / `links` / `dropped*Count` 计入 `unsupported` 统计，原文保留；M5 不把它们画成独立时间轴。

证据：`attributes-nested.json`、测试 `keeps nested attributes in raw while flat attributes stay scalar`、`keeps resource and scope context verbatim`（含序列化往返深比较）、`keeps nested arrays in raw`。

## E. 状态不推断任务结果

- `status.code`：`0 → unset`、`1 → ok`、`2 → error`；同时接受 `STATUS_CODE_*` 字符串枚举。
- `unset` 是独立值，不是成功；Inspector 显示 `unset`，颜色中性。
- 导入 trace 的 `status` 固定为 `partial`，`result.tests` 留空，`termination` 不生成，`result.summary` 明确写「span status 不是任务结论」。
- 工具 ERROR 不会让 trace 变 `fail`；后续 ok 也不会被识别成 recovery。
- **通用属性不进入测试语义**：OTel trace 的 `passed` / `failed` / `total` 属性即使出现在 `test` 类型 span 上，也不会被当作测试观测，不生成 test story / recovery；`passed`/`failed`/`total` 三个字段走同一个来源门禁，只带 `total=7` 也不会画出绿色 “0 passed”。只有显式 `test` artifact 才算（OTel 导入不产生 artifact）。
- LLM span 映射为 `generation`（LLM），不映射成 `reasoning`。

证据：`status-unset.json`、`error.json`、`ai-trace.json`、测试 `does not build a recovery story from generic passed/failed attributes`、`does not turn a lone total attribute into a green test story`。

## F. GenAI / tool 语义映射

优先级（`mapType`）：

1. `gen_ai.operation.name` ∈ {`chat`,`text_completion`,`completion`,`generate_content`,`generate_text`} → `generation`
2. `gen_ai.operation.name` ∈ {`invoke_agent`,`create_agent`,`agent`} → `agent`
3. `gen_ai.operation.name` ∈ {`execute_tool`,`tool_call`,`tool`} 且有精确工具名 → 白名单类型；**没有工具名时保持 `tool`**，不会因为带 `gen_ai.provider.name` 就升级成 `generation`
4. 精确工具名白名单 → `read` / `edit` / `shell` / `search` / `test` / `browser`
5. 其余 → `unknown`，`otel.typeSource` 说明来源（`fallback` / `gen_ai.operation.name (unmapped)` / `gen_ai.* (no operation)`）

约束：

- 只做**精确**工具名匹配，不按名字子串猜语义（`run_shell_thing` 不等于 shell）。
- `gen_ai.system` / `gen_ai.provider.name` / `gen_ai.request.model` 单独存在**不能证明**是 LLM 调用，因此不推断 `generation`，保持 `unknown`。
- 未识别时保留 `unknown`，`span.name` 与 `otel.kind` 原样展示，`otel.typeSource` 说明来源。
- 不生成 artifacts（不伪造 diff / test 结果 / terminal 输出）。

证据：`nested.json`、`generic.json`、`real-exporter-node.json`、测试 `keeps an explicit tool operation generic`、`does not infer generation from provider or model attributes alone`。

## G. 来源与保真

- `capture = { fidelity: 'otel', timing: 'observed', adapter: 'otlp-json', sources: ['otlp'], workspaceVerification: 'unavailable' }`。
- 不填 `workspaceVerified: 0`，不填 recall，不借用 `native+workspace` 的措辞。
- UI：`OTEL TRACE` + `EXPORTER TIMING` 徽章；Overview 底栏写 `OpenTelemetry export · not workspace verified · task outcome not evaluated`；文件数显示 `—` / `files n/a`。
- `EXPORTER TIMING` 表示「时间由导出方提供」，不表示本机测过或时钟无偏差。

## H. UI 最小适配

- 播放列表改用 `playbackSpans()`（全部 span），父节点可发现、可选中；`leafSpans()` 仍用于统计与故事。
- Span log 按 `parentId` 缩进；Inspector 增加 `Parent`（缺失时显示 `not in export`）与 `Children`。
- Flame 同类型重叠 span 贪心分行，块的真实 `startMs/endMs` 不变，只改绘制行。
- 多 trace 文件导入后对话框列出每个 trace；**单 trace 但存在诊断时也停留在对话框展示诊断**，不再直接关窗。
- 新增 `generation` / `unknown` 两种 span 类型，配色、图标、lane 顺序、artifact 偏好同步补齐。

---

## 验收矩阵

| Fixture / 用例 | 覆盖契约 | 关键断言 |
|---|---|---|
| `generic.json` | A/F/H | 1 trace，父子关系，未识别 span 为 `unknown` |
| `nested.json` | C/F | 三层嵌套，`generation`/`shell`/`test`/`read` 映射，父节点在播放列表 |
| `parallel.json` | B/H | 同类型重叠时间不被改写，Flame 分行 |
| `error.json` | E | span `error` + exception event，trace 仍 `partial`，无 tests |
| `ai-trace.json` | F | 两个 `generation`，无 `reasoning` |
| `multi-trace.json` | A | 2 个 traceId、2 个 resource、跨 trace 重复 spanId、**每条 trace 的 service 与 resource 指针正确** |
| `timing-precision.json` | B/D | 1 ns 差保留，零时长，int64 精确字符串 |
| `async-child.json` | C/H | 子晚于父结束，缺父保留悬挂引用 + 诊断（单 trace 也在对话框展示） |
| `attributes-nested.json` | D | 嵌套/混合/bytes 只进 raw，resource 与 span 同名不覆盖 |
| `status-unset.json` | E | `unset` ≠ 成功 |
| `snake-case.json` | A | 结构字段与 AnyValue 的 snake_case 均可读 |
| `real-exporter-node.json` | 互操作冒烟 | 真实 exporter 输出可导入，层级/状态正确 |
| 测试内构造 | A | 大小写混合 ID 归入同一 trace，parent 不误判 orphan |
| 测试内构造 | D | resource/scope dropped 计数与 scope attributes 保留，序列化往返不丢 |
| 测试内构造 | B | 数字时间戳拒绝，不再静默丢精度 |
| 测试内构造 | D | 数组套数组只进 raw，导入不失败 |
| 测试内构造 | F | `execute_tool` 缺名保持 tool；provider/model 单独存在不推断 generation |
| 测试内构造 | E | 通用 passed/failed/total 属性不生成 test story / recovery；显式 test artifact 仍生效 |

反例（测试内构造）：非法 traceId/spanId、全零 ID、负时长、父链成环、自父、非 OTLP 文档。

真实 exporter 来源：`@opentelemetry/sdk-trace-node` 2.12.0 + `@opentelemetry/exporter-trace-otlp-http` 0.223.0，OTLP/HTTP JSON，2026-10-20 捕获；详见 `examples/otel/PROVENANCE.md`。

## M5 完成标准对照

| 标准 | 状态 | 证据 |
|---|---|---|
| OTLP JSON import | ✅ | `importTraceFile` / `isOtlpTraceJson` |
| OTel Span → Agent Replay Span | ✅ | `otel.ts` `buildTrace` |
| GenAI/tool semantic mapping | ✅ | `mapType` + 测试 |
| nested spans preserved | ✅ | `nested.json`、`spanDepths` |
| parallel spans preserved | ✅ | `parallel.json`、`packSpanRows` |
| errors preserved | ✅ | `error.json`、`otel.statusMessage` |
| attributes preserved | ✅ | `raw.otlp`、resource/scope 上下文、嵌套属性测试 |
| fidelity metadata | ✅ | `capture.fidelity = otel` |
| fixtures + regression tests | ✅ | `src/adapters/otel.test.ts`（32 项） |
| UI 能直接 replay imported OTel trace | ✅（离线导入路径） | ImportDialog → Replay；父节点/并行 lane；单 trace 诊断展示 |

## 已知边界（未验证，不得当作已完成）

1. 只用 Node SDK 的真实导出做了互操作冒烟，**没有**逐个框架实测 OpenAI Agents、LangGraph、OpenInference、Phoenix；「符合 OTLP JSON 契约」不等于「某框架开箱即用」。
2. OpenAI Agents API 的分页外层响应需要先取出 `data[].otlp.resourceSpans` 再导入。
3. 不支持 protobuf、gRPC、JSONL、collector 接收端。
4. 不检测时钟偏移；`EXPORTER TIMING` 只声明来源。
5. OTel `events` 只计数并保留原文，不进入独立时间轴；`links` 不绘制关系图。
6. 未做大规模性能基准；20000 spans 是硬上限而非实测拐点。
7. 数字形式的时间戳与不安全 intValue 直接拒绝或降级为 raw，不做「无损数字解析」；需要精度的导出必须使用字符串。
8. 未评估浏览器 `localStorage` 容量：导入的 trace（含 raw 原文）会随会话持久化，超大 trace 可能超出配额。
