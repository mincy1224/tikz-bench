# TikZ Bench 重构调研与实施计划

日期：2026-10-02。本文是调研和实施设计，尚未修改业务代码。

## 1. 决策结论与目标

优先把 **分区矩形（`rectangle split`）做成可靠、易操作的原生可编辑对象**，并交付 **可调尺寸的箭头和接近 PowerPoint 使用方式的右侧格式面板**；同步修复公式加载和文字测量。Forest / tree 布局不进入首轮交付。

项目已经有 parser → semantic scene → SVG → source patch 的完整架构，分区矩形也已有布局和渲染实现。建议局部重构这条链路，保留源码作为唯一持久化事实来源。无需更换 React、重写解析器或将所有图形交给服务端编译。

真实 TeX 编译作为高级代码的保真校验和可选预览后端。编译得到的 SVG 缺少可靠的源码与交互映射，不能自动替代原生可视化编辑。

首轮用户流程：

1. 工具栏选择“分区矩形”，直接创建左右两个分区。
2. 在画布中双击任一区域，只编辑该区域的内容，支持中文和公式。
3. 右侧调整横排／竖排、分区数、各区填色、内边距和分隔线。
4. 整体移动、连接箭头、撤销／重做，源码即时同步。
5. 保存、刷新、导出后，内容与显示保持一致。

## 2. 调研范围与证据

已检查内核 multipart 解析、布局、scene 文字映射、图形预设、画布文字编辑、MathJax 初始化、计算缓存、原生编译、SVG 净化、项目主页与保存逻辑。

### 2.1 已有能力

| 能力 | 当前证据 | 判断 |
| --- | --- | --- |
| 分区矩形形状 | `semantic/nodes/multipart.ts`、`multipart-layout.ts`、`evaluate.ts` | 已实现，不应重新造一套 |
| 横排／竖排，1–20 个分区 | parts / horizontal 解析和布局 | 有基础实现，需针对边界验证 |
| 分区文字与分隔线 | `evaluate.ts` 生成独立 Text 和 Path | 有基础实现 |
| 分区填色、分区对齐 | multipart-layout 的 fills / alignments | 有实现，有明确缺口 |
| 分区锚点 | `semantic/nodes/anchors.ts`，相关语义测试 | 有实现，需检查空分区和变更后的身份 |
| 能力记录 | `capabilities/matrix.ts` 的 `shape_rectangle_split` | parser / semantic / SVG 标 stable，edit 标 partial |
| 自动补宏包 | `test/semantic/required-tikz-libraries.spec.ts` | 原生 multipart 已有库依赖机制 |

运行 `npx vitest run test/semantic/nodes-helpers.spec.ts test/semantic/nodes-shapes.spec.ts test/capabilities.spec.ts`：3 个文件、113 项测试通过。这证明现有基础功能有回归保护，不能证明逐区编辑、所有 PGF 选项或浏览器视觉效果正确。

### 2.2 已复现／确认的问题

| 问题 | 代码或运行证据 | 影响 |
| --- | --- | --- |
| 分区矩形没有标准创建入口 | `NodeShapePresetId`、`NODE_SHAPE_OPTIONS`、`NODE_SHAPE_KNOWN_KEYS` 均不包含 rectangle split | 用户无法按普通图形流程创建、配置 |
| 分区文字共享整个节点的源码范围 | `evaluate.ts` 给每个分区 Text 都传 `item.textSpan`；直接执行 render 得到两区同一 span | 画布逐区编辑目标不准确，有误改整段内容风险；实际点击后果需 E2E 验证 |
| 局部选项被丢弃 | `parseNodeParts` 跳过 `\nodepart[...]`，只返回 name / text | 局部 text width / font / align 无法进入布局 |
| 填色列表位置被破坏 | `resolveRectangleSplitPartFills` 丢弃 none；执行 `{white,none,red}` 得到白、红、红 | 分区对应关系错误；非法颜色也可能使后续索引前移 |
| 默认公式依赖 CDN | `mathjax-engine.ts` 从 jsDelivr 加载 startup；服务端 CSP 只允许 self | 生产加载配置存在确定冲突，需浏览器复现确认具体表现 |
| 原生预览字体可能在净化后丢失 | 服务端 dvisvgm 用 woff2；前端净化删除 style；预览实际调用净化 | 内嵌字体／类样式可能被移除，需用真实产物验证 |
| 原生编译缺少 Unicode / Forest 片段配置 | server 固定 latex / DVI；`createStandaloneDocument` 只加载 TikZ | 所给中文 Forest 例子不适合直接走当前通道 |

