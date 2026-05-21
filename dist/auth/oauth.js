import "dotenv/config";
import axios from "axios";
import { saveTokens, loadTokens } from "./token-store.js";
import { logger } from "../utils/logger.js";
import { ZohoAuthError } from "../utils/errors.js";
function authBase() {
    return `https://accounts.zoho.${process.env["ZOHO_DC"] ?? "in"}`;
}
export function getAuthUrl(userId) {
    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env["ZOHO_CLIENT_ID"] ?? "",
        scope: process.env["ZOHO_SCOPES"] ??
            "ZohoMail.messages.ALL,ZohoMail.accounts.READ,ZohoMail.folders.ALL,ZohoMail.attachments.ALL",
        redirect_uri: process.env["ZOHO_REDIRECT_URI"] ?? "",
        access_type: "offline",
        prompt: "consent",
        state: userId,
    });
    return `${authBase()}/oauth/v2/auth?${params.toString()}`;
}
export async function exchangeCode(code, userId) {
    const res = await axios.post(`${authBase()}/oauth/v2/token`, null, {
        params: {
            grant_type: "authorization_code",
            client_id: process.env["ZOHO_CLIENT_ID"],
            client_secret: process.env["ZOHO_CLIENT_SECRET"],
            redirect_uri: process.env["ZOHO_REDIRECT_URI"],
            code,
        },
    });
    const { access_token, refresh_token, expires_in } = res.data;
    if (!refresh_token)
        throw new ZohoAuthError("No refresh_token returned — ensure access_type=offline");
    const expiresAt = Date.now() + ((expires_in && expires_in > 0) ? expires_in : 3600) * 1000;
    saveTokens(userId, {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt,
    });
    logger.info({ userId }, "Tokens saved successfully");
}
export async function refreshAccessToken(userId) {
    const tokens = loadTokens(userId);
    if (!tokens?.refreshToken)
        throw new ZohoAuthError(`No refresh token found for user ${userId}. Visit /auth/login?uid=${userId} to authenticate.`);
    const res = await axios.post(`${authBase()}/oauth/v2/token`, null, {
        params: {
            grant_type: "refresh_token",
            client_id: process.env["ZOHO_CLIENT_ID"],
            client_secret: process.env["ZOHO_CLIENT_SECRET"],
            refresh_token: tokens.refreshToken,
        },
    });
    const { access_token, expires_in } = res.data;
    const expiresAt = Date.now() + ((expires_in && expires_in > 0) ? expires_in : 3600) * 1000;
    saveTokens(userId, { ...tokens, accessToken: access_token, expiresAt });
    logger.info({ userId }, "Access token refreshed");
    return access_token;
}
//# sourceMappingURL=oauth.js.map