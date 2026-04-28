# Sync Safety Fix Plan

## 1. 背景

- 2026-04-24 出现 25 条 `tab_deck_links` 被批量软删，`deleted_at` 统一为 `2026-04-24T08:25:52.134+00:00`。
- 复核中曾观察到 `active_with_embedding_1024` 从 3198 降到 3173，定位后确认是 25 条记录被软删，不是 active 行的 embedding 被覆盖清空。
- 已执行只恢复 `deleted_at` 的受保护回滚后，计数恢复为：
  - `totalActive = 3284`
  - `active_with_embedding_1024 = 3198`
- 潜在系统性风险：当 `fetchCloudDeck` 失败并回退本地数据时，如果本地 deck 明显小于云端，后续 `pushDeckToCloud -> markDeletedRows` 可能把云端差集误判为删除并执行批量软删。

## 2. 已采取的临时措施

- 当前已启用同步总开关保护：`SYNC_LOCKED=true`（`src/cloud.js`）。
- 在该状态下，`pushDeckToCloud` 会直接跳过，不会继续执行 `markDeletedRows`。
- 今晚不解锁，先完成方案落盘，明天在清醒状态下实施正式修复。

## 3. 待执行修复方案

### 修复 1：用 sync context 传递 trustLevel（替代 deck 内标记）

- 目标：不再把“云端可信度”这类控制信号混入业务 deck 对象。
- 实施方向：
  - 为同步链路增加 context 参数，例如：`pushDeckToCloud(deck, { trustLevel })`。
  - `trustLevel` 至少区分：
    - `trusted`：云端读取成功、可安全参与删除决策。
    - `untrusted`：云端不可达/读取失败，仅允许 upsert，不允许 delete。
- 预期收益：
  - 控制信号不依赖 `flattenDeck` 透传。
  - 业务数据与运行时元状态解耦，降低误持久化和污染风险。

### 修复 2：`markDeletedRows` 双重保护（trust + bulk threshold）

- 目标：给 delete 路径增加“可信度闸门 + 数量级闸门”。
- 保护规则：
  - 保护 A（信任闸门）：若 `trustLevel !== "trusted"`，跳过 `markDeletedRows`。
  - 保护 B（规模闸门）：比较云端 active links 数与本地 payload links 数；若差集异常（例如 `diff > 5` 且 `diff/cloud > 1%`），判定为高风险，跳过 delete。
- 触发保护时的行为：
  - 记录 `[sync-safety]` 高危日志。
  - **只跳过 delete，继续 upsert**（局部熔断，不中断整次同步）。
- 预期收益：
  - 防止“云端暂时不可达/本地暂时不完整”引发误删。
  - 同步新增/更新仍能生效，避免全局停摆。

## 4. 验收标准

- `npm run check` 通过。
- 保持可回滚前提下，将 `SYNC_LOCKED` 从 `true` 改回可同步状态后，手动触发 `Sync now`。
- 观察控制台日志：
  - 保护触发时有明确 `[sync-safety]` 日志。
  - 正常路径无异常 delete 警告。
- 复核关键计数：
  - `totalActive` 无异常下降。
  - `active_with_embedding_1024` 无异常下降（目标维持 3198，除非有明确业务变更）。

## 5. 涉及代码文件

- `tab-deck-extension/src/cloud.js`
- `tab-deck-extension/src/storage.js`
- `tab-deck-extension/src/background.js`（可能）