补充发现：最小 `tikzpicture` 两分区节点的语义求值没有诊断，能产生“Root”和“根节点”两个 Text；`{white,red!15}` 也产生两个正确的填色块。因此原示例整体失败不能归因于 rectangle split 完全不支持，Forest 环境与可视化操作缺口需要分别处理。

### 2.3 调研限制

- 当前工作区没有 `pgf-docs` / `pgf-src`，因此参照在线 PGF 手册及官方源文件。
- 当前 Windows 会话找不到 latex、xelatex、dvisvgm；WSL 枚举返回访问拒绝。尚未做真实 TeX 对照或中文字体视觉验收。
- 没有实际用户失败公式的最小样本，CSP 冲突是已确认的问题，不宣称它解释所有公式异常。
- 当前存在大量用户已有工作区修改。后续以当前内容为基线，小步修改；不得覆盖或清理已有修改。

## 3. 路径选择

| 路径 | 优点 | 成本／限制 | 结论 |
| --- | --- | --- | --- |
| 补齐原生 multipart 节点 | 实时编辑、源码映射、拖动、连接、离线可用；复用现有代码 | 需要处理源码身份、文本测量和 PGF 规则 | 首选，首轮主线 |
| 全部改成 TeX 编译预览 | 高级宏包和真实排版兼容性较好 | 依赖工具链，延迟更高，SVG 无直接编辑映射 | 用于校验和可选保真预览 |
| 多个独立矩形拼成分区节点 | 初期容易画出来 | 拖动、边框、锚点、源码导出和撤销难一致 | 不作为数据模型 |
| 先实现 Forest | 可运行原树图结构 | 额外语言、样式继承和树布局；远大于当前重点 | 延后 |

推荐保留“一节点、多分区”的语义身份。SVG 可以仍由多个图元组成，但选中、移动、删除和连线必须认同一个节点；编辑某个分区时使用独立的 part target。

## 4. 核心重构设计

### 4.1 结构化分区解析与源码映射

新增专门的 multipart source model，逐步替换当前仅有 `{name,text}` 的结果。建议字段：

```ts
type ParsedNodePart = {
  canonicalName: string;
  sourceName: string;
  occurrenceIndex: number;
  contentSpan: Span;
  commandSpan?: Span;
  options?: OptionListAst;
  optionsSpan?: Span;
  rawText: string;
};
```

具体落点：`semantic/nodes/multipart.ts`、`ast/types.ts` 或邻近的专用类型模块、`semantic/types.ts`、`semantic/nodes/elements.ts`、`semantic/nodes/evaluate.ts`。

- 源码 span 使用绝对坐标；保留原始空白、括号、注释，不用 trim 后文本推导偏移。
- 使用项目已有 token / 分组扫描工具处理嵌套括号、转义、注释和命令边界，避免仅凭 `indexOf` 识别命令。
- 首区隐式内容与 `\nodepart{one}` / `\nodepart{text}` 明确统一；命名别名按目标 PGF 版本核实。
- 不把重复同名分区提前合并成一个不可定位的编辑范围。显示语义按 PGF 对照确定；原始 occurrence 始终保留。
- scene 的每个分区 Text 增加 part identity 和独立 textSourceSpan；整体 node sourceId 保留。
- 宏展开、foreach 或不能唯一定位的文本进入既有模板编辑／源码定位流程；不得猜测范围后直接覆写。

验收：修改第二分区只产生第二分区正文的 source patch，第一分区、`\nodepart`、节点选项和注释保持原样。

### 4.2 统一布局结果

保留 `resolveRectangleSplitLayoutGeometry` 的职责，但将它变成唯一的 multipart 布局结果来源：

```text
parsed parts + node options + per-part options
                ↓
resolved parts: style / text metrics / source identity
                ↓
multipart layout: bounds / part rectangles / text origins / dividers / anchors
                ↓
SVG、命中区域、选中框、连线、Inspector
```

