# Tab Deck

Current stable version: `0.1.0`

Current development version: `0.2.0-alpha.3`

[Download v0.1.0 ZIP](https://github.com/longbeach2025/tab-deck-extension/releases/download/v0.1.0/tab-deck-extension-v0.1.0.zip)

[Download v0.2.0-alpha.3 ZIP](https://github.com/longbeach2025/tab-deck-extension/releases/download/v0.2.0-alpha.3/tab-deck-extension-v0.2.0-alpha.3.zip)

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

## Install From Release ZIP

1. Download [`tab-deck-extension-v0.1.0.zip`](https://github.com/longbeach2025/tab-deck-extension/releases/download/v0.1.0/tab-deck-extension-v0.1.0.zip), or a newer alpha release if you want Supabase cloud sync.
2. Unzip it.
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Click Load unpacked.
6. Select the unzipped extension folder, not the zip file itself.

Chrome does not allow true one-click installation from a random GitHub zip. A one-click install flow requires publishing the extension to the Chrome Web Store.

## Supabase Cloud Sync

`v0.2.0-alpha.3` adds Supabase-backed sync while keeping the `v0.1.0` Chrome sync release available.

Setup:

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. Run `supabase/schema.sql`.
4. In Supabase project settings, copy the Project URL and publishable key. In older Supabase projects this may be labeled as the anon public key.
5. Install the `v0.2.0-alpha.3` extension package.
6. Open a new tab and paste the Project URL and publishable / anon key in Cloud Sync.
7. Sign up or sign in with email and password.

If your Supabase project requires email confirmation, signing up creates the account but does not start syncing until the email is confirmed. Confirm the email first, then use Sign in.

The extension stores Spaces, Collections, Links, and Notes in Supabase PostgreSQL with Row Level Security policies that limit each user to their own rows. Chrome local storage is still used as a local cache and offline fallback.

## Build Release ZIP

Run:

```bash
npm install
./scripts/package_release.sh
```

The package will be created under `dist/`.

## Sync Notes

This version uses Chrome's built-in sync storage, so it works best when every device is signed into the same Chrome profile with extension sync enabled.

Chrome sync storage has a practical size limit, so this is suitable for personal multi-device tab collections, not an unlimited team knowledge base. If the saved deck becomes too large, Tab Deck keeps saving locally and shows a local fallback status.

For larger archives or team sharing, the next step should be a real backend with user accounts, server-side merge logic, and export/import backups.
