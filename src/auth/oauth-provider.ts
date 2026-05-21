import crypto from "crypto";
import axios from "axios";
import type { Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { saveTokens } from "./token-store.js";
import { logger } from "../utils/logger.js";

// In-memory stores (acceptable for Render free tier testing)
const clients = new Map<string, OAuthClientInformationFull>();

// pending: stateId → { codeChallenge, redirectUri, clientId, mcpState }
const pendingAuth = new Map<string, {
  codeChallenge: string;
  redirectUri: string;
  clientId: string;
  mcpState?: string;
}>();

// authCodes: ourCode → { userId, clientId, redirectUri, codeChallenge, expiresAt }
const authCodes = new Map<string, {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
}>();

// accessTokens: token → AuthInfo
const accessTokens = new Map<string, AuthInfo>();

// refreshTokens: token → { userId, clientId, scopes }
const refreshTokens = new Map<string, { userId: string; clientId: string; scopes: string[] }>();

function authBase(): string {
  return `https://accounts.zoho.${process.env["ZOHO_DC"] ?? "in"}`;
}

function getServerUrl(): string {
  return process.env["SERVER_URL"] ?? `http://localhost:${process.env["PORT"] ?? "3000"}`;
}

export function getZohoAuthUrl(stateId: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env["ZOHO_CLIENT_ID"] ?? "",
    scope: process.env["ZOHO_SCOPES"] ?? "ZohoMail.messages.ALL,ZohoMail.accounts.READ,ZohoMail.folders.ALL,ZohoMail.attachments.ALL",
    redirect_uri: `${getServerUrl()}/oauth/callback`,
    access_type: "offline",
    prompt: "consent",
    state: stateId,
  });
  return `${authBase()}/oauth/v2/auth?${params.toString()}`;
}

// Called from /oauth/callback when Zoho redirects back
export async function handleZohoCallback(zohoCode: string, stateId: string): Promise<void> {
  const pending = pendingAuth.get(stateId);
  if (!pending) throw new Error("Invalid or expired state");
  pendingAuth.delete(stateId);

  // Exchange Zoho code for Zoho tokens
  const tokenRes = await axios.post<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>(`${authBase()}/oauth/v2/token`, null, {
    params: {
      grant_type: "authorization_code",
      client_id: process.env["ZOHO_CLIENT_ID"],
      client_secret: process.env["ZOHO_CLIENT_SECRET"],
      redirect_uri: `${getServerUrl()}/oauth/callback`,
      code: zohoCode,
    },
  });

  const { access_token, refresh_token, expires_in } = tokenRes.data;
  if (!refresh_token) throw new Error("No refresh_token from Zoho — ensure access_type=offline");

  // Get user email from Zoho
  const accountRes = await axios.get<{ data: Array<{ accountId: string; incomingUserName: string; emailAddress: Array<{ mailId: string; isPrimary: boolean }> }> }>(
    `https://mail.zoho.${process.env["ZOHO_DC"] ?? "in"}/api/accounts`,
    { headers: { Authorization: `Zoho-oauthtoken ${access_token}` } }
  );
  const acc = accountRes.data.data?.[0];
  if (!acc) throw new Error("No Zoho accounts found");
  const primary = Array.isArray(acc.emailAddress) ? acc.emailAddress.find(e => e.isPrimary)?.mailId : undefined;
  const userId = primary ?? acc.incomingUserName;
  const expiresAt = Date.now() + ((expires_in && expires_in > 0) ? expires_in : 3600) * 1000;

  // Save Zoho tokens for this user
  saveTokens(userId, { accessToken: access_token, refreshToken: refresh_token, expiresAt, accountId: acc.accountId });
  logger.info({ userId }, "zoho_tokens_saved");

  // Create our auth code
  const ourCode = crypto.randomUUID();
  authCodes.set(ourCode, {
    userId,
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    codeChallenge: pending.codeChallenge,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 min
  });

  // Store the redirect URL and let the caller handle the redirect
  pendingCallbacks.set(stateId + "_done", {
    redirectUri: pending.redirectUri,
    code: ourCode,
    state: pending.mcpState,
  });
}

