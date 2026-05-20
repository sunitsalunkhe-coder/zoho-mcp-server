export interface ZohoApiResponse<T> {
  status: { code: number; description: string };
  data: T;
}

export interface ZohoAccount {
  accountId: string;
  emailAddress: Array<{ mailId: string; isPrimary: boolean }> | string;
  displayName: string;
  incomingUserName: string;
  incomingUser?: string;
}

export interface ZohoFolder {
  folderId: string;
  folderName: string;
  path: string;
  type: string;
  unreadCount: number;
  messageCount: number;
}

export interface ZohoMessageSummary {
  messageId: string;
  subject: string;
  fromAddress: string;
  toAddress: string;
  sentDateInGMT: string;
  folderId: string;
  summary: string;
  isUnread: boolean | string;
  status?: string;
  hasAttachment: boolean;
  threadId?: string;
  ccAddress?: string;
}

export interface ZohoMessageFull extends ZohoMessageSummary {
  htmlBody: string;
  textBody: string;
  bccAddress?: string;
  attachments?: ZohoAttachment[];
  headers?: Record<string, string>;
  inReplyTo?: string;
}

export interface ZohoAttachment {
  attachmentId: string;
  attachmentName: string;
  attachmentSize: number;
  contentType: string;
}

export interface ZohoLabel {
  folderId: string;
  folderName: string;
  type?: string;
}

export interface ZohoSendPayload {
  fromAddress: string;
  toAddress: string;
  ccAddress?: string;
  bccAddress?: string;
  subject: string;
  content: string;
  mailFormat: "html" | "plaintext";
  encoding?: string;
  inReplyTo?: string;
  isDraft?: string;
}
