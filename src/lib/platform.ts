// Small platform checks used only to tailor guidance text (never to change how data is stored).

/** iPhone, iPad or iPod (iPadOS reports itself as a Mac, so touch support is checked too). */
export function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Opened as an installed Home Screen app rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** Which storage-guidance case applies on this device. */
export type InstallContext = 'ios-browser' | 'ios-home-screen' | 'other';

export function installContext(): InstallContext {
  if (!isAppleMobile()) return 'other';
  return isStandalone() ? 'ios-home-screen' : 'ios-browser';
}
