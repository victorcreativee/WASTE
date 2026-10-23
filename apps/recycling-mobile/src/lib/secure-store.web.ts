// Browser stand-in used only when the app is opened with `expo start --web` to review screens. Browsers have no secure
// enclave, so values live in localStorage; the installed Android and iOS apps use secure-store.ts instead.
const store = () => (typeof window === "undefined" ? null : window.localStorage);

export async function getItemAsync(key: string) {
  return store()?.getItem(key) ?? null;
}
export async function setItemAsync(key: string, value: string) {
  store()?.setItem(key, value);
}
export async function deleteItemAsync(key: string) {
  store()?.removeItem(key);
}
