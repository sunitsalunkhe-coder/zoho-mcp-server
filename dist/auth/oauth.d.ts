import "dotenv/config";
export declare function getAuthUrl(userId: string): string;
export declare function exchangeCode(code: string, userId: string): Promise<void>;
export declare function refreshAccessToken(userId: string): Promise<string>;
//# sourceMappingURL=oauth.d.ts.map