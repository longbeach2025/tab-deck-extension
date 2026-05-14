# Changelog

All notable changes to Tab Deck will be documented in this file.

## [0.2.0-beta.1] - 2026-05-14

This release marks Tab Deck's transition from alpha to beta. Core features
are complete and stable for general use. Beta phase focuses on gathering
user feedback before the 1.0 stable release.

### Phase Transition

- Promoted from alpha to beta
- manifest version jumps to 0.3.0 to reflect milestone
- package version is 0.2.0-beta.1 (npm prerelease semver)
- All 11 planned UI improvement points completed (see Changed below)

### Added

- Status Center 3-tier information hierarchy:
  - Main message area (14px, prominent)
  - Status summary row with colored dot indicator and relative time
  - Collapsible details section (5 meta lines)
- Status dot states: success (green), warning (orange), error (red), info (grey)
- Relative time display: "Just now", "X min ago", "Yesterday", etc.
- Auto-refresh status summary every 60 seconds
- Sync-in-progress visual indicator:
  - Sync button shows centered spinner during sync
  - Status Center displays "Syncing with cloud..." continuously
  - Final message shows sync duration when over 1 second
- Transient message system:
  - SUCCESS and INFO messages auto-dismiss after 3 seconds
  - ERROR and WARNING messages persist
  - Smooth fade in/out animations
  - Returns to last persistent state after transient dismissal
- Button visual feedback:
  - Active state (translateY 1px sink on click)
  - Success pulse animation (green flash on completion)
  - Enhanced hover (shadows and transitions)
  - Stronger disabled state (grayscale, suppressed hover)

### Changed

- Status messages now support type-based colors (info/success/warning/error)
- Pending changes warning enhanced with orange color and ⚠ icon
- Error details box gains red background and left border (S6)
- All async cloud actions trigger button success flash on completion
- Auto Saved labeled as "DEFAULT" (was "AUTO") to reflect Recent Captures default target

### Fixed

- (None this release - inherited from alpha.28)

### Known Limitations (Beta)

These items are not blocking beta release but are tracked for future work:

- Search latency: vector + LLM search currently takes ~10 seconds (Phase 5
  performance optimization deferred; uses pre-computed embeddings)
- 21000 sync error root cause: not yet located at code level; mitigated
  via defensive deduplication in flattenDeck and safeUpsertLinks
- saveDeckLocalOnly: code path exists but not connected to UI flow (TODO
  marker present in storage.js)
- Production build verification: npm run package flow not yet validated
  in a clean Chrome profile (extension currently loads from source root)
- chenshuo dev environment: secondary development machine setup pending

### Beta Phase Goals

- Gather user feedback on Auto-Saved workflow and Status Center UX
- Identify any edge cases not caught in dev testing
- Stabilize search performance before 1.0
- Resolve 21000 root cause before 1.0

## [0.2.0-alpha.28] - 2026-05-13

### Added
- Recent Captures buffer: background tab capture now writes to local session buffer instead of directly creating collection items
- Save selected / Save all explicit promotion to Auto Saved collection
- Staged sign-in diagnostics with timeout boundaries
- Sync safety: defensive deduplication in flattenDeck and safeUpsertLinks (mitigation for 21000 incident root cause)

### Changed
- Auto Saved is now an explicit user action, not background-silent write
- background runCapture no longer triggers cloud sync side effects
- Recent Captures shows last 1000 captured tabs, organized by URL with firstSeenAt / lastSeenAt tracking

### Fixed
- 21000 incident: ON CONFLICT errors on duplicate link IDs during sync
- Bulk delete threshold protection for cloud-side row protection
- Session buffer cleanup after promotion to collection

### Known Issues
- saveDeckLocalOnly path exists but not wired up (TODO marker present)
- 21000 root cause not located at code level (using defensive mitigation)
- Search latency ~10s (Phase 5 performance optimization deferred)
- chenshuo dev environment not yet set up
