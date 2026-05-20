import express from "express";
import { exchangeCode, getAuthUrl } from "../auth/oauth.js";
import { loadTokens, listAuthenticatedUsers } from "../auth/token-store.js";
import { logger } from "../utils/logger.js";

export function createOAuthApp(): express.Application {
  const app = express();
  app.use(express.json());

  // CORS — required for claude.ai web to reach this server
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
    if (_req.method === "OPTIONS") { res.sendStatus(200); return; }
    next();
  });

  // Visit this URL in browser to trigger Zoho OAuth login for a specific user
  app.get("/auth/login", (req, res) => {
    const uid = req.query["uid"];
    if (!uid || typeof uid !== "string") {
      res.status(400).send("<h2>Missing uid parameter</h2><p>Usage: /auth/login?uid=email@domain.com</p>");
      return;
    }
    const url = getAuthUrl(uid);
    res.redirect(url);
  });

  app.get("/oauth/callback", (req, res) => {
    const code = req.query["code"];
    const error = req.query["error"];
    const state = req.query["state"];

    if (error) {
      logger.error({ error }, "oauth_callback_error");
      res.status(400).send(`<h2>OAuth Error</h2><p>${String(error)}</p>`);
      return;
    }
    if (!code || typeof code !== "string") {
      res.status(400).send("<h2>Missing code parameter</h2>");
      return;
    }
    const userId = typeof state === "string" && state ? state : "default";

    exchangeCode(code, userId)
      .then(() => {
        logger.info({ userId }, "oauth_callback_success");
        res.send(`<h2>Authentication successful!</h2><p>User <strong>${userId}</strong> is now authenticated. You can close this window.</p>`);
      })
      .catch((e: unknown) => {
        logger.error({ err: e, userId }, "oauth_exchange_failed");
        const msg = e instanceof Error ? e.message : String(e);
        res.status(500).send(`<h2>Authentication failed</h2><p>${msg}</p>`);
      });
  });

  app.get("/health", (req, res) => {
    const uid = req.query["uid"];
    if (uid && typeof uid === "string") {
      const tokens = loadTokens(uid);
      res.json({
        status: "ok",
        uid,
        token_valid: tokens !== null && Date.now() < tokens.expiresAt,
        last_refresh: tokens?.lastRefresh ?? null,
      });
    } else {
      const authenticatedUsers = listAuthenticatedUsers();
      res.json({
        status: "ok",
        authenticated_users: authenticatedUsers,
      });
    }
  });

  return app;
}
