/**
 * Persistent storage for guest disks.
 *
 * The emulated machine's file system lives in an ArrayBuffer that dies with the
 * tab. This module keeps that buffer in IndexedDB so a page reload (or a phone
 * that suspends the app) does not lose the user's files.
 */
const DB_NAME = 'novaos-disks';
const STORE = 'images';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * What we would like to be allowed to store, in bytes (1 GiB).
 *
 * Without a persist() grant Chrome on Android treats the origin as "best effort" and
 * may evict it under storage pressure, which would silently delete installed programs.
 * The browser decides the real number; this is only the figure we plan against.
 */
export const WANTED_QUOTA = 1_073_741_824;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

/** run one request inside a transaction and resolve with its result */
function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | null): Promise<T | null> {
  return openDB().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        let request: IDBRequest<T> | null = null;
        try {
          const t = db.transaction(STORE, mode);
          request = fn(t.objectStore(STORE));
          t.oncomplete = () => resolve(request ? request.result : null);
          t.onerror = () => resolve(null);
          t.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** read a stored disk; null when it was never saved (or storage is blocked) */
export function loadDisk(key: string): Promise<Uint8Array | null> {
  return tx<ArrayBuffer>('readonly', (s) => s.get(key) as IDBRequest<ArrayBuffer>).then((buf) =>
    buf ? new Uint8Array(buf) : null,
  );
}

/**
 * Save a disk and REPORT whether it landed.
 *
 * `tx` resolves null on every failure mode (no IndexedDB, blocked upgrade, quota
 * exceeded, aborted transaction). The old signature discarded that and resolved
 * unconditionally, so callers could not tell a successful write from a full disk.
 * A failed save must not become a green tick in the UI.
 */
export async function saveDisk(key: string, bytes: Uint8Array): Promise<boolean> {
  // store a plain ArrayBuffer copy: some browsers reject views in IDB
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const result = await tx<unknown>('readwrite', (s) => (s.put(copy, key) as IDBRequest<unknown>) ?? null);
  return result !== null;
}

export function deleteDisk(key: string): Promise<void> {
  return tx('readwrite', (s) => (s.delete(key) as IDBRequest<undefined>) ?? null).then(() => undefined);
}

/**
 * Ask the browser not to evict our data, and report what it granted.
 *
 * `persist()` is not a guarantee on every engine, so this returns the storage estimate
 * too. Callers use it to (a) know whether a save will survive a storage squeeze and
 * (b) refuse an import that cannot possibly fit.
 */
export interface StorageStatus {
  /** `navigator.storage` exists at all (false in some private modes) */
  supported: boolean;
  /** the origin is protected from eviction */
  persisted: boolean;
  /** bytes the browser says are available to us, or null when it will not say */
  quota: number | null;
  usage: number | null;
}

/**
 * Is there room for `bytes` on top of what we already use?
 *
 * Returns true when the browser will not say (do not block the user on a missing API),
 * false only when the numbers are known and clearly insufficient.
 */
export async function hasRoomFor(bytes: number): Promise<boolean> {
  const st = await storageStatus();
  if (st.quota === null) return true;
  const free = st.quota - (st.usage ?? 0);
  // 10% headroom: a FAT disk plus its IndexedDB copy both exist during a write
  return free > bytes * 1.1;
}

export async function storageStatus(): Promise<StorageStatus> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const storage = (nav as unknown as { storage?: StorageManager })?.storage;
  if (!storage || typeof storage.estimate !== 'function') {
    return { supported: false, persisted: false, quota: null, usage: null };
  }
  let quota: number | null = null;
  let usage: number | null = null;
  try {
    const est = await storage.estimate();
    quota = typeof est.quota === 'number' ? est.quota : null;
    usage = typeof est.usage === 'number' ? est.usage : null;
  } catch {
    /* estimate is optional */
  }
  let persisted = false;
  try {
    persisted = typeof storage.persisted === 'function' ? await storage.persisted() : false;
    if (!persisted && typeof storage.persist === 'function') persisted = await storage.persist();
  } catch {
    /* persist is optional */
  }
  return { supported: true, persisted, quota, usage };
}

/** true when this browser can actually keep disks between sessions */
export async function storageAvailable(): Promise<boolean> {
  return (await openDB()) !== null;
}
