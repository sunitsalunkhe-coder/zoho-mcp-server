/**
 * Production (EC2): set USE_SSM=true — fetches the entire .env content
 * stored as a single SecureString at SSM_PATH + "env", parses it into
 * process.env. No secrets ever sit in a file on the server.
 *
 * SSM param: /nfc/backend/env  → entire .env file content (SecureString)
 */
export declare function loadConfig(): Promise<void>;
//# sourceMappingURL=config.d.ts.map