# Zoho Mail MCP Server

MCP (Model Context Protocol) server connecting Claude.ai to Zoho Mail — India DC (`mail.zoho.in`). Built for Binny's Jewellery Private Limited.

## Architecture

```
Claude.ai ──► MCP Server (stdio | HTTP/SSE)
                    │
                    ├── Auth layer (OAuth 2.0 + encrypted token store)
                    │
                    ├── Zoho client (Axios + auto-refresh + retry)
                    │
                    └── 10 MCP Tools
                         ├── zoho_send_email
                         ├── zoho_create_draft
                         ├── zoho_list_inbox
                         ├── zoho_search_emails
                         ├── zoho_get_email
                         ├── zoho_get_thread
                         ├── zoho_reply_email
                         ├── zoho_mark_read
                         ├── zoho_apply_label
                         └── zoho_followup_check
```

## Setup

### 1. Prerequisites

- Node.js 20+
- A Zoho Mail account (India DC)
- A Zoho API Client (create at https://api-console.zoho.in)

### 2. Clone & Install

```bash
git clone https://github.com/your-org/binnys-zoho-mcp.git
cd zoho-mcp-server
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

Generate encryption key:
```bash
# Linux/Mac:
openssl rand -hex 32
# Windows PowerShell:
[System.BitConverter]::ToString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).Replace("-","").ToLower()
```

### 4. Zoho OAuth Setup

1. Go to https://api-console.zoho.in
2. Create a **Server-based Application**
3. Set Redirect URI to `http://localhost:3000/oauth/callback` (dev) or your production URL
4. Copy Client ID and Secret to `.env`

### 5. Authenticate

```bash
npm run auth
# Opens browser → grant consent → tokens saved automatically
```

### 6. Run

```bash
# Development (stdio)
npm run dev

# Production (HTTP/SSE)
MCP_TRANSPORT=http npm start

# Docker
docker-compose up -d
```

## MCP Tools Reference

### `zoho_send_email`
Send an email.
```json
{
  "to": ["recipient@example.com"],
  "cc": ["cc@example.com"],
  "subject": "Invoice #1234",
  "body_html": "<p>Please find attached...</p>"
}
```

### `zoho_create_draft`
Save to Drafts without sending. Same params as `zoho_send_email`.

### `zoho_list_inbox`
List inbox emails.
```json
{ "limit": 20, "unread_only": true }
```

### `zoho_search_emails`
Search with filters.
```json
{ "from": "supplier@example.com", "subject": "invoice", "limit": 10 }
```

### `zoho_get_email`
Get full email content.
```json
{ "message_id": "12345678" }
```

### `zoho_get_thread`
Get all messages in a thread.
```json
{ "thread_id": "THREAD_001" }
```

### `zoho_reply_email`
Reply to an email.
```json
{ "message_id": "12345678", "body_html": "<p>Thank you!</p>", "reply_all": false }
```

### `zoho_mark_read`
Mark as read/unread.
```json
{ "message_ids": ["1", "2", "3"], "read": true }
```

### `zoho_apply_label`
Apply label (creates if missing).
```json
{ "message_ids": ["1"], "label_name": "Follow-up" }
```

### `zoho_followup_check`
Find sent emails with no reply.
```json
{ "days_since_sent": 3 }
```

## Connecting to Claude.ai

1. Deploy server with `MCP_TRANSPORT=http`
2. In Claude.ai → Settings → MCP Connectors → Add Custom
3. URL: `https://your-domain.com/sse`

## Troubleshooting

**Token expired**: Run `npm run auth` again.

**Rate limit (429)**: The server auto-retries with exponential backoff. If persistent, reduce request frequency.

**Scope errors**: Ensure your Zoho app has all scopes: `ZohoMail.messages.ALL,ZohoMail.accounts.READ,ZohoMail.folders.ALL,ZohoMail.attachments.ALL`

**No accounts found**: Your OAuth token doesn't have access to any Zoho Mail account. Verify the email account exists in the India DC.

## Security

- Tokens stored AES-256-GCM encrypted at rest
- HTML email bodies sanitized via `sanitize-html` before sending
- Attachments > 25MB rejected
- No email body content written to logs
- Non-root Docker user
- All inputs validated with Zod schemas