// Store pending redirects for /oauth/callback handler to use
export const pendingCallbacks = new Map<string, { redirectUri: string; code: string; state?: string }>();

export function createOAuthProvider(): OAuthServerProvider {
  const clientsStore: OAuthRegisteredClientsStore = {
    getClient(clientId: string) {
      return clients.get(clientId);
    },
    registerClient(client) {
      const clientId = crypto.randomUUID();
      const full: OAuthClientInformationFull = {
        ...client,
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
      };
      clients.set(clientId, full);
      logger.info({ clientId }, "oauth_client_registered");
      return full;
    },
  };

  return {
    clientsStore,

    async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
      const stateId = crypto.randomUUID();
      pendingAuth.set(stateId, {
        codeChallenge: params.codeChallenge,
        redirectUri: params.redirectUri,
        clientId: client.client_id,
        mcpState: params.state,
      });
      // Auto-expire after 10 min
      setTimeout(() => pendingAuth.delete(stateId), 10 * 60 * 1000);
      const zohoUrl = getZohoAuthUrl(stateId);
      res.redirect(zohoUrl);
    },

    async challengeForAuthorizationCode(_client: OAuthClientInformationFull, code: string) {
      const entry = authCodes.get(code);
      if (!entry) throw new Error("Invalid authorization code");
      if (Date.now() > entry.expiresAt) {
        authCodes.delete(code);
        throw new Error("Authorization code expired");
      }
      return entry.codeChallenge;
    },

    async exchangeAuthorizationCode(_client: OAuthClientInformationFull, code: string, _codeVerifier?: string, _redirectUri?: string): Promise<OAuthTokens> {
      const entry = authCodes.get(code);
      if (!entry) throw new Error("Invalid or expired authorization code");
      authCodes.delete(code);

      const accessToken = crypto.randomUUID();
      const refreshToken = crypto.randomUUID();
      const expiresIn = 3600;

      accessTokens.set(accessToken, {
        token: accessToken,
        clientId: entry.clientId,
        scopes: ["zohomail"],
        expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
        extra: { userId: entry.userId },
      });

      refreshTokens.set(refreshToken, {
        userId: entry.userId,
        clientId: entry.clientId,
        scopes: ["zohomail"],
      });

      logger.info({ userId: entry.userId }, "oauth_tokens_issued");

      return {
        access_token: accessToken,
        token_type: "bearer",
        expires_in: expiresIn,
        refresh_token: refreshToken,
        scope: "zohomail",
      };
    },

    async exchangeRefreshToken(_client: OAuthClientInformationFull, token: string, _scopes?: string[]): Promise<OAuthTokens> {
      const entry = refreshTokens.get(token);
      if (!entry) throw new Error("Invalid refresh token");

      const accessToken = crypto.randomUUID();
      const newRefreshToken = crypto.randomUUID();
      const expiresIn = 3600;

      accessTokens.set(accessToken, {
        token: accessToken,
        clientId: entry.clientId,
        scopes: entry.scopes,
        expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
        extra: { userId: entry.userId },
      });

      refreshTokens.delete(token);
      refreshTokens.set(newRefreshToken, {
        userId: entry.userId,
        clientId: entry.clientId,
        scopes: entry.scopes,
      });

      return {
        access_token: accessToken,
        token_type: "bearer",
        expires_in: expiresIn,
        refresh_token: newRefreshToken,
        scope: entry.scopes.join(" "),
      };
    },

    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const info = accessTokens.get(token);
      if (!info) throw new Error("Invalid access token");
      return info;
    },

    async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
      accessTokens.delete(request.token);
      refreshTokens.delete(request.token);
    },
  };
}
