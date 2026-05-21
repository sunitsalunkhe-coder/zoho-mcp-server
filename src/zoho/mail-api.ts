import { getZohoClient, getAccountId, getFromEmail } from "./client.js";
import { loadTokens } from "../auth/token-store.js";
import type {
  ZohoApiResponse,
  ZohoFolder,
  ZohoMessageFull,
  ZohoMessageSummary,
  ZohoSendPayload,
  ZohoLabel,
} from "./types.js";
import { ZohoNotFoundError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

// ─── Folders ──────────────────────────────────────────────────────────────────

import { getUserId } from "../utils/context.js";

const folderCache = new Map<string, ZohoFolder[]>();

export async function getFolders(): Promise<ZohoFolder[]> {
  const uid = getUserId();
  if (folderCache.has(uid)) return folderCache.get(uid)!;
  const [zaid, client] = [await getAccountId(), getZohoClient()];
  const res = await client.get<ZohoApiResponse<ZohoFolder[]>>(`/accounts/${zaid}/folders`);
  folderCache.set(uid, res.data.data);
  return res.data.data;
}

export async function getFolderIdByName(name: string): Promise<string | null> {
  const folders = await getFolders();
  return folders.find((f) => f.folderName.toLowerCase() === name.toLowerCase())?.folderId ?? null;
}

// ─── Send / Draft ─────────────────────────────────────────────────────────────

export async function sendEmail(payload: ZohoSendPayload): Promise<string> {
  const [zaid, client] = [await getAccountId(), getZohoClient()];
  const res = await client.post<ZohoApiResponse<{ messageId: string }>>(`/accounts/${zaid}/messages`, payload);
  logger.info({ status: res.data.status.code }, "email_sent");
  return res.data.data.messageId;
}

export async function createDraft(payload: ZohoSendPayload): Promise<string> {
  return sendEmail({ ...payload, isDraft: "true" });
}

// ─── List / Search ────────────────────────────────────────────────────────────

export interface ListMessagesOptions {
  folderId?: string;
  limit?: number;
  start?: number;
  unreadOnly?: boolean;
  fromDate?: string;
}

export async function listMessages(opts: ListMessagesOptions = {}): Promise<ZohoMessageSummary[]> {
  const [zaid, client] = [await getAccountId(), getZohoClient()];
  const params: Record<string, string | number> = {
    limit: opts.limit ?? 20,
    start: opts.start ?? 0,
  };
  if (opts.folderId) params["folderId"] = opts.folderId;
  if (opts.unreadOnly) params["status"] = "unread";
  if (opts.fromDate) params["fromDate"] = opts.fromDate;
  const res = await client.get<ZohoApiResponse<ZohoMessageSummary[]>>(
    `/accounts/${zaid}/messages/view`,
    { params },
  );
  return res.data.data ?? [];
}

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

export async function searchMessages(opts: SearchOptions): Promise<ZohoMessageSummary[]> {
  const [zaid, client] = [await getAccountId(), getZohoClient()];
  const params: Record<string, string | number> = { limit: opts.limit ?? 20 };
  const parts: string[] = [];
  if (opts.query) parts.push(opts.query);
  if (opts.from) parts.push(`from:${opts.from}`);
  if (opts.to) parts.push(`to:${opts.to}`);
  if (opts.subject) parts.push(`subject:${opts.subject}`);
  if (opts.dateRange) parts.push(opts.dateRange);
  if (opts.hasAttachment) parts.push("has:attachment");
  params["searchKey"] = parts.join(" ");
  if (opts.folder) params["folder"] = opts.folder;
  const res = await client.get<ZohoApiResponse<ZohoMessageSummary[]>>(
    `/accounts/${zaid}/messages/search`,
    { params },
  );
  return res.data.data ?? [];
}

// ─── Get / Thread ─────────────────────────────────────────────────────────────

export async function getMessage(messageId: string, folderId?: string): Promise<ZohoMessageFull> {
  const [zaid, client] = [await getAccountId(), getZohoClient()];

  // Step 1: find message summary (has subject, from, to, cc etc.)
  let summary: ZohoMessageSummary | undefined;
  let resolvedFolderId = folderId;

  if (resolvedFolderId) {
    // Search in known folder
    const listRes = await client.get<ZohoApiResponse<ZohoMessageSummary[]>>(
      `/accounts/${zaid}/messages/view`,
      { params: { folderId: resolvedFolderId, limit: 100 } },
    );
    summary = listRes.data.data?.find((m) => m.messageId === messageId);
  }

  if (!summary) {
    // Fallback: search across all folders
    const folders = await getFolders();
    for (const folder of folders) {
      try {
        const listRes = await client.get<ZohoApiResponse<ZohoMessageSummary[]>>(
          `/accounts/${zaid}/messages/view`,
          { params: { folderId: folder.folderId, limit: 100 } },
        );
        summary = listRes.data.data?.find((m) => m.messageId === messageId);
        if (summary) { resolvedFolderId = folder.folderId; break; }
      } catch { /* skip */ }
    }
  }

  if (!summary || !resolvedFolderId) throw new ZohoNotFoundError(`Message ${messageId}`);

  // Step 2: fetch HTML content
  let htmlBody = "";
  try {
    const contentRes = await client.get<ZohoApiResponse<{ content: string }>>(
      `/accounts/${zaid}/folders/${resolvedFolderId}/messages/${messageId}/content`,
    );
    htmlBody = contentRes.data.data?.content ?? "";
  } catch { /* non-fatal */ }

  // Step 3: fetch attachments
  let attachments: import("./types.js").ZohoAttachment[] = [];
  try {
    const attRes = await client.get<ZohoApiResponse<{ attachments: import("./types.js").ZohoAttachment[] }>>(
      `/accounts/${zaid}/folders/${resolvedFolderId}/messages/${messageId}/attachmentinfo`,
    );
    attachments = attRes.data.data?.attachments ?? [];
  } catch { /* non-fatal */ }

  return {
    ...summary,
    htmlBody,
    textBody: "",
    attachments,
  };
}

export async function getThread(threadId: string): Promise<ZohoMessageSummary[]> {
  const [zaid, client] = [await getAccountId(), getZohoClient()];
  const res = await client.get<ZohoApiResponse<{ messages: ZohoMessageSummary[] }>>(
    `/accounts/${zaid}/threads/${threadId}`,
  );
  const messages = res.data.data?.messages ?? [];
  return messages.sort((a, b) => parseInt(a.sentDateInGMT) - parseInt(b.sentDateInGMT));
}

// ─── Reply ────────────────────────────────────────────────────────────────────

export async function replyToMessage(
  messageId: string,
  bodyHtml: string,
  replyAll: boolean,
  folderId?: string,
): Promise<string> {
  const [zaid, client, original, fromAddress] = await Promise.all([
    getAccountId(),
    Promise.resolve(getZohoClient()),
    getMessage(messageId, folderId),
    getFromEmail(),
  ]);

  let ccAddress: string | undefined;
  if (replyAll) {
    const all = [original.toAddress, original.ccAddress].filter(Boolean).join(",");
    ccAddress = all || undefined;
  }

  const payload: ZohoSendPayload = {
    fromAddress,
    toAddress: original.fromAddress,
    ccAddress,
    subject: `Re: ${original.subject.replace(/^Re:\s*/i, "")}`,
    content: bodyHtml,
    mailFormat: "html",
    inReplyTo: messageId,
  };

  const res = await client.post<ZohoApiResponse<{ messageId: string }>>(
    `/accounts/${zaid}/messages`,
    payload,
  );
  return res.data.data.messageId;
}

// ─── Mark Read ────────────────────────────────────────────────────────────────

export async function markRead(messageIds: string[], read: boolean): Promise<void> {
  const [zaid, client] = [await getAccountId(), getZohoClient()];
  await client.put(`/accounts/${zaid}/updatemessage`, {
    messageId: messageIds,
    mode: read ? "markAsRead" : "markAsUnread",
  });
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export async function getOrCreateLabel(labelName: string): Promise<string> {
  // Check folder cache first — avoid extra API call
  const cached = folderCache.get(getUserId())?.find(
    (f: ZohoFolder) => f.folderName.toLowerCase() === labelName.toLowerCase(),
  );
  if (cached) return cached.folderId;

  const [zaid, client] = [await getAccountId(), getZohoClient()];
  const res = await client.get<ZohoApiResponse<ZohoLabel[]>>(`/accounts/${zaid}/folders`);
  folderCache.set(getUserId(), res.data.data as unknown as ZohoFolder[]);
  const existing = res.data.data.find(
    (f) => f.folderName.toLowerCase() === labelName.toLowerCase(),
  );
  if (existing) return existing.folderId;

  const create = await client.post<ZohoApiResponse<ZohoLabel>>(`/accounts/${zaid}/folders`, {
    folderName: labelName,
    parentFolderId: "5",
    type: "label",
  });
  folderCache.delete(getUserId());
  return create.data.data.folderId;
}

export async function applyLabel(messageIds: string[], labelName: string): Promise<void> {
  const [zaid, client, folderId] = await Promise.all([
    getAccountId(),
    Promise.resolve(getZohoClient()),
    getOrCreateLabel(labelName),
  ]);
  await client.put(`/accounts/${zaid}/updatemessage`, {
    messageId: messageIds,
    folderId,
    mode: "addLabel",
  });
}

// ─── Move / Spam ──────────────────────────────────────────────────────────────

// Find which folder a message lives in
async function resolveMessageFolder(messageId: string): Promise<string | null> {
  const folders = await getFolders();
  const [zaid, client] = [await getAccountId(), getZohoClient()];
  for (const folder of folders) {
    try {
      const res = await client.get<ZohoApiResponse<ZohoMessageSummary[]>>(
        `/accounts/${zaid}/messages/view`,
        { params: { folderId: folder.folderId, limit: 100 } },
      );
      if (res.data.data?.some((m) => m.messageId === messageId)) return folder.folderId;
    } catch { /* skip */ }
  }
  return null;
}

export async function moveToTrash(messageIds: string[]): Promise<void> {
  const [zaid, client] = [await getAccountId(), getZohoClient()];
  for (const msgId of messageIds) {
    const folderId = await resolveMessageFolder(msgId);
    if (!folderId) throw new Error(`Message ${msgId} not found in any folder`);
    await client.delete(`/accounts/${zaid}/folders/${folderId}/messages/${msgId}`);
  }
}

export async function moveToFolder(messageIds: string[], targetFolderId: string): Promise<void> {
  const [zaid, client] = [await getAccountId(), getZohoClient()];

  // Attempt 1: batch updatemessage with mode=move
  try {
    await client.put(`/accounts/${zaid}/updatemessage`, {
      messageId: messageIds,
      folderId: targetFolderId,
      mode: "move",
    });
    return;
  } catch { /* try next */ }

  // Attempt 2: batch updatemessage without mode (folderId only)
  try {
    await client.put(`/accounts/${zaid}/updatemessage`, {
      messageId: messageIds,
      folderId: targetFolderId,
    });
    return;
  } catch { /* try next */ }

  // Attempt 3: per-message PUT to folder endpoint
  for (const msgId of messageIds) {
    await client.put(`/accounts/${zaid}/messages/${msgId}`, {
      folderId: targetFolderId,
    });
  }
}

export async function moveToSpam(messageIds: string[]): Promise<void> {
  const [zaid, client] = [await getAccountId(), getZohoClient()];
  await client.put(`/accounts/${zaid}/updatemessage`, {
    messageId: messageIds,
    mode: "moveToSpam",
  });
}

// ─── Follow-up check ─────────────────────────────────────────────────────────

export async function getFollowupRequired(daysSinceSent: number): Promise<ZohoMessageSummary[]> {
  const sentFolderId = await getFolderIdByName("Sent");
  const cutoff = Date.now() - daysSinceSent * 86_400_000;
  const sent = await listMessages({ folderId: sentFolderId ?? undefined, limit: 50 });
  const sentInWindow = sent.filter((m) => parseInt(m.sentDateInGMT) * 1000 >= cutoff);
  const myEmail = loadTokens()?.accountId ?? "";

  // Fetch all threads in parallel
  const threadResults = await Promise.all(
    sentInWindow.map((m) => (m.threadId ? getThread(m.threadId) : Promise.resolve([]))),
  );

  return sentInWindow.filter((msg, i) => {
    const thread = threadResults[i]!;
    return !thread.some(
      (m) =>
        m.messageId !== msg.messageId &&
        parseInt(m.sentDateInGMT) > parseInt(msg.sentDateInGMT) &&
        !m.fromAddress.toLowerCase().includes(myEmail.toLowerCase()),
    );
  });
}
