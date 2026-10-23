# Harness M0–M11 实现与审核记录

日期：2026-10-23，Asia/Tokyo。GitHub main 为
`d456b6e58856e8e646389af7a250f53e9af3a484`，与本地 HEAD 相同。Harness 为此基线上的
增量；审核轮在已有实现上做逐项验收与修复，没有提交、推送或发布。审核后的 live
验证与发布记录见文末。

## 附件需求对应表

| 阶段 | 当前实现入口 | 验收证据 |
|---|---|---|
| M0 Contracts | `agent_replay/harness/types.py` | types tests；五个核心契约、序列化与 token 累计 |
| M1 Single-Agent Loop | `harness/loop.py`, `harness/model_client.py` | loop/live integration tests；模型、预算、取消、异常、stuck-loop |
| M2 Built-in Tools | `tools/`, `harness/registry.py`, `harness/workspace.py` | workspace/tool tests；六个统一 ToolResult 工具、路径与输出边界 |
| M3 Verification + Retry | `harness/grader.py`, `harness/loop.py` | grader/loop tests；测试前后保护检查、反馈重试、官方成功裁决 |
| M4 Replay + Observability | `harness/artifacts.py`, `harness/events.py`, `replay/trace.py` | replay tests；131 个输出 trace 经查看器 schema 解析 |
| M5 Context Management | `context/` | context/boundary tests；full/truncated/compressed、结构化状态、预算终止 |
| M6 Benchmark + Metrics | `evaluation/`, `experiments/harness_eval.py` | 10 个 fixture 验证、13 变体 × 10 任务、失败分类与报告 |
| M7 Skills | `skills/loader.py`, `skills/builtin/python_test_debug/` | skills tests；匹配、加载及 NoSkill/Skill 对照 |
| M8 MCP | `mcp/client.py`, `mcp/adapter.py` | MCP/boundary tests；stdio adapter、半行超时、通知与响应同包 |
| M9 Reviewer | `agents/reviewer.py` | agent/boundary tests；只读审核、严格 JSON boolean、反馈重试 |
| M10 Multi-Agent | `agents/supervisor.py` | agent tests；有界 coder/grader/reviewer 轮次、共享状态 |
| M11 A2A | `agents/a2a.py` | agent tests；内部 AgentMessage/MessageBus，无外部协议实现声明 |
| 可选 Memory | `harness/memory.py` | memory tests；跨运行 JSON 记忆、按任务召回，与 context 分离 |

原有 Node recorder/viewer 与 FastAPI 服务继续使用原入口；新增 Python CLI 为
`python -m agent_replay.harness` / `agent-replay-harness`。

## 本轮复现并修复的问题

1. 过长 tool-call 参数使 context 裁剪循环不再前进：按可变 content 裁剪，无法容纳时整轮丢弃；系统指令超预算则明确拒绝。
2. Reviewer 将字符串 `"false"` 转为 True：仅接受 JSON boolean。
3. abort 后继续创建下一 attempt，或批量工具继续执行：取消停止后续操作，只保留一次最终验证。
4. stuck-loop/取消中断批量工具后缺 tool result：对未执行调用补失败 observation，保持 provider 消息完整。
5. staged/committed 编辑使 patch 为空、改动列表消失：固定初始 commit，patch/diff/stat 都对比该基线。
6. 工作区复制解引用外部符号链接：保留符号链接，由路径边界拒绝逃逸；同时禁止符号链接别名访问 `.git`。
7. benchmark 依赖可被提交清空的 git status 判断测试是否被改：对比原始任务受保护文件哈希，并在测试前后检查。
8. 官方验证执行期间改写受保护文件仍通过：CompositeGrader 在测试结束后再次检查约束。
9. TokenUsage 丢弃 provider `total_tokens`：累计显式总量，预算及统计使用累计总量。
10. HTTP 重试每次重置 timeout：重试与退避共享一次模型调用的剩余预算；Reviewer 受时间/token/call 上限约束。
11. shell/test 工具未受剩余执行时间限制：native tools 共享运行 deadline；最终 verifier 使用独立工具超时。
12. shell 只终止父进程、输出先无限缓存：改为有界首尾输出并终止普通 POSIX 进程组；避免重复 kill 已回收进程组。
13. MCP readline 可无限等待半行，或遗漏同一读取中的后续响应：有界字节 buffer + select + os.read；关闭时等待回收进程。
14. benchmark 可以标 live 却默认使用 oracle：live 缺 model factory、backend/evidence 不匹配时立即拒绝；scripted CLI 明确标 mechanics。
15. 本地 Python 产物污染 Git/lint、CI 没有 Python 门禁：新增忽略项及 Python 3.10/3.13 CI，包含 fixture 和 scripted 实验。

回归用例在 `tests/test_harness_boundaries.py`。关键缺陷先复现失败，再检查修复后的行为。

## 复现与证据

