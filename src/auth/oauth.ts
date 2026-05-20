import "dotenv/config";
import axios from "axios";
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
  if (!tokens?.refreshToken) throw new ZohoAuthError("No refresh token found. Visit /auth/login to authenticate.");
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