- 各区单独解析局部 text width / align / font，并通过同一个 NodeTextEngine 测量。
- 保留 logical part index 与 visible part index。空分区隐藏不能导致颜色、名字和锚点都按新序号错位。
- 文字位置、分隔线、填色和锚点从同一份几何读取，避免当前不同步骤重算的偏差。
- 核实 minimum width / height 对分区扩展的规则；不能默认“按比例拉伸”就是 PGF 行为。
- 字号、em / ex、文本 ascent / depth 和内边距使用同一解析上下文。
- 支持旋转、scale、transform shape、定位和矩阵使用同一结果；不给矩阵单独维护另一份 multipart 公式。
- 未支持的局部键保留源码并给可理解的诊断，不静默忽略。

### 4.3 填色与 PGF 兼容性

- 填色列表必须保留每个槽位，包括透明和无效值；非法颜色诊断不能使后面的颜色前移。
- 短列表的补齐策略、重复设置键的覆盖顺序、整体 fill 与 part fill 的绘制顺序，按目标 PGF 版本测试。
- `draw=false`、隐藏分隔线、粗线、透明度也进入同一 paint resolution。
- 当前官方源文件中的 `rectangle split uses custom fill` 与手册描述的 `use custom fill` 存在命名差异，必须核对锁定版本的实际可用键；不要盲目按文案实现一个不存在的导出键。
- 手册中布尔参数省略时的 default 不等于初始值；空分区规则尤其不能仅根据该标注改变实现。

