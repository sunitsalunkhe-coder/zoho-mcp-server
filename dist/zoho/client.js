import axios from "axios";
import axiosRetry from "axios-retry";
import { loadTokens, saveTokens, isTokenExpired } from "../auth/token-store.js";
import { refreshAccessToken } from "../auth/oauth.js";
import { getUserId } from "../utils/context.js";
import { logger } from "../utils/logger.js";
import { ZohoAuthError, ZohoRateLimitError } from "../utils/errors.js";
export const MAIL_BASE = `https://mail.zoho.${process.env["ZOHO_DC"] ?? "in"}/api`;
const accountIdCache = new Map();
const fromEmailCache = new Map();
const clientInstances = new Map();
export function getZohoClient() {
    const userId = getUserId();
    const existing = clientInstances.get(userId);
    if (existing)
        return existing;
    const client = axios.create({ baseURL: MAIL_BASE, timeout: 30_000 });
    axiosRetry(client, {
        retries: 3,
        retryDelay: axiosRetry.exponentialDelay,
        retryCondition: (err) => err.response?.status === 429 || axiosRetry.isNetworkOrIdempotentRequestError(err),
        onRetry: (count, err) => logger.warn({ count, status: err.response?.status }, "axios_retry"),
    });
    client.interceptors.request.use(async (config) => {
        let tokens = loadTokens(userId);
        if (!tokens)
            throw new ZohoAuthError(`Not authenticated for user ${userId}. Visit /auth/login?uid=${userId}`);
        if (isTokenExpired(tokens)) {
            await refreshAccessToken(userId);
            tokens = loadTokens(userId);
        }
        config.headers["Authorization"] = `Zoho-oauthtoken ${tokens.accessToken}`;
        return config;
    });
    client.interceptors.response.use((res) => res, async (err) => {
        if (err.response?.status === 429)
            throw new ZohoRateLimitError();
        if (err.response?.status === 401 && err.config && !err.config["_retry"]) {
            err.config["_retry"] = true;
            const token = await refreshAccessToken(userId);
            err.config.headers["Authorization"] = `Zoho-oauthtoken ${token}`;
            return client.request(err.config);
        }
        throw err;
    });
    clientInstances.set(userId, client);
    return client;
}
export async function getAccountId() {
    const userId = getUserId();
    const cached = accountIdCache.get(userId);
    if (cached)
        return cached;
    const stored = loadTokens(userId);
    if (stored?.accountId) {
        accountIdCache.set(userId, stored.accountId);
        return stored.accountId;
    }
    const client = getZohoClient();
    const res = await client.get("/accounts");
    const accounts = res.data?.data;
    if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new ZohoAuthError("No Zoho accounts found for this OAuth token.");
    }
    const acc = accounts[0];
    accountIdCache.set(userId, acc.accountId);
    // Cache primary email
    if (Array.isArray(acc.emailAddress)) {
        const primary = acc.emailAddress.find((e) => e.isPrimary);
        fromEmailCache.set(userId, primary?.mailId ?? acc.incomingUserName ?? "");
    }
    else {
        fromEmailCache.set(userId, acc.incomingUserName ?? "");
    }
    const tokens = loadTokens(userId);
    saveTokens(userId, { ...tokens, accountId: acc.accountId });
    return acc.accountId;
}
export async function getFromEmail() {
    const userId = getUserId();
    const cached = fromEmailCache.get(userId);
    if (cached)
        return cached;
    // getAccountId() may return early from token cache without hitting API
    // so fetch accounts directly to get primary email
    const client = getZohoClient();
    const res = await client.get("/accounts");
    const acc = res.data.data?.[0];
    if (acc) {
        const primary = Array.isArray(acc.emailAddress)
            ? acc.emailAddress.find((e) => e.isPrimary)?.mailId
            : undefined;
        const email = primary ?? acc.incomingUserName ?? "";
        fromEmailCache.set(userId, email);
        if (!accountIdCache.has(userId))
            accountIdCache.set(userId, acc.accountId);
    }
    return fromEmailCache.get(userId) ?? "";
}
//# sourceMappingURL=client.js.map