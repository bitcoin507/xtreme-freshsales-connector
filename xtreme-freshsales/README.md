# Xtreme Freshsales Connector

Private ChatGPT MCP connector for Xtreme Disaster Restoration Group's Freshsales CRM.

## v0.2 capabilities

Read tools:

- Search contacts, companies, and deals
- Retrieve complete record context and logged conversations
- List saved views, fields, users, activity types, tasks, appointments, and activities
- Inspect notes, tasks, appointments, deals, and bulk-import status
- Pull CRM activity for daily call lists and KPI reporting

Confirmation-gated write tools:

- Create and update contacts, companies, and deals
- Upsert one contact or bulk-upsert up to 100 contacts or companies
- Create, update, complete, or delete tasks
- Create, update, or delete appointments
- Log, update, or delete sales activities
- Add, edit, or delete notes
- Delete one inspected contact, company, or deal

The connector deliberately does not expose arbitrary API requests or hard-delete/forget operations.
Destructive tools require a confirmed record name, title, or excerpt as well as the numeric ID.

## Email

Freshsales' public CRM REST API exposes logged conversation history but not ordinary personalized
mailbox sending. Send email through the connected Outlook account. With Freshsales Microsoft 365
two-way sync enabled, outgoing Outlook mail can be recorded in the CRM. Keep ChatGPT's Outlook
permission set to ask before sending.

## Security model

- The Freshsales API key is read only from the server environment and is never returned by a tool.
- ChatGPT connects through OAuth 2.1 with PKCE and dynamic client registration.
- A private connector passphrase authorizes the single user during linking.
- Write and destructive tools advertise MCP change annotations so ChatGPT can request confirmation.
- OAuth client registration is persisted in a mode-0600 JSON file.
- Access tokens are short-lived; refresh tokens expire after 30 days.

The built-in OAuth store is designed for a private, single-user connector. Before adding multiple
users, replace it with a managed identity provider and durable token store.

## Configure

Use Node.js 20 or later.

```bash
npm install
cp .env.example .env
```

Enter these values in `.env` or in the encrypted secret settings of your hosting provider:

- `FRESHSALES_BASE_URL`: your bundle URL, such as `https://company.myfreshworks.com/crm/sales`
- `FRESHSALES_API_KEY`: from Freshsales **Profile Settings → API Settings**
- `PUBLIC_BASE_URL`: the connector's public HTTPS origin
- `CONNECTOR_LOGIN_SECRET`: a new, unique passphrase of at least 20 characters
- `OAUTH_CLIENTS_FILE`: durable path for OAuth registrations, such as `/data/oauth-clients.json`

Never commit `.env`, paste the API key into ChatGPT, or reuse your Freshsales password as the
connector passphrase.

## Verify locally

```bash
npm run check
npm test
npm run build
```

For a temporary local MCP tunnel only, set `ALLOW_INSECURE_NOAUTH=true`. Never use that setting on
an internet-accessible URL.

## Deploy on Railway

1. Put this source in a private GitHub repository.
2. In Railway select **New Project → Deploy from GitHub repo** and choose that repository.
3. Railway detects the included `Dockerfile` and `railway.toml`.
4. Add a small persistent volume mounted at `/data`.
5. Add the five private configuration values above in **Variables**.
6. Generate a Railway service domain.
7. Set `PUBLIC_BASE_URL` to that exact `https://...railway.app` address and redeploy.
8. Confirm that `https://YOUR-DOMAIN/health` returns `{"status":"ok"}`.

## Connect in ChatGPT

1. Enable **Settings → Security and login → Developer mode**.
2. Open **Settings → Plugins** and select the plus button.
3. Name the app **Xtreme Freshsales**.
4. Use `https://YOUR-HOST/mcp` as the MCP server URL.
5. Choose OAuth/DCR if ChatGPT asks for the registration method.
6. Enter `CONNECTOR_LOGIN_SECRET` on the authorization page.
7. Set the app permission to **Ask before making changes**.
8. Start a new chat, add **Xtreme Freshsales**, and ask: “Check my Freshsales connection.”

## First live checks

1. Check the connection.
2. List Freshsales users and identify Craig's owner ID.
3. List contact, company, deal, and sales-activity fields.
4. Search for a known contact without changing anything.
5. Create a disposable follow-up task only after confirmation, verify it, then delete it after
   separate confirmation.

Reliable KPI reporting depends on calls, emails, meetings, field visits, outcomes, and lead sources
being recorded consistently in Freshsales.
