import express from "express";
import { handleZohoCallback, pendingCallbacks } from "../auth/oauth-provider.js";
import { loadTokens, listAuthenticatedUsers } from "../auth/token-store.js";
import { logger } from "../utils/logger.js";

export function createOAuthApp(): express.Application {
  const app = express();
  app.use(express.json());

  // CORS for claude.ai web
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
    if (_req.method === "OPTIONS") { res.sendStatus(200); return; }
    next();
  });

  // Zoho OAuth callback — Zoho redirects here after user login
  app.get("/oauth/callback", async (req, res) => {
    const code = req.query["code"];
    const error = req.query["error"];
    const state = req.query["state"] as string | undefined;

    if (error) {
      logger.error({ error }, "zoho_oauth_error");
      res.status(400).send(`<h2>OAuth Error</h2><p>${String(error)}</p>`);
      return;
    }
    if (!code || typeof code !== "string" || !state) {
      res.status(400).send("<h2>Missing code or state</h2>");
      return;
    }

    try {
      await handleZohoCallback(code, state);
      const cbKey = state + "_done";
      const cb = pendingCallbacks.get(cbKey);
      pendingCallbacks.delete(cbKey);

      if (!cb) {
        res.send("<h2>Authentication successful!</h2><p>You can close this window.</p>");
        return;
      }

      const redirectUrl = new URL(cb.redirectUri);
      redirectUrl.searchParams.set("code", cb.code);
      if (cb.state) redirectUrl.searchParams.set("state", cb.state);
      res.redirect(redirectUrl.href);
    } catch (e) {
      logger.error({ err: e }, "zoho_callback_failed");
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).send(`<h2>Authentication failed</h2><p>${msg}</p>`);
    }
  });

  app.get("/health", (req, res) => {
    const uid = req.query["uid"];
    if (uid && typeof uid === "string") {
      const tokens = loadTokens(uid);
      res.json({ status: "ok", uid, token_valid: tokens !== null && Date.now() < tokens.expiresAt, last_refresh: tokens?.lastRefresh ?? null });
    } else {
      res.json({ status: "ok", authenticated_users: listAuthenticatedUsers() });
    }
  });

  return app;
}
