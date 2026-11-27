/**
 * PLAN ٣-٣: profiles live on the device first, and the save must report whether it landed.
 *
 * This is the same rule `diskStore.saveDisk` was fixed to obey (A-ish defect: a save that
 * resolved unconditionally, so a full disk looked like a success). A settings library is
 * worse served by that lie than a disk image is -- the user edits six values, reads
 * "محفوظ", and the next launch they are gone.
 *
 * There is no account, no network, and no server in this path. ٣-٤ (optional sync) sits
 * on top of it and is off by default; if IndexedDB is unavailable this module says so
 * rather than falling back to memory and calling it persistence.
 */
import { parseProfile, type Profile } from './profileSchema';

const DB_NAME = 'novaos-profiles';
const STORE = 'profiles';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      // every failure path resolves null, so callers can report "not stored" honestly
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | null> {
  return openDB().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const t = db.transaction(STORE, mode);
          const req = fn(t.objectStore(STORE));
          if (!req) {
            resolve(null);
            return;
          }
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          t.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export interface SaveResult {
  stored: boolean;
  /** why it was not stored, in the user's language; empty on success */
  reason: string;
}

/**
 * Save one profile under its game id.
 *
 * The profile is re-parsed before writing, not trusted: a caller could hand us a hand-made
 * object with a key Winlator ignores, and storing that would preserve the defect across
 * restarts while the UI said "saved".
 */
export async function saveProfile(profile: Profile): Promise<SaveResult> {
  const check = parseProfile(profile);
  if (!check.ok) {
    return {
      stored: false,
      reason: `لم يُحفظ: ${check.issues.map((i) => i.message).join(' · ')}`,
    };
  }
  const key = profile.game.id;
  const value = JSON.stringify(profile);
  const res = await tx<unknown>('readwrite', (s) => s.put(value, key) as IDBRequest<unknown>);
  if (res === null) {
    return {
      stored: false,
      reason: 'لم يُحفظ: التخزين المحلي غير متاح (وضع خاص أو ذاكرة ممتلئة)',
    };
  }
  return { stored: true, reason: '' };
}

/** Load one profile by game id; null when absent or unreadable. */
export async function loadProfile(id: string): Promise<Profile | null> {
  const raw = await tx<string>('readonly', (s) => s.get(id) as IDBRequest<string>);
  if (typeof raw !== 'string') return null;
  try {
    const parsed = parseProfile(JSON.parse(raw));
    // a stored file that no longer validates is not "loaded" -- it is corrupt, and
    // reporting it as a profile would carry the defect forward
    return parsed.ok ? parsed.profile : null;
  } catch {
    return null;
  }
}

export interface ListedProfile {
  id: string;
  profile: Profile | null;
  /** readable reason when the stored entry could not be validated */
  broken: string;
}

/** Every stored profile, including ones that no longer validate (never silently dropped). */
export async function listProfiles(): Promise<ListedProfile[]> {
  const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>);
  if (!keys) return [];
  const out: ListedProfile[] = [];
  for (const k of keys) {
    const id = String(k);
    const raw = await tx<string>('readonly', (s) => s.get(k) as IDBRequest<string>);
    if (typeof raw !== 'string') {
      out.push({ id, profile: null, broken: 'البيانات المخزّنة ليست نصاً' });
      continue;
    }
    try {
      const parsed = parseProfile(JSON.parse(raw));
      out.push(
        parsed.ok
          ? { id, profile: parsed.profile, broken: '' }
          : { id, profile: null, broken: parsed.issues.map((i) => i.message).join(' · ') },
      );
    } catch {
      out.push({ id, profile: null, broken: 'الملف المخزّن ليس JSON صالحاً' });
    }
  }
  return out;
}

export async function deleteProfile(id: string): Promise<void> {
  await tx('readwrite', (s) => (s.delete(id) as IDBRequest<undefined>) ?? null);
}

/** Whether this environment can persist profiles at all -- asked, never assumed. */
export async function profileStorageAvailable(): Promise<boolean> {
  return (await openDB()) !== null;
}
