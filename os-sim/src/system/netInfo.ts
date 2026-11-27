/**
 * What the app is actually allowed to know about the network.
 *
 * The settings screen used to print three invented constants -- MAC A4:7B:09:1C:EE:22,
 * local IP 192.168.1.42, download 184.2 Mbps -- in the same monospace font as real
 * readings. That is the worst kind of UI bug: it does not crash, it just tells the user
 * something false with full confidence.
 *
 * A web app (which is what this is, inside a Capacitor shell) cannot read a MAC address
 * at all, and cannot read a local IP. What it CAN read is navigator.onLine and, where the
 * browser implements it, navigator.connection.effectiveType. So that is what we show,
 * and the rest of the row says "cannot be read" in words.
 */
export interface NetInfo {
  /** navigator.onLine, or false when there is no navigator at all (tests, SSR) */
  online: boolean;
  /** 'wifi' | 'cellular' | 'ethernet' | ... when the browser exposes it */
  type: string;
  /** 'slow-2g' | '2g' | '3g' | '4g' */
  effective: string;
  /** true when the fields above came from a real API, false when we had to default */
  measured: boolean;
}

type ConnectionLike = { type?: string; effectiveType?: string };

export function readNetInfo(nav?: { onLine?: boolean; connection?: ConnectionLike }): NetInfo {
  const n = nav ?? (typeof navigator === 'undefined' ? undefined : (navigator as unknown as { onLine?: boolean; connection?: ConnectionLike }));
  if (!n) return { online: false, type: '', effective: '', measured: false };
  const c = n.connection;
  return {
    online: !!n.onLine,
    type: c?.type ?? '',
    effective: c?.effectiveType ?? '',
    // onLine is genuinely reported by every browser; the connection fields are not
    measured: typeof n.onLine === 'boolean',
  };
}

/** One line the UI can show without inventing anything. */
export function describeNet(n: NetInfo): string {
  if (!n.measured) return 'لا يمكن قراءة حالة الشبكة';
  if (!n.online) return 'غير متصل';
  const parts = [n.type || 'متصل'];
  if (n.effective) parts.push(n.effective);
  return parts.join(' · ');
}

/**
 * Addresses this app will never have. Kept as data so a test can prove the settings
 * screen does not print them: a fabricated MAC/IP is not cosmetic, it is a false
 * measurement shown in a measurement font.
 */
export const UNREADABLE_BY_WEB = ['MAC', 'IP محلي'] as const;
