import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { encrypt, decrypt } from "../utils/encryption.js";

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
  lastRefresh?: string;
}

interface TokenCache {
  data: TokenData;
  ts: number;
}

let cache: TokenCache | null = null;
const CACHE_TTL = 5_000;

function storePath(): string {
  return process.env["TOKEN_STORE_PATH"] ?? "./data/tokens.enc";
}

export function saveTokens(data: TokenData): void {
  const p = storePath();
  mkdirSync(dirname(p), { recursive: true });
  const withTs = { ...data, lastRefresh: new Date().toISOString() };
  writeFileSync(p, encrypt(JSON.stringify(withTs)), "utf8");
  cache = { data: withTs, ts: Date.now() };
}

export function loadTokens(): TokenData | null {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;
  const p = storePath();
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(decrypt(readFileSync(p, "utf8"))) as TokenData;
    cache = { data, ts: Date.now() };
    return data;
  } catch {
    return null;
  }
}

export function isTokenExpired(tokens: TokenData): boolean {
  return Date.now() >= tokens.expiresAt - 60_000;
}
