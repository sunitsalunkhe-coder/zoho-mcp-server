export declare class ZohoMailError extends Error {
    readonly code: string;
    readonly statusCode?: number | undefined;
    constructor(message: string, code: string, statusCode?: number | undefined);
}
export declare class ZohoAuthError extends ZohoMailError {
    constructor(message: string);
}
export declare class ZohoRateLimitError extends ZohoMailError {
    constructor();
}
export declare class ZohoNotFoundError extends ZohoMailError {
    constructor(resource: string);
}
export declare class ZohoValidationError extends ZohoMailError {
    constructor(message: string);
}
export declare function toUserMessage(err: unknown): string;
//# sourceMappingURL=errors.d.ts.map