```bash
.venv/bin/python -m pytest -q
npm test -- --reporter=dot
npm run build
npm run lint
git diff --check
.venv/bin/python -m agent_replay.harness validate-tasks
.venv/bin/python -m agent_replay.harness run task_004_parser_empty --backend scripted --cleanup
.venv/bin/python -m experiments.harness_eval --backend scripted --experiments all \
  --tasks all --runs 1 --out-dir results/harness-audit-20261023
```

- Python 完整测试：139 passed；包含 HTTP 假端点集成测试。另有 1 条现有 Starlette/httpx 弃用警告。
- Node：25 文件、210 tests 通过；build/typecheck、lint 与 diff whitespace 检查通过。
- Fixture：10/10 均 baseline fail、reference pass。
- 130 次 scripted 实验已完成：no-verification 误完成 10/10；verified 误完成 0/10；retry_once 恢复 10/10，Pass@1 为 0%。
- context full/truncated/compressed 均通过，平均累计 context tokens 为 12,860 / 4,362 / 2,997。
- parser 演示：5 steps、4 tool calls、4 tests pass，0 retries；scripted token usage unavailable。
- 130 实验 trace + 1 parser trace：131/131 经 `src/schema/trace.ts` 的 `parseNativeTrace` 校验。
- 报告及原始数据：`results/harness-audit-20261023/{report.md,summary.json,raw_runs.jsonl}`。

审核按只读方式复现缺陷，主流程修复后反复复核；最终针对性复核 31 项通过，未发现
审核范围内剩余实质阻断缺陷。

## 证据边界与剩余限制

- 所有本轮 benchmark 为确定性 oracle，验证循环和实验管道；没有运行真实模型，不代表模型能力或多 Agent 收益。
- Experiment 1 的 single_shot 是一次 tool-call turn，允许批量编辑；不是不带工具的纯文本 prompt 对照。
- shell 是资源约束执行器，denylist 不是安全沙箱；恶意代码、脱离 session 的进程或外部 MCP 需要 OS 级隔离。
- 时间预算约束 agent 执行，停止后仍运行最终 verifier，因此总耗时可能超过 agent timeout；自定义 in-process tool 必须协作遵守 deadline。
- 测试输出只保存有界首尾，巨大输出中间的失败 ID 可能缺失；非标准测试输出无法解析时按 unverified 处理。
- 早期 setup 异常可留下部分产物；完整 artifact 契约适用于正常走到 finalize 的 run。
- 内部 A2A、确定性摘要、JSON Memory 均按实际范围描述；未声称外部 A2A 协议、模型摘要或向量检索。
- 本机验证使用 Python 3.13/macOS；GitHub Actions run `39898175753` 在
  Python 3.10/3.13 与 Node 22/24（macOS/Linux）矩阵上全部通过。Windows
  transport 未实现。

## 审核后的 live 验证（2026-10-23）

审核完成后，使用 `spark-x2.6`（OpenAI-compatible `/v2/chat/completions`）跑了
完整 live benchmark：**130 runs = 13 变体 × 10 任务，每格 1 次，共
2,423,838 tokens**。API key 仅通过环境变量传入，未写入仓库、文档或运行产物。

| 变体 | Harness | Verified | Tokens | 平均 context |
|---|---:|---:|---:|---:|
| harness | 10/10 | 10/10 | 190,162 | 11,972 |
| single_shot | 0/10 | 0/10 | 10,707 | 254 |
| no_verification | 10/10 | 10/10 | 230,947 | 15,094 |
| verified | 9/10 | 9/10 | 227,731 | 14,965 |
| context_full | 10/10 | 10/10 | 229,321 | 14,558 |
| context_truncated | 10/10 | 10/10 | 155,643 | 8,177 |
| context_compressed | 10/10 | 10/10 | 107,161 | 4,161 |
| single_agent | 10/10 | 10/10 | 189,752 | 12,048 |
| coder_reviewer | 10/10 | 10/10 | 220,387 | 13,138 |
| no_skill | 10/10 | 10/10 | 220,019 | 14,314 |
| with_skill | 10/10 | 10/10 | 192,007 | 11,632 |
| no_retry | 10/10 | 10/10 | 216,854 | 14,005 |
| retry_once | 10/10 | 10/10 | 233,147 | 15,001 |

关键边界：

- `single_shot` 是单轮 tool-call 基线，单轮预算内未编辑，10/10 失败，不是通用
  单 prompt 结论。
- live 模型即使关闭 Grader 也实际修复了任务，false completion 为 0；可控的误接受
  证据仍是 scripted 实验（10/10 接受、10/10 事后失败）。
- `verified` 的 1 次失败是 provider timeout（I1），不是测试失败。
- `no_retry` 已 10/10 首轮通过，live 重试恢复未被触发；可控证据仍是 scripted
  `fail_first`（10/10 recovery）。
- coder+reviewer 都是 10/10；本轮不能证明 reviewer 提升成功率，且多消耗约
  30.6k tokens。
- 所有 live 结果都是单次运行，不构成排名或显著性结论。

原始结果与报告：`results/live-bench/full-spark-20261023/`（本地、gitignored）。
