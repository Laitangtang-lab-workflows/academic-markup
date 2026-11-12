# academic-markup

**AI 辅助学术写作的内嵌标记：生成、改写、翻译、事实核对、扩写、缩写、插入引用——一条完整的"提取→召回→处理→组装→报告→写回"管线，本地文献库全程参与。**

> [!NOTE]
> 本仓**全部内容由 AI 维护**，人类定方向、做决策，详见 [AI 维护声明](#ai-维护声明)。英文说明见 [README.md](README.md)。

## 解决什么问题

人与 AI 合作写手稿需要一份契约：作者标出**对某段做什么**，AI 决定**怎么做**，结果带着可追溯的注解写回文件。本 skill 就是这份契约，提炼自数月的真实手稿工作：

- **轻量内嵌标记**——`gg'提示'gg`（生成）、`rr'原文'rr`（学术英文改写）、`tt'中文'tt`（翻译）、`vv'论断'vv`（对本地文献库核对）、`ee'..'ee`（扩写）、`cc'..'cc`（缩写）、`[['']]`（插入引用）、`[??]` 与 `[fig: ...]` 占位符
- **九步管线**（`/academic-markup` 单入口）：文献库预检 → 提取 → 召回 → 处理（AI 的创造步，受严格规则文档约束）→ 组装 → 报告 → 干跑预览 → 确认写回 → 引用编号与文献列表。确认写回之前的每一步只写 `operations/`，完全可逆
- **本地文献库接地**：召回从项目 `reference_materials/` 期刊区取片段，结果靠你精心整理的库而非模型泛化记忆
- **引用生命周期**：`[['']]` → `[@citekey]<!-- cite -->` → `[N]<!-- ref -->` 加生成的 ```reference 块；DOI 优先按 ENW/RIS 解析、`_index.json` 兜底；幂等重编号；未解析标记原地保留，库长齐后自动补上
- **代码区免疫**：行内代码与围栏代码块内的标记永不生效——检测跑在剥码等长副本上，文档里展示标记示例是安全的
- **零依赖实现**：只用 Node.js 内置模块；整个文件夹拷进任何项目的 `.agents/skills/` 即可用

## skill 安装

```
git clone https://github.com/Laitangtang-lab-workflows/academic-markup ~/.agents/skills/academic-markup
```

兼容一切支持 SKILL.md 约定的 agent 框架（Claude Code、DeepSeek Harness 等）。需要 Node.js；召回需要 `reference_materials/` 文献库（由 note-gen skill 建库），其余子命令独立可用。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `SKILL.md` | skill 入口：全管线、子命令、标记速查 |
| `references/markup-dictionary.md` | 标记完整规范 |
| `references/pipeline-workflow.md` | 步骤与文件、operations/ 布局、多手稿机制 |
| `references/process-ops-rules.md` | AI 创造步的规则（注解 schema 与分型规则） |
| `references/build-references-design.md` | 引用编号引擎的设计与实施记录 |
| `scripts/enforce-markup.mjs` 加 `scripts/lib/` | 管线实现（零依赖） |

## AI 维护声明

本仓全部内容（代码、文档、本 README）由 AI 会话在人类监督下编写与更新，管线本身的存在就是为了让 AI 在显式、可审计的规则下承担手稿处理的体力活。提交均由机器生成，人类把关方向与决策，不逐行审码。

## 证书

[CC0-1.0](LICENSE)——公有领域贡献。可任意使用、fork、并入任何项目，无须署名（注明出处是善意但非义务）。

提交 PR 即表示同意你的贡献同样以 CC0 贡献。
