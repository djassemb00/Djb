/**
 * Installed PC programs — the launcher's second kind of app.
 *
 * On the phone, an app is an icon you press and it opens. Here a "computer app" is
 * a real .exe/.com the user installed once: we keep the bootable floppy we built
 * around it in IndexedDB, store a small icon, and from then on it behaves like any
 * Android app — an icon on the home screen, in the drawer, and in the dock.
 *
 * Installing may produce several launchers (a disk can hold a menu with many
 * games), so entries are keyed by `id` = program name, and they share one disk.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { deleteDisk, loadDisk, saveDisk } from '../system/diskStore';
import { buildProgramDisk } from '../system/guest';

export interface InstalledProgram {
  /** stable key: the program's 8.3 base name, upper-cased */
  id: string;
  /** what the home screen shows, e.g. "SNAKE" or "TETRIS.EXE" */
  name: string;
  /** which program the disk should start */
  command: string;
  /** original file name as the user gave it */
  fileName: string;
  size: number;
  /** small PNG data URL rendered from the file, or null for a letter tile */
  icon: string | null;
  /** hue used for the letter tile when there is no image */
  hue: number;
  installedAt: number;
  /** how many times it was opened — sorts the drawer like a real launcher */
  launches: number;
  /** false once its disk could not be found in storage */
  healthy: boolean;
}

interface ProgramsStore {
  programs: InstalledProgram[];
  /** id currently being installed, for the UI spinner */
  busy: string | null;
  install: (p: { fileName: string; data: Uint8Array; icon: string | null }) => Promise<InstalledProgram[]>;
  uninstall: (id: string) => Promise<void>;
  /** the bootable floppy for one program, from IndexedDB */
  diskOf: (id: string) => Promise<Uint8Array | null>;
  bumpLaunch: (id: string) => void;
  markBroken: (id: string) => void;
  setBusy: (id: string | null) => void;
}

/**
 * Stable id for a file: the 8.3 base name plus a short hash of the full name.
 *
 * The hash matters. Without it `a.b.c.exe` and `abc.exe` both become `ABC`, and a
 * second install would silently replace the first app on the home screen. With it,
 * distinct files always get distinct icons, while reinstalling the same file still
 * updates in place.
 */
export function programId(fileName: string): string {
  const stem = fileName.replace(/\.[^.]*$/, '');
  const base = (stem.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'PROGRAM').slice(0, 8);
  let h = 0x811c9dc5;
  for (const c of fileName.toUpperCase()) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${base}-${h.toString(36).slice(0, 4)}`;
}

/** disk key per install; one disk can back several launchers from a menu */
const diskKey = (fileName: string) => `program:${programId(fileName)}`;

/** tiny deterministic hue so each app tile looks different */
function hueOf(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export const usePrograms = create<ProgramsStore>()(
  persist(
    (set, get) => ({
      programs: [],
      busy: null,
      setBusy: (busy) => set({ busy }),

      install: async ({ fileName, data, icon }) => {
        const id = programId(fileName);
        set({ busy: id });
        try {
          // build the bootable disk now, so the icon exists only if it really works
          const disk = await buildProgramDisk({ name: fileName, data });
          await saveDisk(diskKey(fileName), disk);
          const entry: InstalledProgram = {
            id,
            name: fileName.replace(/\.[^.]*$/, '').toUpperCase().slice(0, 16),
            command: fileName.toUpperCase().replace(/[^A-Z0-9.]/g, ''),
            fileName,
            size: data.length,
            icon,
            hue: hueOf(id),
            installedAt: Date.now(),
            launches: 0,
            healthy: true,
          };
          set((s) => ({ programs: [entry, ...s.programs.filter((p) => p.id !== id)] }));
          return [entry];
        } finally {
          set({ busy: null });
        }
      },

      uninstall: async (id) => {
        const p = get().programs.find((x) => x.id === id);
        set((s) => ({ programs: s.programs.filter((x) => x.id !== id) }));
        if (p) await deleteDisk(diskKey(p.fileName));
      },

      diskOf: async (id) => {
        const p = get().programs.find((x) => x.id === id);
        if (!p) return null;
        const bytes = await loadDisk(diskKey(p.fileName));
        if (!bytes) {
          // the entry survived but its disk did not (storage cleared): say so instead
          set((s) => ({ programs: s.programs.map((x) => (x.id === id ? { ...x, healthy: false } : x)) }));
          return null;
        }
        return bytes;
      },

      bumpLaunch: (id) =>
        set((s) => ({
          programs: s.programs.map((x) => (x.id === id ? { ...x, launches: x.launches + 1 } : x)),
        })),

      markBroken: (id) =>
        set((s) => ({ programs: s.programs.map((x) => (x.id === id ? { ...x, healthy: false } : x)) })),
    }),
    {
      name: 'novaos-programs-v1',
      // only the metadata is persisted here; the disks live in IndexedDB, which is
      // far better suited to 1.44 MB blobs than localStorage
      partialize: (s) => ({ programs: s.programs }),
    },
  ),
);

/**
 * Render a program's icon for the launcher.
 *
 * Real .exe files often embed an icon in their resource section, but parsing the
 * resource tree for a 32×32 RGBA bitmap is a chunk of work with little payoff at
 * tile size. Instead: a letter tile in the program's own colour, plus the extension
 * badge. It loads instantly, costs no bytes, and looks deliberate.
 */
export function iconFor(entry: InstalledProgram): string | null {
  return entry.icon;
}
