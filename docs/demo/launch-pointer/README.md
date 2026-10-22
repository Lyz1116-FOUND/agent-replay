# 角色即鼠标 · Three.js 发布版

用户选择：浅色桌面、产品蓝；小角色点击、打字、拖拽，带镜头走过失败 → 回放 → 修复。

本版为用户认可草稿后的 24 秒发布片，1080p60；保留草稿和已发布视频。Three.js 程序化建模；没有使用 Blender，也没有声称已观看尚未提供链接的 Clawd 参考视频。onetake 的非商业许可范围仍然适用。

本轮强化：连续插值的眼形、视线、眼睑、眉毛与嘴形；吃惊、怀疑、专注、思考、发现线索、开心和邀请的表情；托腮、动作预备、踩踏、身体倾斜、触角回弹、两次庆祝跳跃和挥手。新增角色反应近景、落点震动、界面弹性、点击扩散环，保留代码阅读和结尾的静止。色彩收紧为更深的产品蓝，声音补齐脚步、靠近、跳起和落地。

发布前的最后一轮聚焦：阅读代码时降低标题、非选中代码行和时间线的对比度；移除编号式功能标签；大标题在片尾主体落定后才出现。转场从原本不起眼的细节展开：回车箭头中心打开工作台、时间线游标展开代码框、`False` 的下划线长成测试面板、通过结果底部的细线打开产品录屏、窗口边缘的小点引导窗口收拢并被角色带回片尾。这些变化使用同一场景与 `OM.morphRect`，没有整页交叉淡化。

[在线观看](https://lyz1116-found.github.io/agent-replay/launch/) · [1080p60 MP4](https://github.com/Lyz1116-FOUND/agent-replay/releases/download/v1.0.0-beta.1/agent-replay-pointer-final-1080p60.mp4) · [可重建源码](https://github.com/Lyz1116-FOUND/agent-replay/releases/download/v1.0.0-beta.1/agent-replay-pointer-final-source.zip)

## 分镜与衔接

| 时间 | 动作 / 镜头 | 留下来的主体 |
| --- | --- | --- |
| 0–2.4 | 蓝色角色逐字输入，按下 Replay | 输入条自身扩为工作台 |
| 2.4–5.5 | 工作台展开，失败测试弹出；角色吃惊后退，镜头推近怀疑的眼神 | 同一角色、同一窗口、同一时间线 |
| 5.5–8.4 | 角色抓住时间线并向左拖，镜头提前抵达编辑节点 | 时间线游标成为代码焦点 |
| 8.4–13.4 | 放大历史编辑，先看错误比较，再看 True → False；留阅读停顿 | 同一代码面板与角色 |
| 13.42–16.95 | 代码下划线扩为历史测试结果，14 passed；弯眼笑、跳起、落地 | 同一细线与角色 |
| 16.95–20 | 通过结果底部的细线展开真实产品录制画面 | 同一细线、同一物理窗口 |
| 20–24 | 窗口向边缘小点收拢，角色带回播放按钮；品牌最后落定 | 小点、角色和窗口收拢的按钮 |

所有 LRU 编辑与测试来自已有 built-in demo 的重建，不表示新执行的测试或自动修复能力。真实产品画面来自 `../launch/assets/product-source.mp4`。保留画内来源标签。

## 依赖与许可

使用用户指定的 [onetake](https://github.com/feitangyuan/onetake) 的运动库、参考分析与验收工具。它采用 **PolyForm Noncommercial 1.0.0**。依赖保存在忽略目录 `demo-output/onetake-skill/`，不将其复制成仓库 MIT 代码；本次按非商业制作范围提供。商业发布须先解决 onetake 授权。

本目录自编角色、画面与合成脚本按仓库许可；字体沿用原工程 OFL 字体，音效为本地程序合成。Three.js 为 MIT。没有引入 Clawd 模型或第三方音乐。

```sh
# 仓库根目录；仅首次准备
npm ci
git clone --depth 1 https://github.com/feitangyuan/onetake.git demo-output/onetake-skill
npm install --no-save --package-lock=false three@0.186.1
node docs/demo/launch-pointer/render.mjs --preview
node docs/demo/launch-pointer/render.mjs
python3 docs/demo/launch-pointer/score.py
bash docs/demo/launch-pointer/encode.sh
```

输出：`demo-output/agent-replay-pointer-release/agent-replay-pointer-final-1080p60.mp4`。渲染器通过现有 playwright-core / Chrome 工作，`--preview` 生成关键帧，`--from` / `--to` 指定帧范围。默认 1440 帧，180° 快门，常规动作 8 次、快速运镜 16 次线性光采样。`POINTER_OUTPUT` 可指定新输出目录。网页提供 `__seek`、`__track`、`__meta` 接口。`--serve --port 4319` 启动本地交互预览；空格播放/暂停、底部进度条拖动。生成物与核验结果以实测报告为准。

表情强化版在 `demo-output/agent-replay-pointer-final/`，其源码 ZIP 保留；最初一轮草稿在 `demo-output/agent-replay-pointer/`；旧源码快照在该目录的 `draft-source/`，原源码 ZIP 同时保留。

本次 onetake 版本：`415758128aa45cc54340df40d8109363447f582e`。macOS 默认使用 Metal 后端，可用 `--gpu swiftshader` 切换软件后端。`score.py` 依赖 NumPy、SciPy，编码依赖 FFmpeg。onetake 的 Python 验收另外需要 playwright；本机适配仅将 `probe.py` 的 Chromium 启动路径指向已安装 Chrome、启用 Metal，并在技能下载目录增加 CommonJS 包标记以运行上游库自测，没有修改验收阈值。