PGF 依据：[multipart 手册](https://tikz.dev/library-shapes)、[官方形状源文件](https://github.com/pgf-tikz/pgf/blob/master/tex/generic/pgf/libraries/shapes/pgflibraryshapes.multipart.code.tex)。此处应锁定用于对照的版本或 commit，记录差异。

### 4.4 编辑动作与 Inspector

扩展现有 source patch / property write planner，而不是用 UI 拼接、正则替换整份文档。

建议动作：设置分区正文、设置局部文本选项、设置分区填色、切换排列方向、设置分区数、插入／移除分区。

- toolbar 默认创建左右两区；单击和拖动创建沿用已有工具手势。
- shape presets / known keys / adaptive controls 加入 rectangle split，并更新图形预览。
- Inspector 提供排列、分区列表、各区内容与填色、内边距、分隔线开关；复杂选项折叠显示。
- 画布单击选整体、双击正文编辑当前区；命中分隔线仍可选中整体。
- 逐区文字编辑应接入现有文本编辑状态机、IME、撤销和源码 patch。
- 首轮不做“拖分隔线调宽”。若要做，先确定对应的可导出 PGF 约束，避免引入只在编辑器内部生效的尺寸字段。
- 减少分区数时不静默丢弃非空内容；交互预览明确受影响内容，可撤销。重排时同步更新内容／颜色／局部选项并说明锚点名字变化。
- 改变图形预设时保留原始文字；涉及丢失分区结构的转换提供清晰预览。

落点：`edit/inspector/presets.ts`、`shape-adaptive-controls.ts`、`property-target.ts`、`property-write-planner.ts`、`edit/actions/`、`ui/Toolbar.tsx`、`ui/canvas-panel/`、`ui/inspector-panel/`。

## 5. 公式与编译通道

### 5.1 先修原生公式可靠性

- MathJax runtime、扩展和动态字形资源同源打包，锁定依赖版本。只复制 startup.js 不够。
- 建立字体资源清单；当前可选字体多于本地已安装字体。首轮完整保障默认 NewCM，其余字体需安装资源后才标可用，不能静默换成另一个字体。
- 主画布、thumbnail worker、导出使用一致配置。移除 CDN 对生产和离线启动的必要依赖。
- 检查 `compute.ts` 的 textEnginePromise / resolved engine 缓存：失败要可重试，恢复后重新测量；字体切换与旧异步初始化不能互相覆盖。
- 缓存 key 包含字体、字号、公式、局部选项及影响测量的参数；公式异步字形加载完成后刷新受影响几何。
- 暂时失败时保留上一帧并显示“公式引擎未就绪／重试”；不能把普通文本降级当作正确公式悄悄展示。
- 用真实失败样本补查公式基线、fraction / sum 的高度、中文混排、宽度和裁剪问题。CSP 修复后仍需这些验证。

落点：`core/src/text/mathjax-engine.ts`、`core/src/render/index.ts`、`app/src/compute.ts`、thumbnail worker、资源准备脚本、web / desktop 构建与静态资源配置。

依据：[MathJax 自托管](https://docs.mathjax.org/en/latest/web/hosting.html)、[字体与动态资源](https://docs.mathjax.org/en/latest/output/fonts.html)。

### 5.2 保真编译作为第二通道

第一阶段用于对照；若扩展成用户功能，随后形成明确的 CompileProfile：engine、输出类型、允许宏包和诊断映射，不依赖二进制文件名猜测引擎。

- 普通 TikZ 保留 latex / DVI 兼容路径。
- 中文片段推荐研究 XeLaTeX `-no-pdf` → XDV → dvisvgm，并准备 CJK 宏包及固定中文字体；不在用户整份 document 上自动强行改写字体与 preamble。
- Forest 是可选 profile，补 forest、shapes.multipart 等必要依赖；不把 forest 环境套进 tikzpicture。
- SVG 预览优先评估 `--no-fonts` 转路径，避开当前净化删除 style 导致的字体问题；保持安全净化，而不是放开所有 style。
- 编译包装源要返回生成行号到原始行号的映射，错误能定位用户源码。
- 预览和 PDF 导出共享 profile。不同中间产物使用对应转换器，保留现有 timeout、隔离目录、no-shell-escape、并发和输入大小限制。
- 工具链检查覆盖引擎、转换器、宏包、中文字体；可用状态不是仅有 `--version` 成功。
- 异步预览绑定 source revision；过期结果不得覆盖新版本，并提供重试／日志／缺依赖提示。
- 编译快照明确标记不可逐元素编辑。高级代码错误不会被原生引擎静默截断后显示成“成功”。

依据：[dvisvgm 输出路径与字体选项](https://dvisvgm.de/Manpage/)、[XDV 支持](https://dvisvgm.de/)、[Forest 包定义](https://ctan.org/pkg/forest)。

## 6. 前端重构范围

优先按“创建 → 编辑 → 调整 → 检查 → 保存／导出”组织界面，再统一视觉样式。

### 6.1 编辑器

| 区域 | 设计 |
| --- | --- |
| 顶部项目栏 | 返回、名称、可信的保存状态、导出；避免重复命令占据主操作区 |
| 工具栏 | 选择、连接、文字、图形；分区矩形有图标和真实预览 |
| 主工作区 | 画布居中，源码面板可折叠、可调整大小；保留现有 dock 架构 |
| Inspector | 选什么显示什么；分区矩形显示分区配置，不用通用 raw key 编辑承担核心流程 |
| 底部状态 | 缩放、公式加载／错误、编译状态；可跳转对应源码 |
| 浮动文字编辑 | 稳定焦点、Esc / 提交、中文输入法、清晰当前分区边界 |

- 基于现有主题 token 统一间距、控件高度、字号、对比度、focus 状态，尊重浅色／深色设置。
- 核心操作不能只靠 hover；图标提供标签、快捷键提示和键盘焦点。
- 未保存、保存中、已保存、失败、冲突具有不同含义；失败提供恢复动作。
- 适配桌面窄窗口和常用缩放比例；窄窗口采用折叠面板，不强行缩小所有按钮。
- 复用现有 i18n 结构统一中文界面，避免新旧页面语言混杂。

### 6.2 项目主页及持久化

`apps/web/src/TikzBench.tsx` / `.module.css` 当前可以看到的缺口：卡片只有占位预览、article 点击缺少自然键盘入口、重命名使用 prompt、异步创建／导入／删除缺少一致错误处理。

建议：真实缩略图、安全展示、搜索排序、明确空状态、可访问的项目链接、重命名对话框、操作进度和错误反馈。缩略图生成异步进行，不阻塞保存正文。

保存逻辑需要同步重构：一个串行 mutation 队列管理 source、rename 和 thumbnail；每次请求记录 revision 与已提交的 draft 快照。处理“旧请求完成时已有新草稿”、重命名与保存交错、冲突及离开页面。

导出必须基于当前 draft revision：先保证该草稿提交成功，或扩展导出 API 接受当前源码快照。不能把尚未保存的画布内容与服务器旧版本导出混为一谈。源文件下载可直接使用明确的当前草稿快照。

## 7. 实施顺序与阶段验收

每阶段单独提交可审查变更；遇到兼容性差异先收敛范围，不将整份计划一次性大改。

| 阶段 | 工作 | 交付与进入下一阶段的条件 |
| --- | --- | --- |
| P0 基线 | 最小复现、版本锁定、PGF / MathJax 资源核验、保存竞态复现 | 用例记录、真实 TeX 对照可运行、当前用户变更基线保留 |
| P1 数据安全 | 分区结构化解析、独立源码 span / identity、局部 options、颜色槽位 | 逐区 patch 正确、none 不错位、原始源码 round-trip；已有测试通过 |
| P2 渲染正确性 | 统一布局、局部测量、锚点／空区／绘制规则；MathJax 同源资源与恢复 | 中文公式两区和三至四区对照通过；离线默认字体和生产 CSP 下可显示 |
| P3 可视化功能 | 图形预设、创建预览、Inspector、逐区编辑、整体拖动／连接、撤销 | 完整用户流程可操作且不改错源码；能力矩阵反映实际范围 |
| P4 产品交互 | 项目 mutation 队列、正确草稿导出、页面与编辑器视觉统一、i18n | 慢网络／失败／冲突不丢草稿；键盘、窄窗口及暗色主题验收 |
| P5 保真通道 | CompileProfile、Unicode 引擎、路径字体、依赖探测、诊断行号 | Web / desktop 对应平台实机通过；预览与导出同源快照 |
| P6 可选高级能力 | Forest profile 或独立兼容性调研 | 不影响 P1–P4 交付；是否做原生 Forest 布局另立决策 |

依赖关系：P1 → P2 → P3；MathJax 资源修复可独立推进，但 P2 验收需要它完成。P4 保存数据安全可提前修，视觉调整在 P3 操作模型确定后完成。P5 的用户功能不阻塞原生分区矩形，但 P0 / P2 需要在可用环境执行真实 TeX 对照。

## 8. 验收样本与测试策略

### 8.1 用户需求的最小样本

先从 Forest 中抽离节点，验证分区矩形本身：

```tex
\usetikzlibrary{shapes.multipart}
\begin{tikzpicture}
  \node[
    rectangle split,
    rectangle split horizontal,
    rectangle split parts=2,
    rectangle split draw splits=true,
    draw=black,
    fill=none,
    rectangle split part fill={white,red!15},
    line width=0.8pt,
    inner xsep=6pt,
    inner ysep=4pt,
    font=\small
  ] (root) at (0,0) {Root \nodepart{two} 根节点 $x^2$};
\end{tikzpicture}
```

真实编译验收时，该片段需要相应的中文 document / font 配置；上面的源码不是完整可独立编译文档。

### 8.2 必须覆盖的行为

- 2／3／4 区横排和竖排；第 5 区及 20 区作为边界回归。
- 长短文字混合、中文、fraction / subscript / sum、多行、不同字号、局部 text width。
- 中间空区、全空区、ignore empty 开关；隐藏后 logical identity 不错乱。
- fill none、列表中间 none、短颜色列表、错误颜色、整体 fill、分隔线隐藏、粗边框。
- 局部 nodepart options、嵌套分组、注释、转义命令、重复 part 名、宏／foreach 编辑边界。
- 逐区点击和 IME；单区编辑、整体拖动、复制、删除、插入区、方向切换、撤销／重做。
- 分区锚点连线，内容变长后边框与端点更新；旋转与 transform shape。
- 生产 CSP、断开外网、首次加载失败后恢复、字体切换、动态字形加载、thumbnail 一致性。
- 保存延迟与乱序、rename 交错、409 冲突、刷新、离开页面、未保存草稿导出。

### 8.3 验证层次

1. 单元测试保护解析 span、颜色槽位和局部设置；测试行为结果，不重复实现。
2. semantic / SVG 集成测试保护内容、几何、锚点和一致布局。
3. Playwright 验证真实创建与逐区编辑流程、源码结果、IME／焦点、保存和导出。
4. 用 `compare:renderers` 做聚焦 TeX 对照。固定 TeX / PGF / MathJax / 字体版本；记录边框、分隔线、文字基线和锚点差异。
5. 几何容差在基线样本上确定；相同字体的几何比较与不同字体的视觉质量验收分别记录，不承诺天然像素一致。
6. 对新增交互记录 10 / 100 个分区节点的拖动、输入与切区性能基线，后续无明确回归再扩测。

各阶段执行相关测试；最终门禁：`npm run typecheck`、`npm run lint:prod`、`npm test`、`npm run test:capabilities`、`npm run test:corpus`、聚焦 Web E2E 和 `npm run build:full`。修改共享 UI / platform 时补 desktop 构建与对应 E2E；无需为未修改的 landing 强行扩测。

capabilities 的 `feature-ids.ts`、`matrix.ts`、`registries.ts` 同步维护。保留现有 shape ID，按实际新增能力决定是否补更细的 feature；只有完整验收后才提升 edit 支持等级。

## 9. 完成标准与尚待确认事项

首轮完成标准：用户无需写 `\nodepart` 即可创建和编辑常用两至四区矩形；逐区修改安全；中文公式显示可靠；分区填色正确；移动／连线／撤销／保存／导出形成完整闭环。

不承诺首轮覆盖任意 TeX 宏、全部 Forest 语言或每一个 PGF 高级键。对不能原生理解的代码，必须保留源码、清晰报告并提供保真预览路径。

实施前仍需在目标运行环境验证：实际失败公式、部署端 CSP 响应、TeX / PGF 版本、中文字体配置和原生 SVG 产物。上述信息影响兼容性验收和编译 profile，不改变先做原生分区矩形的方向。

## 10. 箭头尺寸与右侧格式面板专项重构

新增需求：箭头大小应能直接调整；属性编辑需要接近 PowerPoint 的操作习惯。这里的目标是相似的操作模型：选中对象后出现合适的格式选项，常用属性直接操作、实时预览、支持多选且撤销一致。

本轮对当前右栏的观察来自源码、组件结构及行为测试；尚未在浏览器中实际操作当前界面。视觉层面的拥挤程度、焦点跳动和滚动表现必须在 P0 浏览器审查中验证，不能将方案示意当作实机截图。

### 10.1 箭头调研结果

- `semantic/style/arrows.ts` 已处理 length、width、scale、scale length、scale width 等箭头参数。
- `svg/arrows/metrics.ts` 和相关模块已有箭头几何及路径截短机制。放大箭头会影响端点和截短，必须沿用这条链路，不能只对 SVG marker 做 CSS scale。
- `edit/inspector.ts` 目前仅构造起点／终点的 arrowTip 类型控件，没有尺寸属性。
- `property-write-builders.ts` 的 `buildArrowTipSetPropertyMutation` 主要替换一侧箭头类型；被替换侧会重新用预设字符串构建。新增尺寸编辑不能继续把整个箭头 specification 当作只有类型的字符串。
- 直接运行语义求值：默认 Stealth 的 length / width 为 4.8 / 3.6 pt；scale=2 为 9.6 / 7.2 pt；显式 length=9pt,width=6pt 为 9 / 6 pt，均无诊断。结论是已有内核能力缺少 UI 和安全的属性写回入口。

PGF 依据：[箭头尺寸与缩放](https://tikz.dev/tikz-arrows)。交互参考：[Microsoft 的线条与箭头格式操作](https://support.microsoft.com/en-us/powerpoint/draw-or-delete-a-line-or-connector)。PowerPoint 同样区分箭头类型／大小与线条宽度，产品中也应让这些属性独立。

### 10.2 箭头操作设计

选中线条或连接线后，格式面板的“箭头”区直接提供：

| 控件 | 默认呈现 | 写回策略 |
| --- | --- | --- |
| 起点／终点 | 两个可切换端点；当前选项始终有摘要 | 精确定位某一侧；不改另一侧 |
| 箭头类型 | 带真实形状预览的选项：无、Stealth、Latex、三角等 | 保留合法尺寸与颜色选项；不兼容项明确提示 |
| 大小 | 小／中／大快捷选项，以及倍率滑杆 + 数值框 | 写入可导出的 tip scale；明确默认值基准 |
| 长度／宽度 | “精确尺寸”展开显示，单位可选，数值可输入／步进 | 按 pt 内部单位转换；保留实际用户选择的单位策略 |
| 锁定比例 | 长宽联动开关 | 一次事务写入一组尺寸，不能只更新显示 |
| 两端同步 | 明确的开关，默认关闭 | 开启后一次事务更新两侧；不会默认修改不存在的另一端 |
| 恢复默认 | 局部恢复按钮 | 移除相应局部 override，让继承重新生效 |

大小倍率与精确尺寸不能作为互相矛盾的双重状态。面板需区分“按默认尺寸缩放”与“指定实际尺寸”：已有 length / width 时显示自定义，切换模式时采用统一规范化规则，不能不断叠乘 scale。依赖 line width 的尺寸表达式保留源码，UI 显示解析后的结果并标明来源。

路径反向、交换两端箭头、复制样式属于不同动作：交换箭头不改变路径控制点，反向路径按现有编辑器语义单独处理。复合／多重箭头先显示准确摘要和高级入口；普通大小滑杆不得将复杂配置压平成单个箭头。

初期提供样式级快捷控制和精确数字，不优先加入画布上的箭头头部拖拽柄。后者需要独立处理曲线切线方向、缩放、命中和截短，验收成本更高。

### 10.3 按对象组织右侧栏

建议宽度范围为约 300–360 CSS px，可拖动调整，跟随现有 UI 缩放设置；具体尺寸在实际窗口验证后定稿。不是单纯把当前字段放大，而是重新组织信息层次。

顶部固定为选中对象摘要 + 常用格式按钮；下方以“样式／文字／排列”为主分类，按对象减少不相关分类。常用组默认展开，高级参数和源码来源收起，记住用户的展开状态。控件更新不重建面板、不移动滚动位置、不夺取输入焦点。

| 选择对象 | 首屏常用项 | 次级／高级项 |
| --- | --- | --- |
| 普通图形 | 填色、边框、线宽、透明度、尺寸 | 阴影、图形特有参数、变换 |
| 线条／连接线 | 颜色、线宽、虚线；起点／终点箭头与大小 | 精确 tip 长宽、端点缩短、复合箭头 |
| 分区矩形 | 整体边框；横／竖排列；分区列表；当前区填色和文字 | 局部宽度、空区规则、内边距、对齐 |
| 文字 | 字体、字号、粗体／斜体、颜色、对齐 | 文本宽度、行距、公式设置 |
| 多选 | 共同可写样式、对齐、分布、统一大小 | 各类对象独有属性另显示适用范围 |
| 未选择 | 创建快捷项与简短操作提示 | 项目／画布设置，不展示一长串禁用属性 |

整体样式与当前分区样式必须有明确范围标记，不能让用户猜“填色”影响全部还是某一区。未选中分区时默认编辑整体；选中分区正文后切换为该区上下文，保留“返回整体”入口。

### 10.4 统一控件与可预期行为

**数字与单位**：输入框 + 步进按钮，必要时配滑杆；支持 Enter 提交、Esc 取消、方向键步进、Shift 较大步进、直接输入单位。允许 `-`、小数点等编辑中间态，不在每个字符输入时强行纠正。失焦后只提交有效值；无效值保留供修正并在字段旁说明。

**颜色**：常用颜色、项目命名色、最近使用色、透明选项，详细选择器提供颜色／透明度。透明不等于白色。命名色和 TikZ 混色表达式保留源码含义；“自定义”不是强行转换成另一种颜色。

**多选**：不同值显示“多个值”，不显示假平均值；点击明确值时批量设置。绝对输入统一为相同尺寸，相对增减按每个对象原值计算，两者区分。部分对象只读时显示适用数量并明确原因；操作不能静默忽略部分选择。

**来源与继承**：主要流程只展示有效值；用次要标记和展开详情解释来自局部／共享样式／默认。默认编辑当前选择的局部 override，避免一改影响所有使用共享样式的图形；修改共享样式通过显式入口和影响范围预览进行。

**快捷操作**：复制格式／粘贴格式、设为同类新对象默认、恢复某组默认放在合理位置。复制格式不复制节点名、坐标、内容或连接目标。首轮确保格式复制与恢复；新对象默认偏好在后续小阶段交付。

**可访问性**：所有核心控件支持键盘和焦点可见；图标有名称；颜色状态兼有文本提示；滑杆有精确数字替代。桌面紧凑输入目标保持可用，触屏扩展命中区域。

### 10.5 必须先统一属性编辑事务

现有 right panel 有多种独立字段 renderer，hover preview 与 `recordInHistory:false` 也已有基础。滑杆 onInput 和 onChange 的调用存在重复 mutation 风险，是否导致历史或保存异常需要行为测试，不直接凭源码判定实际结果。

建议新增统一 PropertyEditSession，单选、多选、滑杆、数值拖动、下拉悬停共用：

```text
begin: 固定目标集合、base revision、原始值和源码
preview: 只改变可回滚预览，合并同一手势内的更新
commit: 校验 revision，生成完整 source patch batch，一次历史记录
cancel: 丢弃预览并恢复原始值
```

- 临时预览不触发项目自动保存，不留下永久 source 修改；可以复用现有预览机制，但必须清晰隔离 durable state。
- 一次滑杆拖动、一轮连续步进或一次多选设置只是一条 undo，而不是按每一帧／每个对象计数。
- commit 时使用当前有效 revision 和精确目标，不能把旧快照的完整源码覆盖回来。
- Escape、pointercancel、切换选择、删除目标、外部源码变更都有明确的取消／重基策略。
- 多选操作以同一 base source 构建无冲突 patch batch，原子提交；不能用旧 offsets 依次写入多个对象。
- 颜色菜单悬停预览、数字 scrubbing 和 slider 用同一套事务，简化分散的行为差异。
- 预览按帧合并，旧 compute response 按 revision 丢弃。UI 反馈先于昂贵计算完成，不为了每帧预览调用真实 TeX。

### 10.6 代码拆分建议

保留现有 inspector descriptor、property registry 和 source patch 作为基础，渐进迁移，避免完全重写：

1. **数据层**：descriptor 扩展 arrow side / tip identity / 原始 options / 名义尺寸与有效尺寸；区分 explicit override 与 inherited 值。
2. **写回层**：新增箭头 specification 的结构化更新 builder，修改单个 tip 的单个参数，保留另一侧、未知合法选项和复合 tip 顺序。
3. **事务层**：新增统一 PropertyEditSession hook / reducer，替换各字段的独立 preview / commit 处理。
4. **呈现层**：NumberField、LengthField、ColorField、ArrowEndEditor、MultipartEditor、FormattingSection 作为有明确类型的组件。
5. **面板组合层**：按对象组装少量专用区块；单选／多选共享字段控件，通过 target 集合适配，不再复制一整套视觉与行为逻辑。

优先落点：`edit/inspector.ts`、`edit/inspector/types.ts`、`property-write-builders.ts`、`property-write-planner.ts`、`semantic/style/arrows.ts`、`ui/inspector-panel/useInspectorMutations.ts`、single / multi property renderers、`InspectorPanel.tsx`、store history 与项目保存桥接。

### 10.7 调整交付优先级与验收

原 P1 的数据安全增加箭头 specification 模型和属性事务基础；P3 同时交付分区编辑及 ArrowEndEditor。右侧格式面板是首轮主交付，不只作为 P4 的视觉润色。先完成“选中箭头 → 调类型／大小／线宽 → 即时预览 → 撤销 → 导出”的闭环，再推广到其它属性组。

必须验收：

- 同一箭头只调头部大小，不改变线宽和路径长度；起点／终点可独立配置。
- 有显式长度或复合 tip 的源码不会因切换类型而无提示丢失配置。
- 直线、短线、曲线、双端箭头放大后截短合理，端点／边界与命中同步更新。
- 重复调节、切换尺寸模式不累计放大；恢复默认重新使用继承值。
- 多选 mixed 值准确；批量修改一次撤销恢复所有对象。
- 拖动实时预览、取消恢复、一次提交；预览期间不会自动保存临时值。
- 中文输入、单位输入、键盘导航、失焦、选择切换、源码同时变化不误写。
- 面板在实际窄窗口／高 DPI／暗色主题下无截断；修改属性不跳焦点、不跳滚动。
- 箭头参数导出有效 TikZ，按真实 TeX 对照验证；操作速度与用户试用记录决定控件步进和首屏密度。

整体完成标准补充：箭头尺寸无需写源码即可调整，右栏使常用格式操作直接可见；每个操作的作用范围、预览、提交和撤销都明确。
