# Tab Deck

Tab Deck is a Chrome tab manager inspired by the tab collection workflow of tools like Toby, but implemented from scratch without Toby branding, assets, or proprietary behavior.

## Current MVP

- Overrides the Chrome new tab page with a tab workspace.
- Saves all or selected tabs from the current window.
- Organizes links into spaces and collections.
- Searches saved titles, URLs, hosts, collection names, and notes.
- Restores a collection by opening all saved links.
- Adds links manually.
- Supports drag and drop from the current-tab list into a collection.
- Includes a popup for quick save of the current tab or current window.
- Syncs data across signed-in Chrome browsers with `chrome.storage.sync`.
- Keeps a local fallback copy with `chrome.storage.local`.

## Install For Local Testing

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder: `/Users/reclina/tab-deck-extension`.
5. Open a new tab or pin the extension for quick saves.

## Sync Notes

This version uses Chrome's built-in sync storage, so it works best when every device is signed into the same Chrome profile with extension sync enabled.

Chrome sync storage has a practical size limit, so this is suitable for personal multi-device tab collections, not an unlimited team knowledge base. If the saved deck becomes too large, Tab Deck keeps saving locally and shows a local fallback status.

For larger archives or team sharing, the next step should be a real backend with user accounts, server-side merge logic, and export/import backups.
