# Changelog

All notable changes to Tab Deck will be documented in this file.

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
