import type { ZohoFolder, ZohoMessageFull, ZohoMessageSummary, ZohoSendPayload } from "./types.js";
export declare function getFolders(): Promise<ZohoFolder[]>;
export declare function getFolderIdByName(name: string): Promise<string | null>;
export declare function sendEmail(payload: ZohoSendPayload): Promise<string>;
export declare function createDraft(payload: ZohoSendPayload): Promise<string>;
export interface ListMessagesOptions {
    folderId?: string;
    limit?: number;
    start?: number;
    unreadOnly?: boolean;
    fromDate?: string;
}
export declare function listMessages(opts?: ListMessagesOptions): Promise<ZohoMessageSummary[]>;
export interface SearchOptions {
    query?: string;
    folder?: string;
    from?: string;
    to?: string;
    subject?: string;
    dateRange?: string;
    hasAttachment?: boolean;
    limit?: number;
}
export declare function searchMessages(opts: SearchOptions): Promise<ZohoMessageSummary[]>;
export declare function getMessage(messageId: string, folderId?: string): Promise<ZohoMessageFull>;
export declare function getThread(threadId: string): Promise<ZohoMessageSummary[]>;
export declare function replyToMessage(messageId: string, bodyHtml: string, replyAll: boolean, folderId?: string): Promise<string>;
export declare function markRead(messageIds: string[], read: boolean): Promise<void>;
export declare function getOrCreateLabel(labelName: string): Promise<string>;
export declare function applyLabel(messageIds: string[], labelName: string): Promise<void>;
export declare function moveToTrash(messageIds: string[]): Promise<void>;
export declare function moveToFolder(messageIds: string[], targetFolderId: string): Promise<void>;
export declare function moveToSpam(messageIds: string[]): Promise<void>;
export declare function getFollowupRequired(daysSinceSent: number): Promise<ZohoMessageSummary[]>;
//# sourceMappingURL=mail-api.d.ts.map