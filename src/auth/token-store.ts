import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, extname, basename, join } from "path";
import { encrypt, decrypt } from "../utils/encryption.js";
import { getUserId } from "../utils/context.js";

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

const cacheMap = new Map<string, TokenCache>();
const CACHE_TTL = 5_000;

function storePath(userId: string): string {
  const base = process.env["TOKEN_STORE_PATH"] ?? "./data/tokens.enc";
  if (userId === "default") return base;
  const dir = dirname(base);
  const ext = extname(base);
  const name = basename(base, ext);
  const safe = userId.replace(/[^a-zA-Z0-9]/g, "_");
  return join(dir, `${name}-${safe}${ext}`);
}

export function saveTokens(userId: string, data: TokenData): void {
  const p = storePath(userId);
  mkdirSync(dirname(p), { recursive: true });
  const withTs = { ...data, lastRefresh: new Date().toISOString() };
  writeFileSync(p, encrypt(JSON.stringify(withTs)), "utf8");
  cacheMap.set(userId, { data: withTs, ts: Date.now() });
}

export function loadTokens(userId: string = getUserId()): TokenData | null {
  const cached = cacheMap.get(userId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  const p = storePath(userId);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(decrypt(readFileSync(p, "utf8"))) as TokenData;
    cacheMap.set(userId, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

export function isTokenExpired(tokens: TokenData): boolean {
  return Date.now() >= tokens.expiresAt - 60_000;
}

export function listAuthenticatedUsers(): string[] {
  const users: string[] = [];
  for (const [userId, entry] of cacheMap.entries()) {
    if (Date.now() < entry.data.expiresAt) users.push(userId);
  }
  return users;
}
