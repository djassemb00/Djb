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

export function saveDisk(key: string, bytes: Uint8Array): Promise<void> {
  // store a plain ArrayBuffer copy: some browsers reject views in IDB
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return tx('readwrite', (s) => (s.put(copy, key) as IDBRequest<unknown>) ?? null).then(() => undefined);
}

export function deleteDisk(key: string): Promise<void> {
  return tx('readwrite', (s) => (s.delete(key) as IDBRequest<undefined>) ?? null).then(() => undefined);
}

/** true when this browser can actually keep disks between sessions */
export async function storageAvailable(): Promise<boolean> {
  return (await openDB()) !== null;
}
