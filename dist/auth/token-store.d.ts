export interface TokenData {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    accountId?: string;
    lastRefresh?: string;
}
export declare function saveTokens(userId: string, data: TokenData): void;
export declare function loadTokens(userId?: string): TokenData | null;
export declare function isTokenExpired(tokens: TokenData): boolean;
export declare function listAuthenticatedUsers(): string[];
//# sourceMappingURL=token-store.d.ts.map