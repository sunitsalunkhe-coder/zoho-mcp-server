import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
export declare function getZohoAuthUrl(stateId: string): string;
export declare function handleZohoCallback(zohoCode: string, stateId: string): Promise<void>;
export declare const pendingCallbacks: Map<string, {
    redirectUri: string;
    code: string;
    state?: string;
}>;
export declare function createOAuthProvider(): OAuthServerProvider;
//# sourceMappingURL=oauth-provider.d.ts.map