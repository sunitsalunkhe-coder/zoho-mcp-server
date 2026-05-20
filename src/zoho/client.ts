import axios, { type AxiosInstance, type AxiosError } from "axios";
import axiosRetry from "axios-retry";
import { loadTokens, saveTokens, isTokenExpired } from "../auth/token-store.js";
import { refreshAccessToken } from "../auth/oauth.js";
import { logger } from "../utils/logger.js";
import { ZohoAuthError, ZohoRateLimitError } from "../utils/errors.js";
import type { ZohoAccount, ZohoApiResponse } from "./types.js";

export const MAIL_BASE = `https://mail.zoho.${process.env["ZOHO_DC"] ?? "in"}/api`;

let accountIdCache: string | null = null;
let fromEmailCache: string | null = null;
let clientInstance: AxiosInstance | null = null;

export function getZohoClient(): AxiosInstance {
  if (clientInstance) return clientInstance;

  const client = axios.create({ baseURL: MAIL_BASE, timeout: 30_000 });

  axiosRetry(client, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (err: AxiosError) =>
      err.response?.status === 429 || axiosRetry.isNetworkOrIdempotentRequestError(err),
    onRetry: (count, err) => logger.warn({ count, status: err.response?.status }, "axios_retry"),
  });

  client.interceptors.request.use(async (config) => {
    let tokens = loadTokens();
    if (!tokens) throw new ZohoAuthError("Not authenticated. Run: npm run auth");
    if (isTokenExpired(tokens)) {
      await refreshAccessToken();
      tokens = loadTokens()!;
    }
    config.headers["Authorization"] = `Zoho-oauthtoken ${tokens.accessToken}`;
    return config;
  });

  client.interceptors.response.use(
    (res) => res,
    async (err: AxiosError) => {
      if (err.response?.status === 429) throw new ZohoRateLimitError();
      if (err.response?.status === 401 && err.config && !(err.config as unknown as Record<string, unknown>)["_retry"]) {
        (err.config as unknown as Record<string, unknown>)["_retry"] = true;
        const token = await refreshAccessToken();
        err.config.headers["Authorization"] = `Zoho-oauthtoken ${token}`;
        return client.request(err.config);
      }
      throw err;
    },
  );

  clientInstance = client;
  return client;
}

export async function getAccountId(): Promise<string> {
  if (accountIdCache) return accountIdCache;

  const stored = loadTokens();
  if (stored?.accountId) {
    accountIdCache = stored.accountId;
    return accountIdCache;
  }

  const client = getZohoClient();
  const res = await client.get<ZohoApiResponse<ZohoAccount[]>>("/accounts");
  const accounts = res.data?.data;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new ZohoAuthError("No Zoho accounts found for this OAuth token.");
  }
  const acc = accounts[0]!;
  accountIdCache = acc.accountId;
  // Cache primary email
  if (Array.isArray(acc.emailAddress)) {
    const primary = acc.emailAddress.find((e) => e.isPrimary);
    fromEmailCache = primary?.mailId ?? acc.incomingUserName ?? "";
  } else {
    fromEmailCache = acc.incomingUserName ?? "";
  }
  const tokens = loadTokens()!;
  saveTokens({ ...tokens, accountId: accountIdCache });
  return accountIdCache;
}

export async function getFromEmail(): Promise<string> {
  if (fromEmailCache) return fromEmailCache;
  // getAccountId() may return early from token cache without hitting API
  // so fetch accounts directly to get primary email
  const client = getZohoClient();
  const res = await client.get<ZohoApiResponse<Array<{
    accountId: string;
    incomingUserName: string;
    emailAddress: Array<{ mailId: string; isPrimary: boolean }>;
  }>>>("/accounts");
  const acc = res.data.data?.[0];
  if (acc) {
    const primary = Array.isArray(acc.emailAddress)
      ? acc.emailAddress.find((e) => e.isPrimary)?.mailId
      : undefined;
    fromEmailCache = primary ?? acc.incomingUserName ?? "";
    if (!accountIdCache) accountIdCache = acc.accountId;
  }
  return fromEmailCache ?? "";
}
