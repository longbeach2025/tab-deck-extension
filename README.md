# Tab Deck

Tab Deck 是一个从零实现的 Chrome 标签页管理扩展，灵感来自 Toby 的工作流，但不复用 Toby 的品牌、素材或专有实现。

项目目标是：

1. 在 Chrome 新标签页里提供结构化的标签页管理能力（Space / Collection / Link）。
2. 支持多设备同步（先 Chrome Sync，后 Supabase 云同步）。
3. 在同步链路不稳定时优先保证数据不丢（本地 fallback + 可导入导出备份）。

## 当前版本

- 稳定版：`v0.1.0`
- 开发版：`v0.2.0-alpha.18`

下载链接：

- [`v0.1.0` ZIP](https://github.com/longbeach2025/tab-deck-extension/releases/download/v0.1.0/tab-deck-extension-v0.1.0.zip)
- [`v0.2.0-alpha.18` ZIP](https://github.com/longbeach2025/tab-deck-extension/releases/download/v0.2.0-alpha.18/tab-deck-extension-v0.2.0-alpha.18.zip)

## 核心功能（截至 `v0.2.0-alpha.18`）

- 替换 Chrome 新标签页为 Tab Deck 工作区。
- 支持当前窗口标签页的全量/选择性保存。
- Space / Collection / Link 三级组织结构。
- 标题、URL、域名、集合名、备注搜索。
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
- 状态可视化：
  - 当前登录账号、最近同步时间、待同步本地变更、错误详情。
- 时间可追溯：
  - link 记录 `addedAt / lastModifiedAt / lastOpenedAt`。
  - Toby 导入数据标记时间来源（`Imported time`），避免误认为原始创建时间。
  - 搜索支持 `Time source` 过滤与 `Recent activity` 排序。
- AI 中文摘要（可选）：
  - Collection 卡片 `G` 按钮可调用 LLM 生成中文 `Title + Notes` 建议。
  - 先预览再确认应用，不会静默覆盖。
  - 侧栏 `AI Notes` 固定预设：`OpenAI / MiniMax Intl`，其余走 `Custom`。
  - 按所选 Provider 填写 API Base URL / API Key / Model 即可使用。
  - 默认已包含 `https://api.openai.com/*` 和 `https://api.minimax.io/*` host 权限；若使用其他 API 域名，需在 `manifest.json` 增加对应 host 权限后重载扩展。

## 安装方式

### 1) 本地目录加载（开发调试）

1. 打开 `chrome://extensions`
2. 开启 `Developer mode`
3. 点击 `Load unpacked`
4. 选择目录：`/Users/reclina/tab-deck-extension`

### 2) 通过 Release ZIP 安装

1. 下载发布包（建议使用最新 alpha）。
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
2. 安装 `v0.2.0-alpha.18`。
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

## 构建与打包

```bash
npm install
./scripts/package_release.sh
```

输出目录：`dist/`

## 后续优化计划（Roadmap）

1. 体验增强（接近 Toby）：排序、折叠、批量移动、跨集合拖拽。
2. 搜索增强二期：支持按结果直接批量操作（批量移动、批量打开、批量删除）。
3. 发布准备：隐私说明、安装说明、截图、商店文案，逐步从 alpha 走向 beta 与 Web Store。
