import { AsyncLocalStorage } from "async_hooks";
export const userContext = new AsyncLocalStorage();
export function getUserId() {
    return userContext.getStore() ?? "default";
}
//# sourceMappingURL=context.js.map