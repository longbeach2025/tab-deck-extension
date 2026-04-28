# Tab Deck Development Workflow

Tab Deck development data is physically isolated from production data.

## Environments

Production:

- Chrome Web Store build.
- Connects only to `tab-deck-prod`.
- Uses `config/cloud-config.prod.json` only during release packaging.

Development:

- Unpacked extension in a dedicated Chrome profile.
- `reclina` uses `tab-deck-dev-reclina`.
- `chenshuo` uses `tab-deck-dev-chenshuo`.
- Local dev config files are ignored by git.

## Local Config

Create one local config on each machine:

```json
{
  "environment": "dev",
  "machine": "reclina",
  "supabaseUrl": "https://your-dev-project.supabase.co",
  "anonKey": "your-dev-anon-key"
}
```

Use these paths:

- `config/cloud-config.dev-reclina.json`
- `config/cloud-config.dev-chenshuo.json`
- `config/cloud-config.prod.json`

`config/cloud-config.example.json` is the committed template.

## Build Guard

Startup enforces these rules:

- Unpacked extension refuses `environment=prod`.
- Unpacked extension requires a bound machine in `chrome.storage.local`.
- Unpacked extension requires the bound machine to match the loaded dev config.
- Packaged extension refuses non-prod config.

The first unpacked launch asks which machine owns the Chrome profile. It writes:

- `selected_machine`
- `selected_at`
- `chrome_profile_path`

The binding cannot be changed from the UI. Create a new Chrome profile to switch machines.

For emergency local development only:

```bash
npm run dev:unbind-machine
```

Type `UNBIND`, then reload the unpacked extension once. This writes `config/machine-unbind.json`, which is ignored by git.

## Daily Workflow

Start of a development session:

```bash
SUPABASE_SERVICE_ROLE_KEY=... USER_ID=... npm run dev:seed
```

End of a development session:

```bash
SUPABASE_SERVICE_ROLE_KEY=... USER_ID=... npm run dev:reset
```

Capture the current dev state as a new shared seed:

```bash
SUPABASE_SERVICE_ROLE_KEY=... USER_ID=... npm run dev:capture-seed
```

This writes `fixtures/dev-seed-data.json`. Review it before committing. The actual seed content is created only after explicit approval.

## Supabase Setup

Manual setup per dev machine:

- Create `tab-deck-dev-reclina` and `tab-deck-dev-chenshuo`.
- Copy the same schema from production.
- Keep production data out of both dev projects.
- Use the matching dev project URL and anon key in each local config file.

The seed/reset/capture scripts infer the machine from hostname. Override when needed:

```bash
TAB_DECK_MACHINE=reclina npm run dev:seed
npm run dev:seed -- --machine chenshuo
```
