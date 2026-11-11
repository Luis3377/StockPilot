// Whether this build includes the AI Inventory Scanner, and where its backend lives.
//
// The scanner is off unless the app is built with VITE_SCAN_API_URL. The production GitHub
// Pages build doesn't set it, so production is unchanged until a deliberate decision.
//   VITE_SCAN_API_URL=https://stockpilot-scanner.<you>.workers.dev   → backend on another site
//   VITE_SCAN_API_URL=same-origin                                    → preview build served by the Worker itself

const raw = (import.meta.env.VITE_SCAN_API_URL ?? '').trim();

/** Base URL for API calls ('' = same origin), or null when the scanner is off. */
export const SCAN_API_BASE: string | null = raw === '' ? null : raw === 'same-origin' || raw === '/' ? '' : raw.replace(/\/+$/, '');

export const scannerEnabled = SCAN_API_BASE !== null;

/** How long the app waits for a scan (the backend gives up on the AI after 25s). */
export const SCAN_TIMEOUT_MS = Number(import.meta.env.VITE_SCAN_TIMEOUT_MS) > 0 ? Number(import.meta.env.VITE_SCAN_TIMEOUT_MS) : 40_000;

export const PROVIDER_PRIVACY_URL = 'https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data';
