import crypto from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { saveTokens } from "./token-store.js";
import { encrypt, decrypt } from "../utils/encryption.js";
import { logger } from "../utils/logger.js";
// ─── Persistence ──────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const SESSIONS_FILE = join(DATA_DIR, "mcp-sessions.enc");
function saveSessions() {
    try {
        if (!existsSync(DATA_DIR))
            mkdirSync(DATA_DIR, { recursive: true });
        const data = {
            clients: Array.from(clients.entries()),
            accessTokens: Array.from(accessTokens.entries()),
            refreshTokens: Array.from(refreshTokens.entries()),
        };
        writeFileSync(SESSIONS_FILE, encrypt(JSON.stringify(data)), "utf8");
    }
    catch (e) {
        logger.error({ err: e }, "mcp_sessions_save_failed");
    }
}
function loadSessions() {
    try {
        if (!existsSync(SESSIONS_FILE))
            return;
        const raw = decrypt(readFileSync(SESSIONS_FILE, "utf8"));
        const data = JSON.parse(raw);
        const now = Math.floor(Date.now() / 1000);
        let loaded = 0;
        for (const [k, v] of data.clients ?? [])
            clients.set(k, v);
        for (const [k, v] of data.accessTokens ?? []) {
            if (!v.expiresAt || v.expiresAt > now) {
                accessTokens.set(k, v);
                loaded++;
            }
        }
        for (const [k, v] of data.refreshTokens ?? [])
            refreshTokens.set(k, v);
        logger.info({ loaded, clients: clients.size }, "mcp_sessions_loaded");
    }
    catch (e) {
        logger.error({ err: e }, "mcp_sessions_load_failed");
    }
}
// ─── In-memory stores ─────────────────────────────────────────────────────────
const clients = new Map();
// pending: stateId → { codeChallenge, redirectUri, clientId, mcpState }
const pendingAuth = new Map();
// authCodes: ourCode → { userId, clientId, redirectUri, codeChallenge, expiresAt }
const authCodes = new Map();
// accessTokens: token → AuthInfo
const accessTokens = new Map();
// refreshTokens: token → { userId, clientId, scopes }
const refreshTokens = new Map();
// Load persisted sessions on startup
loadSessions();
// ─── Helpers ──────────────────────────────────────────────────────────────────
function authBase() {
    return `https://accounts.zoho.${process.env["ZOHO_DC"] ?? "in"}`;
}
function getServerUrl() {
    return process.env["SERVER_URL"] ?? `http://localhost:${process.env["PORT"] ?? "3000"}`;
}
export function getZohoAuthUrl(stateId) {
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
// ─── Zoho callback ────────────────────────────────────────────────────────────
// Called from /oauth/callback when Zoho redirects back
export async function handleZohoCallback(zohoCode, stateId) {
    const pending = pendingAuth.get(stateId);
    if (!pending)
        throw new Error("Invalid or expired state");
    pendingAuth.delete(stateId);
    // Exchange Zoho code for Zoho tokens
    const tokenRes = await axios.post(`${authBase()}/oauth/v2/token`, null, {
        params: {
            grant_type: "authorization_code",
            client_id: process.env["ZOHO_CLIENT_ID"],
            client_secret: process.env["ZOHO_CLIENT_SECRET"],
            redirect_uri: `${getServerUrl()}/oauth/callback`,
            code: zohoCode,
        },
    });
    const { access_token, refresh_token, expires_in } = tokenRes.data;
    if (!access_token)
        throw new Error(`No access_token from Zoho. Response: ${JSON.stringify(tokenRes.data)}`);
    // Get user email from Zoho
    const accountRes = await axios.get(`https://mail.zoho.${process.env["ZOHO_DC"] ?? "in"}/api/accounts`, { headers: { Authorization: `Zoho-oauthtoken ${access_token}` } });
    const acc = accountRes.data.data?.[0];
    if (!acc)
        throw new Error("No Zoho accounts found");
    const primary = Array.isArray(acc.emailAddress) ? acc.emailAddress.find(e => e.isPrimary)?.mailId : undefined;
    const userId = primary ?? acc.incomingUserName;
    const expiresAt = Date.now() + ((expires_in && expires_in > 0) ? expires_in : 3600) * 1000;
    // Save Zoho tokens for this user
    saveTokens(userId, { accessToken: access_token, refreshToken: refresh_token ?? "", expiresAt, accountId: acc.accountId });
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
export const pendingCallbacks = new Map();
// ─── OAuth Provider ───────────────────────────────────────────────────────────
export function createOAuthProvider() {
    const clientsStore = {
        getClient(clientId) {
            return clients.get(clientId);
        },
        registerClient(client) {
            const clientId = crypto.randomUUID();
            const full = {
                ...client,
                client_id: clientId,
                client_id_issued_at: Math.floor(Date.now() / 1000),
            };
            clients.set(clientId, full);
            saveSessions();
            logger.info({ clientId }, "oauth_client_registered");
            return full;
        },
    };
    return {
        clientsStore,
        async authorize(client, params, res) {
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
        async challengeForAuthorizationCode(_client, code) {
            const entry = authCodes.get(code);
            if (!entry)
                throw new Error("Invalid authorization code");
            if (Date.now() > entry.expiresAt) {
                authCodes.delete(code);
                throw new Error("Authorization code expired");
            }
            return entry.codeChallenge;
        },
        async exchangeAuthorizationCode(_client, code, _codeVerifier, _redirectUri) {
            const entry = authCodes.get(code);
            if (!entry)
                throw new Error("Invalid or expired authorization code");
            authCodes.delete(code);
            const accessToken = crypto.randomUUID();
            const refreshToken = crypto.randomUUID();
            const expiresIn = 30 * 24 * 60 * 60; // 30 days
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
            saveSessions();
            logger.info({ userId: entry.userId }, "oauth_tokens_issued");
            return {
                access_token: accessToken,
                token_type: "bearer",
                expires_in: expiresIn,
                refresh_token: refreshToken,
                scope: "zohomail",
            };
        },
        async exchangeRefreshToken(_client, token, _scopes) {
            const entry = refreshTokens.get(token);
            if (!entry)
                throw new Error("Invalid refresh token");
            const accessToken = crypto.randomUUID();
            const newRefreshToken = crypto.randomUUID();
            const expiresIn = 30 * 24 * 60 * 60; // 30 days
            accessTokens.set(accessToken, {
                token: accessToken,
                clientId: entry.clientId,
                scopes: entry.scopes,
                expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
                extra: { userId: entry.userId },
            });
            accessTokens.delete(token); // remove old access token if same key (not applicable but safe)
            refreshTokens.delete(token);
            refreshTokens.set(newRefreshToken, {
                userId: entry.userId,
                clientId: entry.clientId,
                scopes: entry.scopes,
            });
            saveSessions();
            logger.info({ userId: entry.userId }, "oauth_tokens_refreshed");
            return {
                access_token: accessToken,
                token_type: "bearer",
                expires_in: expiresIn,
                refresh_token: newRefreshToken,
                scope: entry.scopes.join(" "),
            };
        },
        async verifyAccessToken(token) {
            const info = accessTokens.get(token);
            if (!info)
                throw new Error("Invalid access token");
            return info;
        },
        async revokeToken(_client, request) {
            accessTokens.delete(request.token);
            refreshTokens.delete(request.token);
            saveSessions();
        },
    };
}
//# sourceMappingURL=oauth-provider.js.map