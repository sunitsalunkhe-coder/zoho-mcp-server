import "dotenv/config";
import axios from "axios";
import { createServer } from "http";
import { URL } from "url";
import { saveTokens, loadTokens } from "./token-store.js";
import { logger } from "../utils/logger.js";
import { ZohoAuthError } from "../utils/errors.js";

function authBase(): string {
  return `https://accounts.zoho.${process.env["ZOHO_DC"] ?? "in"}`;
}

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env["ZOHO_CLIENT_ID"] ?? "",
    scope:
      process.env["ZOHO_SCOPES"] ??
      "ZohoMail.messages.ALL,ZohoMail.accounts.READ,ZohoMail.folders.ALL,ZohoMail.attachments.ALL",
    redirect_uri: process.env["ZOHO_REDIRECT_URI"] ?? "",
    access_type: "offline",
  });
  return `${authBase()}/oauth/v2/auth?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<void> {
  const res = await axios.post<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>(`${authBase()}/oauth/v2/token`, null, {
    params: {
      grant_type: "authorization_code",
      client_id: process.env["ZOHO_CLIENT_ID"],
      client_secret: process.env["ZOHO_CLIENT_SECRET"],
      redirect_uri: process.env["ZOHO_REDIRECT_URI"],
      code,
    },
  });
  const { access_token, refresh_token, expires_in } = res.data;
  if (!refresh_token) throw new ZohoAuthError("No refresh_token returned — ensure access_type=offline");
  const expiresAt = Date.now() + ((expires_in && expires_in > 0) ? expires_in : 3600) * 1000;
  saveTokens({
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt,
  });
  logger.info("Tokens saved successfully");
}

export async function refreshAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens?.refreshToken) throw new ZohoAuthError("No refresh token found. Run: npm run auth");
  const res = await axios.post<{ access_token: string; expires_in: number }>(
    `${authBase()}/oauth/v2/token`,
    null,
    {
      params: {
        grant_type: "refresh_token",
        client_id: process.env["ZOHO_CLIENT_ID"],
        client_secret: process.env["ZOHO_CLIENT_SECRET"],
        refresh_token: tokens.refreshToken,
      },
    },
  );
  const { access_token, expires_in } = res.data;
  const expiresAt = Date.now() + ((expires_in && expires_in > 0) ? expires_in : 3600) * 1000;
  saveTokens({ ...tokens, accessToken: access_token, expiresAt });
  logger.info("Access token refreshed");
  return access_token;
}

// CLI auth flow — run directly via: npm run auth
const isMain =
  process.argv[1] !== undefined &&
  new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");

if (process.argv[1]?.includes("oauth")) {
  const port = parseInt(process.env["PORT"] ?? "3000");
  const url = getAuthUrl();
  console.log(`\nOpen this URL in your browser:\n\n${url}\n`);
  console.log(`Waiting for OAuth callback on http://localhost:${port}/oauth/callback ...\n`);

  const server = createServer((req, res) => {
    if (!req.url?.startsWith("/oauth/callback")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const code = new URL(req.url, `http://localhost:${port}`).searchParams.get("code");
    if (!code) {
      res.writeHead(400);
      res.end("Missing code parameter");
      return;
    }
    exchangeCode(code)
      .then(() => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h2>Authentication successful!</h2><p>You can close this window.</p>");
        console.log("\nAuthentication complete. Tokens saved.\n");
        server.close();
        process.exit(0);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        res.writeHead(500);
        res.end(`Error: ${msg}`);
        console.error("Auth error:", msg);
        server.close();
        process.exit(1);
      });
  });

  server.listen(port);
}

void isMain; // suppress unused warning
