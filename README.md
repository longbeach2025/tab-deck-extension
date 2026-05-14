# Tab Deck

Tab Deck 是一个从零实现的 Chrome 标签页管理扩展，灵感来自 Toby 的工作流，但不复用 Toby 的品牌、素材或专有实现。

项目目标是：

1. 在 Chrome 新标签页里提供结构化的标签页管理能力（Space / Collection / Link）。
2. 支持多设备同步（先 Chrome Sync，后 Supabase 云同步）。
3. 在同步链路不稳定时优先保证数据不丢（本地 fallback + 可导入导出备份）。

## 当前版本

- 稳定版：`v0.1.0`
- Beta 版：`v0.2.0-beta.1`

下载链接：

- [`v0.1.0` ZIP](https://github.com/longbeach2025/tab-deck-extension/releases/download/v0.1.0/tab-deck-extension-v0.1.0.zip)
- [`v0.2.0-beta.1` ZIP](https://github.com/longbeach2025/tab-deck-extension/releases/download/v0.2.0-beta.1/tab-deck-extension-v0.2.0-beta.1.zip)

## 核心功能（截至 `v0.2.0-beta.1`）

- 替换 Chrome 新标签页为 Tab Deck 工作区。
- 支持当前窗口标签页的全量/选择性保存。
- Recent Captures：
  - 后台周期性捕获当前打开的 tab，写入本地 session buffer，不再静默写入正式 collection。
  - 侧栏 `Recent Captures` 可选择 captured tabs，并通过 `Save selected / Save all` 显式提升到 `Auto Saved` collection。
  - 提升成功后会从 Recent Captures buffer 中移除对应 URL，避免 reload 后重复出现。
- Space / Collection / Link 三级组织结构。
- 标题、URL、域名、集合名、备注搜索（支持自然语言查询转过滤条件）。
- 一键打开集合中的全部链接。
- 手动添加链接。
- 将当前窗口 tab 拖拽到指定 Collection。
- Popup 快速保存（当前 tab / 当前窗口）。
- 云同步模式：
  - `v0.1.0`：Chrome Sync + local fallback。
  - `v0.2.x`：Supabase 云同步 + local fallback。
- 数据安全：
  - JSON 导出备份。
  - JSON 导入恢复（支持 Tab Deck 备份 + Toby 导出 JSON）。
  - 同步前防御性检查重复 link ID，避免 Supabase `ON CONFLICT` 21000 类错误。
  - 对可疑 bulk delete 设置阈值保护，降低异常本地状态误删云端数据的风险。
- 状态可视化：
  - `Status Center` 采用主消息、摘要行、折叠详情三层结构。
  - 摘要行显示同步状态点、相对同步时间和当前登录账号。
  - 当前登录账号、最近同步时间、待同步本地变更、错误详情可在 Details 中查看。
  - 登录/同步流程按阶段显示进度，并设置超时边界，避免 Supabase/Auth 异常时无限等待。
  - SUCCESS/INFO 状态消息会短暂显示后自动回到持久状态；ERROR/WARNING 会持续显示。
- 按钮反馈：
  - hover、active、disabled 状态均有明确视觉反馈。
  - 异步操作成功后按钮会短暂绿色 pulse。
- 时间可追溯：
  - link 记录 `addedAt / lastModifiedAt / lastOpenedAt`。
  - Toby 导入数据标记时间来源（`Imported time`），避免误认为原始创建时间。
  - 展示层不再对每条 URL 显示 `Exact time` 徽标，避免时间语义噪音。
- LLM 搜索增强（可选）：
  - 侧栏 `LLM Search` 可配置 `Provider / API Base URL / API Key / Model`。
  - 支持严格模式开关：`Require LLM for NL enhancement`（开启后无 LLM 不做 NL 增强）。
  - 支持极速预处理开关：`Fast preprocess mode`（仅生成 `clean_title + keywords`，换取更高吞吐）。
  - 自然语言查询会调用 LLM 做结构化解析（关键词、域名、时间范围），并与本地检索融合。
  - 支持手动预处理索引：`Run preprocess batch (200)`（每次最多处理 200 条）。
  - 支持预处理进度可视化：进度百分比 + `Last full preprocess` 精确时间。
  - 解析结果会展示为可编辑 chips，支持一键删除条件并即时重算。
- 左侧布局优化：
  - 新增统一 `Status Center` 展示动作反馈、同步状态和错误信息。
  - `Save LLM config` 会在状态区给出明确成功提示（附时间）。

## 安装方式

### 1) 本地目录加载（开发调试）

1. 打开 `chrome://extensions`
2. 开启 `Developer mode`
3. 点击 `Load unpacked`
4. 选择目录：`/Users/reclina/tab-deck-extension`

### 2) 通过 Release ZIP 安装

1. 下载发布包（建议使用最新 beta）。
2. 解压 ZIP。
3. 打开 `chrome://extensions`
4. 开启 `Developer mode`
5. 点击 `Load unpacked`
6. 选择解压后的扩展目录（不是 ZIP 文件本身）

说明：GitHub ZIP 无法实现 Chrome 一键安装。真正一键安装需发布到 Chrome Web Store。

## Supabase 云同步配置

`v0.2.x` 使用 Supabase 做后端同步（同时保留本地缓存和降级路径）。

### 数据库初始化

1. 在 Supabase 创建项目。
2. 打开 SQL Editor。
3. 运行项目内脚本：`supabase/schema.sql`。

如果你的 Supabase 项目是旧版本（`alpha.10` 或更早）已经建过表，请额外执行一次升级 SQL：

```sql
alter table public.tab_deck_user_settings
  add column if not exists theme text not null default 'system';

alter table public.tab_deck_user_settings
  add column if not exists recently_deleted jsonb not null default '[]'::jsonb;

alter table public.tab_deck_user_settings
  add column if not exists tombstones jsonb not null default '[]'::jsonb;

alter table public.tab_deck_collections
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.tab_deck_links
  add column if not exists metadata jsonb not null default '{}'::jsonb;
```

### 扩展端配置

1. 在 Supabase `Project Settings -> API` 获取：
   - Project URL
   - Publishable key（旧项目界面可能显示为 anon public key）
2. 安装 `v0.2.0-beta.1`。
3. 在 Tab Deck 新标签页 Cloud Sync 区填写 URL 与 key。
4. Sign up / Sign in。

### 邮箱确认落地页（重要）

如果不配置，Supabase 常见默认跳转为 `localhost`，用户点击确认邮件后会看到连接失败页面。

建议配置：

1. Supabase `Authentication -> URL Configuration`
2. `Site URL` 设置为真实可访问 URL（示例：`https://github.com/longbeach2025/tab-deck-extension`）
3. 在 `Redirect URLs` / `Additional Redirect URLs` 添加同一个 URL

### 同步策略说明（当前）

- 云端可用且已登录：优先云同步。
- 云端不可用或失败：本地保存并标记 pending。
- 新设备 starter deck（空 Workspace/Inbox）不会覆盖已有云数据。
- 若云端被误写为 starter deck，本地真实数据可以回推修复。

## 从 Toby 导入历史数据

1. 在 Toby 中导出 JSON（`Export Data` 或 collection 菜单中的 `Export`）。
2. 打开 Tab Deck 新标签页，点击 `Import JSON / Toby`。
3. 选择 Toby 导出的 `.json` 文件。
4. Tab Deck 会自动识别 Toby 格式，并导入为一个新的 Space（不会覆盖现有 Space）。

## 版本演进记录

### `v0.2.0-beta.1` (Beta Milestone: Complete UI Polish)

- Tab Deck 从 alpha 进入 beta，核心功能已进入面向一般使用的稳定阶段。
- 完成全部 11 项 UI 改进：
  - 按钮 hover / active / disabled / success feedback。
  - Status Center 类型化颜色、pending warning、error details、transient message、sync loading、信息层级重组。
- `manifest.json` 版本跳到 `0.3.0`，`package.json` 使用 `0.2.0-beta.1`。
- 已知限制和 beta 阶段目标详见 `CHANGELOG.md`。

### `v0.1.0`

- 完成 Tab Deck MVP：新标签页工作区、空间/集合管理、搜索、批量打开、Popup 快速保存。
- 加入 Chrome Sync 存储与本地回退机制。
- 增加打包脚本和首个可安装 Release。

### `v0.2.0-alpha.0`

- 首次引入 Supabase 云同步。
- 增加 Supabase 表结构与 RLS 策略（`supabase/schema.sql`）。
- 云端登录、读写、离线 pending fallback。
- 发布首个 Supabase 预发布版本。

### `v0.2.0-alpha.1`

- 改善 Supabase 配置/注册/登录/登出提示。
- 补充邮箱确认后再登录的交互说明。

### `v0.2.0-alpha.2`

- 修复 Cloud Sync 动作提示被刷新覆盖的问题。
- Save config / Sign in / Sign up / Sign out / Sync now 均保留可见反馈。

### `v0.2.0-alpha.3`

- 调整手动同步策略：由“强制拉云端”改为“按更新时序协调”，降低误覆盖风险。

### `v0.2.0-alpha.4`

- 云错误信息可读化（不再显示 `[object Object]`）。
- 云端写入改为外键顺序（settings -> spaces -> collections -> links），减少并发外键失败。

### `v0.2.0-alpha.5`

- 保存新集合后自动清空搜索过滤，确保右侧立即可见。
- 增加保存成功提示（包含同步状态）。

### `v0.2.0-alpha.6`

- 修复新设备 starter deck 覆盖云端已有数据问题。
- 增强“本地真实数据恢复 starter 云端”保护逻辑。
- 多设备同账号拉取路径稳定。

### `v0.2.0-alpha.7`

- 在侧栏显著显示版本号。
- Current Window 新增三态“全选/全不选”复选框。

### `v0.2.0-alpha.9`

- 新增 Recently Deleted：
  - 删除 link / collection 会进入回收区，而不是直接丢失。
  - 支持逐条恢复、清空回收区。
  - 回收区记录同步到存储设置，默认最多保留 50 条。
- 冲突处理升级为细粒度合并：
  - 本地与云端按 space / collection / link 粒度 merge，不再仅靠整 deck 覆盖。
  - link 层按 `url/id` 去重合并，降低多端并发编辑互相覆盖风险。
- 搜索增强：
  - 支持按 `space / collection / host / date` 过滤。
  - 搜索结果高亮。
  - 搜索结果可直接 Open 或 Move 到同 Space 其他 collection。
- 同步状态可视化补全：
  - Backend mode（Supabase / Chrome sync / Local）
  - Signed in as
  - Last synced
  - Pending local changes（告警）
  - Cloud error details

### `v0.2.0-alpha.11`

- 修复跨设备删除回流复活问题：
  - 引入删除墓碑（tombstone）机制，删除 collection/link 会写入可同步的删除标记。
  - merge 时先应用 tombstone，再合并数据，防止旧设备把已删除数据重新推回云端。
  - 恢复 Recently Deleted 项目时会自动移除对应 tombstone，确保恢复行为可同步。

### `v0.2.0-alpha.12`

- 新增后台静默自动保存：
  - 引入 `background service worker` + `chrome.alarms`，可在不打断用户的情况下周期保存标签页。
  - 自动保存内容写入 `Auto Saved` 集合，按 URL 去重并限制历史条数，避免无上限增长。
- 新增自动保存可视化配置：
  - 在侧栏增加 `Silent Auto Save` 控制区，支持开启/关闭和频次选择（3/5/10/15 分钟）。
  - 显示最近一次自动保存时间，便于确认后台任务状态。
- 工作区视觉区分自动保存内容：
  - `Auto Saved` 集合增加 `AUTO` 标识、系统元信息和差异化样式，和手工保存集合可直观区分。

### `v0.2.0-alpha.13`

- 新增 Toby 历史数据导入能力：
  - `Import JSON / Toby` 自动识别导入来源（Tab Deck 备份 / Toby 导出 JSON）。
  - Toby 导入会创建新 Space 并写入所有可保存链接，不覆盖现有 Space。
  - 导入时对无效 URL 过滤，并在 collection 内按 URL 去重。

### `v0.2.0-alpha.15`

- 时间可追溯增强（全链路）：
  - collection/link 增加时间来源元数据（`source / timeAccuracy / importedAt / importBatchId`）。
  - Toby 导入数据明确标记为 `Imported time`，避免误解为原始创建时间。
  - 搜索新增 `Time source` 过滤，结果默认支持按 `Recent activity` 排序。
- Collection 智能摘要生成（本地规则版）：
  - 卡片新增 `Suggest title and notes` 按钮（`G`）。
  - 基于列表内链接的标题与域名统计，自动生成建议标题与 Notes 并写回当前 collection。
- Supabase 同步兼容扩展：
  - `tab_deck_collections` / `tab_deck_links` 新增 `metadata` JSONB，用于同步时间来源相关字段。

### `v0.2.0-alpha.16` (workspace 调整)

- 根据用户反馈精简 Collection 卡片编辑区：
  - 移除自动生成 `Title + Notes` 按钮。
  - 移除手动 `Title/URL` 新增链接表单。
  - 保留 `Notes`、拖拽保存（`Drop a current tab here`）、搜索与打开能力。

### `v0.2.0-alpha.17` (AI Notes)

- 重新启用 Collection 卡片 `G` 按钮，并切换为 LLM 生成模式：
  - 通过侧栏 `AI Notes` 配置 API Base URL / API Key / Model。
  - 点击 `G` 生成中文 `Title + Notes` 建议，先预览确认后再应用。
  - 保持手动 `Title/URL` 新增表单移除状态，仅保留拖拽和窗口保存流。

### `v0.2.0-alpha.18` (AI Provider Presets)

- AI Provider 交互优化：
  - 固定预设 `OpenAI`、`MiniMax Intl`，其他渠道统一使用 `Custom`。
  - 选择预设时自动填充默认 Base URL / Model，降低配置成本。
- 新增 MiniMax 官方域名权限：
  - `https://api.minimax.io/*`

### `v0.2.0-alpha.19` (Sidebar & Notes UX)

- Collection Notes 可读性优化：
  - Notes 输入区增大并提升排版可读性。
  - Collection 卡片新增创建时间与链接数量元信息。
- 时间展示降噪：
  - 移除每条 URL 的 `Exact/Imported` 徽标展示。
  - 同步移除 `Time source` 搜索筛选项，避免使用成本。
- 左侧布局重排与状态统一：
  - 新增 `Status Center` 统一显示动作反馈、同步状态、错误信息。
  - `Save AI config` 保存后提供明确成功提示（带时间戳）。
  - 新增 AI 总开关，关闭后 `G` 按钮自动禁用。

### `v0.2.0-alpha.20` (Interaction Feedback)

- 交互反馈增强：
  - 长操作期间在 `Status Center` 显示 loading 状态，减少重复点击与不确定感。
  - `G` 按钮在 AI 生成期间进入 busy 状态并禁止重复触发。
- AI 总结行为调整：
  - AI 只生成并更新 `Notes`，不再修改 Collection `Title`。

### `v0.2.0-alpha.21` (Supabase Full Fetch Fix)

- 修复 Supabase 拉取上限导致的数据不完整：
  - `spaces / collections / links` 改为分页全量拉取（每页 1000）。
  - 避免超过 1000 行时只同步到部分数据（例如 Toby 大批量导入后只显示部分链接）。
- 修复删除对账的分页一致性：
  - 远端 ID 列表改为分页全量读取后再比对，避免单页截断引发误判删除。
- 兼容 Chrome 扩展模块解析：
  - `@supabase/supabase-js` 改为本地 vendor 文件引用，避免加载 unpacked 时出现模块解析错误。

### `v0.2.0-alpha.22` (Cloud Error UX)

- 优化云同步错误展示：
  - `Failed to fetch` 统一映射为可操作的网络诊断提示（URL/网络/代理/防火墙）。
  - 状态区不再展示冗长 `chrome-extension://...` 堆栈，错误信息更可读。

### `v0.2.0-alpha.23` (Natural Language Search MVP)

- 改造 Links 搜索为“自然语言查询 + 结构化过滤”双层检索：
  - 输入自然语言后，自动提取关键词并做同义扩展（例如 bug/issue/error）。
  - 支持自动识别域名/站点词并映射为 host 过滤（如 github/supabase）。
  - 支持相对时间词识别并映射为日期范围（如 上周/last week/最近7天）。
- 在默认排序下引入相关性评分：
  - 结合标题、URL、域名、集合名、备注与近期活跃度进行加权排序。
  - 保持“快速本地检索”，不把 AI 调用放在结果检索链路里，避免慢查询。
- 无结果自动回退（仅放宽自动推断条件）：
  - 第一轮：仅放宽 smart 日期约束。
  - 第二轮：仅放宽 smart 域名约束。
  - 第三轮：同时放宽 smart 日期 + smart 域名约束。
  - 手动输入的 host/date 过滤条件始终保持不变。
  - 该能力支持开关（默认开启）：`Auto relax smart filters on no-result`。

### `v0.2.0-alpha.24` (Editable Smart Search Chips)

- 自然语言解析结果可视化为可编辑 chips：
  - 自动识别的 `Host / Date / Term` 会显示为条件 chips。
  - 点击 chip 可一键移除对应条件，并立即重算搜索结果。
- 条件删除支持按 query 记忆：
  - 对同一条查询语句移除过的条件会在当前会话中保留。
  - 搜索为空时会自动清空当前生效条件状态。

### `v0.2.0-alpha.25` (LLM-driven NL Search)

- 移除已证伪的 AI Collection Notes 功能：
  - 移除 Collection 卡片 `G` 按钮与对应生成逻辑。
  - 保留 `Notes` 字段作为手动记录，不再自动生成内容。
- NL 搜索改为 LLM 主驱动解析：
  - 每次自然语言输入会优先调用 LLM 解析结构化条件（关键词、host、日期范围）。
  - 解析结果与本地规则结果合并，避免纯规则命中不足。
  - 解析失败时自动回退到本地规则，不中断搜索流程。
- AI 配置区改为 `LLM Search`：
  - 统一用于 NL 搜索解析配置，不再用于 collection notes 生成。

### `v0.2.0-alpha.26` (Background LLM Preprocess Index)

- 新增“后台 LLM 预处理索引”：
  - 在空闲时段批量处理链接，为每条链接生成 `clean title / one-line summary / keywords / entities / intent / language`。
  - 预处理结果保存在本地索引（不改动原始链接数据结构），搜索时自动融合这些特征。
  - 新增 `Run preprocess now` 手动触发按钮，可立即执行一轮处理。
- 新增 NL 增强严格模式：
  - `Require LLM for NL enhancement` 开启后，若 LLM 不可用则暂停 NL 增强，不再回退到本地 NL 解析。
  - 基础关键词搜索仍可用，避免完全不可搜索。

### `v0.2.0-alpha.27` (Manual Preprocess Control)

- 预处理策略改为纯手动：
  - 配置 LLM key 后不再自动触发全量预处理。
  - 仅在用户点击 `Run preprocess batch (200)` 时执行。
- 预处理执行改为分批渐进：
  - 单次最多处理 200 条链接，降低高峰限流风险。
  - 发生 429/529 过载时会暂停本批次并保留已完成进度。
- 新增可视化进度信息：
  - 展示当前完整跑一次的进度百分比（`processed/total`）。
  - 展示最近一次完整跑完时间（`Last full preprocess`）。

### `v0.2.0-alpha.28` (Recent Captures & Sync Safety)

- Auto-Saved 重构为显式提升流程：
  - 后台捕获当前打开的 tab 时只写入本地 `tabDeckSessionBuffer`，不再直接写入 collection。
  - 侧栏 `Recent Captures` 展示最近捕获记录，并支持 `Save selected / Save all`。
  - 用户显式提升后，captured tabs 会写入默认 `Auto Saved` collection。
  - 已提升的 URL 会从 Recent Captures buffer 中移除，reload 后不会重复出现。
- 同步安全增强：
  - 同步前检测重复 link ID，避免重复 payload 触发 Supabase `ON CONFLICT` 21000 错误。
  - 增加 cloud bulk delete 阈值保护，阻止异常本地状态一次性软删除大量云端 links。
  - 保留云端已有 `metadata.preprocess`，避免本地未带 preprocess 的 deck 覆盖云端增强检索数据。
- 登录诊断增强：
  - Sign in 流程显示阶段化进度。
  - Supabase sign-in、session check、deck sync 等步骤增加超时边界。
  - 登录前检查 email/password，登录后确认 session/user 存在。
- 已知遗留：
  - 21000 同步错误的代码层根因尚未锁定，目前使用防御性 dedupe 兜底。
  - 搜索延迟约 10s 待优化（Phase 5 性能优化已暂停）。
  - `saveDeckLocalOnly` 路径已实现但未连接到 UI 流程（TODO）。
  - 详细参考 `CHANGELOG.md`。

## 构建与打包

```bash
npm install
./scripts/package_release.sh
```

输出目录：`dist/`

## Toby 3xxx 历史数据离线预处理（DeepSeek）+ 批量导入 Supabase

适用场景：你已经有大量 Toby 导出历史（例如 3000+），希望先离线做结构化预处理，再一次性导入云端，避免在扩展内逐条串行跑导致耗时过长。

### 1. 准备 Toby 导出 JSON

- 在 Toby 导出 `JSON` 文件，记下本地路径（示例：`/Users/you/Downloads/toby-export.json`）。

### 2. 离线预处理（并发 + 可续跑）

```bash
cd /Users/reclina/tab-deck-extension
DEEPSEEK_API_KEY="<your_deepseek_api_key>" \
npm run preprocess:toby:deepseek -- \
  --input /Users/you/Downloads/toby-export.json \
  --output /Users/you/Downloads/toby-preprocessed.json \
  --space-name "Toby Imported (Preprocessed)" \
  --concurrency 5 \
  --checkpoint-size 50
```

脚本特性：

- 并发处理（默认 5），不是逐条串行。
- 失败自动重试（429/5xx/529）。
- 断点续跑：默认读取已有输出并跳过已完成记录（可用 `--no-resume` 关闭）。
- 当前版本务实策略：不抓正文，仅基于 `title + url + domain + meta description` 做结构化抽取。

输出文件会包含可直接导入 Supabase 的 `rows.spaces / rows.collections / rows.links`，以及每条链接的 `metadata.preprocess` 结果。

### 3. 导入 Supabase（批量 upsert）

需要准备：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`（仅用于离线导入脚本，不要写进仓库）
- 目标用户 `user_id`（Supabase Auth UUID）

```bash
cd /Users/reclina/tab-deck-extension
SUPABASE_URL="https://<project>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service_role_key>" \
npm run import:preprocessed:supabase -- \
  --input /Users/you/Downloads/toby-preprocessed.json \
  --user-id <auth_user_uuid> \
  --batch-size 200
```

可选参数：

- `--dry-run`：只做输入校验与条数统计，不写库。
- `--no-set-active-space`：导入后不覆盖 `active_space_id`。

### 4. 生成 embedding（离线批量，本地 0 成本推荐）

可在结构化预处理完成后，对本地中间文件继续做向量化，结果仍写回 JSON 中每条 link 的 `metadata.preprocess.embedding*` 字段。

```bash
cd /Users/reclina/tab-deck-extension
npm run embed:preprocessed:local -- \
  --input /Users/you/Downloads/toby-preprocessed.json \
  --output /Users/you/Downloads/toby-preprocessed-embedded.json \
  --model BAAI/bge-m3 \
  --batch-size 32 \
  --checkpoint-size 200 \
  --normalize
```

说明：

- 第一次运行需要安装依赖：
  - `pip3 install sentence-transformers`
- 首次加载模型会自动下载 `BAAI/bge-m3`（下载后可离线复用）。
- 默认增量模式：`embeddingStatus=ready` 且输入 hash 未变化时会跳过；可加 `--force` 全量重跑。
- 如果你更偏好云端 embeddings，可继续使用 `npm run embed:preprocessed`（OpenAI 兼容接口）。

推荐顺序：先完成本步骤，再把 `toby-preprocessed-embedded.json` 用第 3 步导入脚本入云。  
如果你已经导入过无 embedding 版本，直接再次导入 `...-embedded.json`（upsert 覆盖 metadata）即可。

### 5. 导入后验证建议

- 在 Supabase SQL Editor 检查：
  - `tab_deck_spaces` 行数
  - `tab_deck_collections` 行数
  - `tab_deck_links` 行数
- 在扩展里用同账号登录后点击同步，确认导入空间与链接可见。

## `.27` 初始化数据包（3320 links + embedding）

目标：后续环境初始化直接导入“已清理+已向量化”的成品数据，不再重复从 Toby 原始 JSON 开始跑。

安全规则（长期）：

- Public 仓库/Release 只发布代码与脚本。
- 私有初始化数据包只保留在本地或私有存储，不进入 Git 历史。
- 仓库已默认忽略 `supabase/init/`。

### 1. 从当前 Supabase 导出初始化包

```bash
cd /Users/reclina/tab-deck-extension
SUPABASE_URL="https://<project>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service_role_key>" \
npm run export:init:supabase -- \
  --user-id <auth_user_uuid> \
  --output-dir supabase/init/alpha27
```

导出产物：

- `supabase/init/alpha27/tab-deck-alpha27-init-bundle.json`
- `supabase/init/alpha27/tab-deck-alpha27-init-bundle.json.gz`
- `supabase/init/alpha27/manifest.json`

默认只导出 `deleted_at IS NULL` 的有效数据，并自动裁剪到“被导出 links 实际引用到的 spaces/collections”（避免历史残留结构一并带出）。

### 2. 导入初始化包到目标环境

```bash
cd /Users/reclina/tab-deck-extension
SUPABASE_URL="https://<project>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service_role_key>" \
npm run import:init:supabase -- \
  --input supabase/init/alpha27/tab-deck-alpha27-init-bundle.json.gz \
  --user-id <auth_user_uuid> \
  --batch-size 200
```

说明：

- 支持 `.json` 和 `.json.gz` 输入。
- 导入是 `upsert`，可重复执行用于幂等修复。
- 默认会同步更新 `tab_deck_user_settings.active_space_id`（可用 `--no-set-active-space` 关闭）。

## 扩展内“私有初始化数据”入口（本地文件）

`v0.2.0-alpha.27` 开始支持：登录后若账号命中本地私有授权规则，会显示 `Import private init data` 按钮。

- 只支持本地文件导入（`.json` / `.json.gz`）。
- 文件内容通过当前登录 Supabase 账号直接 `upsert` 入云。
- 不依赖 Toby 原始导出文件，不会把初始化数据打包进公开 Release。

## 后续优化计划（Roadmap）

1. 体验增强（接近 Toby）：排序、折叠、批量移动、跨集合拖拽。
2. 搜索增强二期：支持按结果直接批量操作（批量移动、批量打开、批量删除）。
3. 发布准备：隐私说明、安装说明、截图、商店文案，逐步从 alpha 走向 beta 与 Web Store。
