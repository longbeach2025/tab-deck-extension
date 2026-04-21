# Tab Deck

Tab Deck 是一个从零实现的 Chrome 标签页管理扩展，灵感来自 Toby 的工作流，但不复用 Toby 的品牌、素材或专有实现。

项目目标是：

1. 在 Chrome 新标签页里提供结构化的标签页管理能力（Space / Collection / Link）。
2. 支持多设备同步（先 Chrome Sync，后 Supabase 云同步）。
3. 在同步链路不稳定时优先保证数据不丢（本地 fallback + 可导入导出备份）。

## 当前版本

- 稳定版：`v0.1.0`
- 开发版：`v0.2.0-alpha.8`

下载链接：

- [`v0.1.0` ZIP](https://github.com/longbeach2025/tab-deck-extension/releases/download/v0.1.0/tab-deck-extension-v0.1.0.zip)
- [`v0.2.0-alpha.8` ZIP](https://github.com/longbeach2025/tab-deck-extension/releases/download/v0.2.0-alpha.8/tab-deck-extension-v0.2.0-alpha.8.zip)

## 核心功能（截至 `v0.2.0-alpha.8`）

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
  - JSON 导入恢复。
- 状态可视化：
  - 当前登录账号、最近同步时间、待同步本地变更、错误详情。

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

### 扩展端配置

1. 在 Supabase `Project Settings -> API` 获取：
   - Project URL
   - Publishable key（旧项目界面可能显示为 anon public key）
2. 安装 `v0.2.0-alpha.8`。
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

### `v0.2.0-alpha.8`

- 新增 `Export JSON` / `Import JSON` 备份恢复工具。
- 增强 Cloud Sync 状态面板：
  - Signed in as
  - Last synced
  - Pending local changes
  - Cloud error details
- README 增补 Supabase Auth URL 配置指引。

## 构建与打包

```bash
npm install
./scripts/package_release.sh
```

输出目录：`dist/`

## 后续优化计划（Roadmap）

1. 冲突处理升级：从“整 deck 按时间”升级为“collection/link 粒度合并”。
2. 删除恢复：引入 Trash / Recently deleted（误删可恢复）。
3. 体验增强（接近 Toby）：排序、折叠、批量移动、跨集合拖拽。
4. 搜索增强：按 host/space/collection/日期过滤，结果高亮，结果直接操作。
5. 发布准备：隐私说明、安装说明、截图、商店文案，逐步从 alpha 走向 beta 与 Web Store。
