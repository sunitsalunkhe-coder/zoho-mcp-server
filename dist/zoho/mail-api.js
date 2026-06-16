import { getZohoClient, getAccountId, getFromEmail } from "./client.js";
import { loadTokens } from "../auth/token-store.js";
import { ZohoNotFoundError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
// ─── Folders ──────────────────────────────────────────────────────────────────
import { getUserId } from "../utils/context.js";
const folderCache = new Map();
export async function getFolders() {
    const uid = getUserId();
    if (folderCache.has(uid))
        return folderCache.get(uid);
    const [zaid, client] = [await getAccountId(), getZohoClient()];
    const res = await client.get(`/accounts/${zaid}/folders`);
    folderCache.set(uid, res.data.data);
    return res.data.data;
}
export async function getFolderIdByName(name) {
    const folders = await getFolders();
    return folders.find((f) => f.folderName.toLowerCase() === name.toLowerCase())?.folderId ?? null;
}
// ─── Send / Draft ─────────────────────────────────────────────────────────────
export async function sendEmail(payload) {
    const [zaid, client] = [await getAccountId(), getZohoClient()];
    // Step 1: upload attachments to Zoho file store, get refs for send payload
    let uploaded;
    if (payload.attachments?.length) {
        const form = new FormData();
        for (const att of payload.attachments) {
            const buf = Buffer.from(att.content_base64, "base64");
            const blob = new Blob([buf], { type: att.mime_type });
            form.append("attach", blob, att.filename);
        }
        const uploadRes = await client.post(`/accounts/${zaid}/messages/attachments`, form, { params: { uploadType: "multipart" } });
        uploaded = uploadRes.data.data;
        logger.info({ count: uploaded.length }, "attachments_uploaded");
    }
    // Step 2: send/save with uploaded attachment refs in JSON body
    const body = {
        fromAddress: payload.fromAddress,
        toAddress: payload.toAddress,
        subject: payload.subject,
        content: payload.content,
        mailFormat: payload.mailFormat,
    };
    if (payload.ccAddress)
        body["ccAddress"] = payload.ccAddress;
    if (payload.bccAddress)
        body["bccAddress"] = payload.bccAddress;
    if (payload.encoding)
        body["encoding"] = payload.encoding;
    if (payload.inReplyTo)
        body["inReplyTo"] = payload.inReplyTo;
    if (payload.mode)
        body["mode"] = payload.mode;
    if (uploaded?.length)
        body["attachments"] = uploaded;
    const res = await client.post(`/accounts/${zaid}/messages`, body);
    logger.info({ status: res.data.status.code }, "email_sent");
    return res.data.data.messageId;
}
export async function createDraft(payload) {
    return sendEmail({ ...payload, mode: "draft" });
}
const ZOHO_PAGE_SIZE = 50; // Zoho API safe page size
export async function listMessages(opts = {}) {
    const [zaid, client] = [await getAccountId(), getZohoClient()];
    const totalWanted = opts.limit ?? 20;
    // Single page — no pagination needed
    if (totalWanted <= ZOHO_PAGE_SIZE) {
        const params = {
            limit: totalWanted,
            start: opts.start ?? 0,
        };
        if (opts.folderId)
            params["folderId"] = opts.folderId;
        if (opts.unreadOnly)
            params["status"] = "unread";
        if (opts.fromDate)
            params["fromDate"] = opts.fromDate;
        const res = await client.get(`/accounts/${zaid}/messages/view`, { params });
        return res.data.data ?? [];
    }
    // Paginate: fetch ZOHO_PAGE_SIZE at a time until we have enough
    const results = [];
    let start = opts.start ?? 0;
    while (results.length < totalWanted) {
        const fetchSize = Math.min(ZOHO_PAGE_SIZE, totalWanted - results.length);
        const params = {
            limit: fetchSize,
            start,
        };
        if (opts.folderId)
            params["folderId"] = opts.folderId;
        if (opts.unreadOnly)
            params["status"] = "unread";
        if (opts.fromDate)
            params["fromDate"] = opts.fromDate;
        const res = await client.get(`/accounts/${zaid}/messages/view`, { params });
        const page = res.data.data ?? [];
        results.push(...page);
        if (page.length < fetchSize)
            break; // no more messages
        start += fetchSize;
    }
    return results;
}
export async function searchMessages(opts) {
    const [zaid, client] = [await getAccountId(), getZohoClient()];
    const params = { limit: opts.limit ?? 20 };
    const parts = [];
    if (opts.query)
        parts.push(opts.query);
    if (opts.from)
        parts.push(`from:${opts.from}`);
    if (opts.to)
        parts.push(`to:${opts.to}`);
    if (opts.subject)
        parts.push(`subject:${opts.subject}`);
    if (opts.dateRange)
        parts.push(opts.dateRange);
    if (opts.hasAttachment)
        parts.push("has:attachment");
    params["searchKey"] = parts.join(" ");
    if (opts.folder)
        params["folder"] = opts.folder;
    const res = await client.get(`/accounts/${zaid}/messages/search`, { params });
    return res.data.data ?? [];
}
// ─── Get / Thread ─────────────────────────────────────────────────────────────
export async function getMessage(messageId, folderId) {
    const [zaid, client] = [await getAccountId(), getZohoClient()];
    // Step 1: find message summary (has subject, from, to, cc etc.)
    let summary;
    let resolvedFolderId = folderId;
    if (resolvedFolderId) {
        // Search in known folder
        const listRes = await client.get(`/accounts/${zaid}/messages/view`, { params: { folderId: resolvedFolderId, limit: 100 } });
        summary = listRes.data.data?.find((m) => m.messageId === messageId);
    }
    if (!summary) {
        // Fallback: search across all folders
        const folders = await getFolders();
        for (const folder of folders) {
            try {
                const listRes = await client.get(`/accounts/${zaid}/messages/view`, { params: { folderId: folder.folderId, limit: 100 } });
                summary = listRes.data.data?.find((m) => m.messageId === messageId);
                if (summary) {
                    resolvedFolderId = folder.folderId;
                    break;
                }
            }
            catch { /* skip */ }
        }
    }
    if (!summary || !resolvedFolderId)
        throw new ZohoNotFoundError(`Message ${messageId}`);
    // Step 2: fetch HTML content
    let htmlBody = "";
    try {
        const contentRes = await client.get(`/accounts/${zaid}/folders/${resolvedFolderId}/messages/${messageId}/content`);
        htmlBody = contentRes.data.data?.content ?? "";
    }
    catch { /* non-fatal */ }
    // Step 3: fetch attachments
    let attachments = [];
    try {
        const attRes = await client.get(`/accounts/${zaid}/folders/${resolvedFolderId}/messages/${messageId}/attachmentinfo`);
        attachments = attRes.data.data?.attachments ?? [];
    }
    catch { /* non-fatal */ }
    return {
        ...summary,
        htmlBody,
        textBody: "",
        attachments,
    };
}
export async function getThread(threadId) {
    const [zaid, client] = [await getAccountId(), getZohoClient()];
    const res = await client.get(`/accounts/${zaid}/threads/${threadId}`);
    const messages = res.data.data?.messages ?? [];
    return messages.sort((a, b) => parseInt(a.sentDateInGMT) - parseInt(b.sentDateInGMT));
}
// ─── Reply ────────────────────────────────────────────────────────────────────
export async function replyToMessage(messageId, bodyHtml, replyAll, folderId, attachments) {
    const [original, fromAddress] = await Promise.all([
        getMessage(messageId, folderId),
        getFromEmail(),
    ]);
    let ccAddress;
    if (replyAll) {
        const all = [original.toAddress, original.ccAddress].filter(Boolean).join(",");
        ccAddress = all || undefined;
    }
    return sendEmail({
        fromAddress,
        toAddress: original.fromAddress,
        ccAddress,
        subject: `Re: ${original.subject.replace(/^Re:\s*/i, "")}`,
        content: bodyHtml,
        mailFormat: "html",
        inReplyTo: messageId,
        attachments,
    });
}
// ─── Mark Read ────────────────────────────────────────────────────────────────
export async function markRead(messageIds, read) {
    const [zaid, client] = [await getAccountId(), getZohoClient()];
    await client.put(`/accounts/${zaid}/updatemessage`, {
        messageId: messageIds,
        mode: read ? "markAsRead" : "markAsUnread",
    });
}
// ─── Labels ───────────────────────────────────────────────────────────────────
export async function getOrCreateLabel(labelName) {
    // Check folder cache first — avoid extra API call
    const cached = folderCache.get(getUserId())?.find((f) => f.folderName.toLowerCase() === labelName.toLowerCase());
    if (cached)
        return cached.folderId;
    const [zaid, client] = [await getAccountId(), getZohoClient()];
    const res = await client.get(`/accounts/${zaid}/folders`);
    folderCache.set(getUserId(), res.data.data);
    const existing = res.data.data.find((f) => f.folderName.toLowerCase() === labelName.toLowerCase());
    if (existing)
        return existing.folderId;
    const create = await client.post(`/accounts/${zaid}/folders`, {
        folderName: labelName,
        parentFolderId: "5",
        type: "label",
    });
    folderCache.delete(getUserId());
    return create.data.data.folderId;
}
export async function applyLabel(messageIds, labelName) {
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
async function resolveMessageFolder(messageId) {
    const folders = await getFolders();
    const [zaid, client] = [await getAccountId(), getZohoClient()];
    for (const folder of folders) {
        try {
            const res = await client.get(`/accounts/${zaid}/messages/view`, { params: { folderId: folder.folderId, limit: 100 } });
            if (res.data.data?.some((m) => m.messageId === messageId))
                return folder.folderId;
        }
        catch { /* skip */ }
    }
    return null;
}
export async function moveToTrash(messageIds) {
    const [zaid, client] = [await getAccountId(), getZohoClient()];
    for (const msgId of messageIds) {
        const folderId = await resolveMessageFolder(msgId);
        if (!folderId)
            throw new Error(`Message ${msgId} not found in any folder`);
        await client.delete(`/accounts/${zaid}/folders/${folderId}/messages/${msgId}`);
    }
}
export async function moveToFolder(messageIds, targetFolderId) {
    const [zaid, client] = [await getAccountId(), getZohoClient()];
    // Attempt 1: batch updatemessage with mode=move
    try {
        await client.put(`/accounts/${zaid}/updatemessage`, {
            messageId: messageIds,
            folderId: targetFolderId,
            mode: "move",
        });
        return;
    }
    catch { /* try next */ }
    // Attempt 2: batch updatemessage without mode (folderId only)
    try {
        await client.put(`/accounts/${zaid}/updatemessage`, {
            messageId: messageIds,
            folderId: targetFolderId,
        });
        return;
    }
    catch { /* try next */ }
    // Attempt 3: per-message PUT to folder endpoint
    for (const msgId of messageIds) {
        await client.put(`/accounts/${zaid}/messages/${msgId}`, {
            folderId: targetFolderId,
        });
    }
}
export async function moveToSpam(messageIds) {
    const [zaid, client] = [await getAccountId(), getZohoClient()];
    await client.put(`/accounts/${zaid}/updatemessage`, {
        messageId: messageIds,
        mode: "moveToSpam",
    });
}
// ─── Follow-up check ─────────────────────────────────────────────────────────
export async function getFollowupRequired(daysSinceSent) {
    const sentFolderId = await getFolderIdByName("Sent");
    const cutoff = Date.now() - daysSinceSent * 86_400_000;
    const sent = await listMessages({ folderId: sentFolderId ?? undefined, limit: 50 });
    const sentInWindow = sent.filter((m) => parseInt(m.sentDateInGMT) * 1000 >= cutoff);
    const myEmail = loadTokens()?.accountId ?? "";
    // Fetch all threads in parallel
    const threadResults = await Promise.all(sentInWindow.map((m) => (m.threadId ? getThread(m.threadId) : Promise.resolve([]))));
    return sentInWindow.filter((msg, i) => {
        const thread = threadResults[i];
        return !thread.some((m) => m.messageId !== msg.messageId &&
            parseInt(m.sentDateInGMT) > parseInt(msg.sentDateInGMT) &&
            !m.fromAddress.toLowerCase().includes(myEmail.toLowerCase()));
    });
}
//# sourceMappingURL=mail-api.js.map