import express from "express";
import { exchangeCode } from "../auth/oauth.js";
import { loadTokens } from "../auth/token-store.js";
import { logger } from "../utils/logger.js";

export function createOAuthApp(): express.Application {
  const app = express();
  app.use(express.json());

  app.get("/oauth/callback", (req, res) => {
    const code = req.query["code"];
    const error = req.query["error"];

    if (error) {
      logger.error({ error }, "oauth_callback_error");
      res.status(400).send(`<h2>OAuth Error</h2><p>${String(error)}</p>`);
      return;
    }
    if (!code || typeof code !== "string") {
      res.status(400).send("<h2>Missing code parameter</h2>");
      return;
    }

    exchangeCode(code)
      .then(() => {
        logger.info("oauth_callback_success");
        res.send("<h2>Authentication successful!</h2><p>You can close this window. The server is ready.</p>");
      })
      .catch((e: unknown) => {
        logger.error({ err: e }, "oauth_exchange_failed");
        const msg = e instanceof Error ? e.message : String(e);
        res.status(500).send(`<h2>Authentication failed</h2><p>${msg}</p>`);
      });
  });

  app.get("/health", (_req, res) => {
    const tokens = loadTokens();
    res.json({
      status: "ok",
      token_valid: tokens !== null && Date.now() < tokens.expiresAt,
      last_refresh: tokens?.lastRefresh ?? null,
    });
  });

  return app;
}
