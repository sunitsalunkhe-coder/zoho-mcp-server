import { AsyncLocalStorage } from "async_hooks";

export const userContext = new AsyncLocalStorage<string>();

export function getUserId(): string {
  return userContext.getStore() ?? "default";
}
