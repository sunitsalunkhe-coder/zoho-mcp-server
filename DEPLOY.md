# Deployment Guide

## Railway

### One-Click
1. Fork this repo
2. Click "Deploy on Railway" (add badge to README after setup)
3. Set environment variables in Railway dashboard

### Manual
```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway variables set ZOHO_CLIENT_ID=xxx ZOHO_CLIENT_SECRET=xxx ...
```

Set `ZOHO_REDIRECT_URI` to your Railway public URL + `/oauth/callback`.

## Render

1. New Web Service → Connect repo
2. Build Command: `npm install && npm run build`
3. Start Command: `node dist/index.js`
4. Environment: Node 20
5. Add all env vars from `.env.example`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ZOHO_CLIENT_ID` | Yes | From Zoho API Console |
| `ZOHO_CLIENT_SECRET` | Yes | From Zoho API Console |
| `ZOHO_REDIRECT_URI` | Yes | Your server URL + `/oauth/callback` |
| `ZOHO_DC` | Yes | `in` for India |
| `ZOHO_SCOPES` | Yes | See .env.example |
| `TOKEN_ENCRYPTION_KEY` | Yes | 32-byte hex (64 chars) |
| `TOKEN_STORE_PATH` | No | Default `./data/tokens.enc` |
| `PORT` | No | Default `3000` |
| `MCP_TRANSPORT` | No | `stdio` or `http` (default `stdio`) |
| `LOG_LEVEL` | No | `debug`/`info`/`warn`/`error` |
| `NODE_ENV` | No | `production` |

## Connecting to Claude.ai

1. Deploy with `MCP_TRANSPORT=http`
2. Verify health: `curl https://your-domain.com/health`
3. Claude.ai → Settings → Integrations → Add MCP Server
4. URL: `https://your-domain.com/sse`
5. Test with: "List my last 5 emails"

## Token Rotation

Tokens auto-refresh on every API call (before expiry). If the refresh token is revoked:

```bash
# Re-authenticate
npm run auth
# Or on server:
ZOHO_REDIRECT_URI=https://your-domain.com/oauth/callback npm run auth
```

Then redeploy or restart the service.

## Backup & Recovery

The token file (`data/tokens.enc`) contains your encrypted credentials.

**Backup:**
```bash
cp data/tokens.enc data/tokens.enc.backup
```

**Recovery:**
- Restore `data/tokens.enc` to `TOKEN_STORE_PATH`
- Ensure `TOKEN_ENCRYPTION_KEY` matches the key used when the backup was created

**Full re-auth:**
```bash
rm data/tokens.enc
npm run auth
```
