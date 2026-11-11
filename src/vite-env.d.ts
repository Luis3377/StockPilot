/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Scanner backend URL, or "same-origin". Unset = scanner off (production today). */
  readonly VITE_SCAN_API_URL?: string;
  readonly VITE_SCAN_TIMEOUT_MS?: string;
}
