import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Screen = 'desktop' | 'machine';

export interface MachineImage {
  id: string;
  name: string;
  path: string;
  slot: 'fda' | 'hda' | 'cdrom';
  memoryMB: number;
  note: string;
  builtin: boolean;
  size?: number;
  /** in-memory disk (a program the user dropped in this session) */
  bytes?: Uint8Array;
  /**
   * ٥-٢: the FAT16 volume that goes with this image, mounted as the first fixed disk.
   *
   * A FAT16 volume cannot boot (its MBR has no boot code), so a program too big for a floppy
   * needs TWO images: the boot floppy in `bytes`, and its volume here. There is deliberately
   * no `bootBytes`: an earlier version swapped the two between fields, which would have
   * booted the volume and failed in the one place no test could see it. One field, one
   * meaning, and `bytes` is always what boots.
   */
  volumeBytes?: Uint8Array;
}

/** Third-party guests are real OSes written by others: name the licence so the
 *  list stays honest about what we ship. */
/** Images that ship with the app (served from /public/images). */
export const BUILTIN_IMAGES: MachineImage[] = [
  {
    id: 'novadesk',
    name: 'NovaDesk 1.0',
    path: './images/nova-desk.img',
    slot: 'fda',
    memoryMB: 32,
    note: 'نظام سطح مكتب كامل مكتوب من الصفر (نواة 32-bit، نوافذ، ماوس، أصوات) — يعمل على العتاد المُحاكى',
    builtin: true,
    size: 1474560,
  },
  {
    id: 'kolibri',
    name: 'KolibriOS',
    path: './images/kolibri.img',
    slot: 'fda',
    memoryMB: 32,
    note:
      'نظام تشغيل حقيقي كامل في 1.44 ميغابايت: واجهة رسومية ونوافذ وألعاب وأدوات — ' +
      'قِس الفرق بنفسك. اضغط Enter عند ظهور قائمة الإقلاع (أو انتظر ٥ ثوانٍ)',
    builtin: true,
    size: 1474560,
  },
  {
    id: 'dos-games',
    name: 'ألعاب DOS',
    path: './images/dos-games.img',
    slot: 'fda',
    memoryMB: 64,
    // What is ACTUALLY on the disk, verified by reading its root directory:
    // KERNEL.SYS, COMMAND.COM, CONFIG.SYS, SNAKE.COM (1408 B), PONG.COM (2443 B),
    // MENU.COM (784 B), AUTOEXEC.BAT. The old note promised Prince of Persia,
    // Wolfenstein 3D, Doom and Duke Nukem 3D -- none of which are in the image, and
    // none of which we could legally ship.
    note:
      'ألعابنا: SNAKE وPONG، مع سطر أوامر DOS كامل — كلها في ٦٤٠ كيلو من الذاكرة. ' +
      'ألعاب DOS التجارية تعمل أيضاً إن جلبت ملفاتها أنت (نُقلعها من قرصك).',
    builtin: true,
    size: 1474560,
  },
  {
    id: 'freedos',
    name: 'FreeDOS 1.x (boot)',
    path: './images/freedos-boot.img',
    slot: 'fda',
    memoryMB: 32,
    note: 'نظام DOS حر 100% (GPL) يقلع من قرص المرن — جرّب: DIR، VER، VOL',
    builtin: true,
    size: 1474560,
  },
];

interface VMStore {
  screen: Screen;
  booted: boolean;
  scale: number;
  paused: boolean;
  showSerial: boolean;
  serial: string;
  activeImageId: string;
  userImages: MachineImage[];
  setScreen: (s: Screen) => void;
  setBooted: (b: boolean) => void;
  setScale: (n: number) => void;
  setPaused: (p: boolean) => void;
  setShowSerial: (v: boolean) => void;
  pushSerial: (s: string) => void;
  setActiveImage: (id: string) => void;
  /** load a dropped program as the boot disk and switch to the machine */
  launchProgram: (p: { name: string; disk: Uint8Array }) => void;
  /**
   * ٥-٢: launch a program that does not fit on a floppy. The boot floppy and the FAT16
   * volume travel together -- the floppy boots, the volume is the first fixed disk -- so
   * they enter the list as one entry, not two.
   */
  launchProgramWithVolume: (p: { name: string; boot: Uint8Array; volume: Uint8Array }) => void;
  addUserImage: (img: MachineImage) => void;
  removeUserImage: (id: string) => void;
}

export const useVM = create<VMStore>()(
  persist(
    (set) => ({
      screen: 'desktop',
      booted: false,
      scale: 2,
      paused: false,
      showSerial: false,
      serial: '',
      activeImageId: 'novadesk',
      userImages: [],
      setScreen: (screen) => set({ screen }),
      setBooted: (booted) => set({ booted }),
      setScale: (scale) => set({ scale }),
      setPaused: (paused) => set({ paused }),
      setShowSerial: (showSerial) => set({ showSerial }),
      pushSerial: (serial) => set({ serial }),
      setActiveImage: (activeImageId) => set({ activeImageId }),
      launchProgram: ({ name, disk }) => {
        const id = `prog-${Date.now().toString(36)}`;
        set((s) => ({
          userImages: [
            ...s.userImages.filter((i) => i.id !== id),
            { id, name, path: `mem:${id}`, slot: 'fda', memoryMB: 64, note: 'برنامجك أنت', builtin: false, bytes: disk },
          ],
          activeImageId: id,
          booted: false,
          screen: 'machine',
        }));
      },
      launchProgramWithVolume: ({ name, boot, volume }) => {
        const id = `prog-${Date.now().toString(36)}`;
        /*
         * `bytes` is the boot floppy, because that is what `bytes` means everywhere else in
         * this store and in MachineView. The volume gets its own field. Nothing is swapped.
         */
        set((s) => ({
          userImages: [
            ...s.userImages.filter((i) => i.id !== id),
            {
              id,
              name,
              path: `mem:${id}`,
              slot: 'fda',
              memoryMB: 64,
              note: 'برنامجك أنت — قرص صلب FAT16',
              builtin: false,
              bytes: boot,
              volumeBytes: volume,
            },
          ],
          activeImageId: id,
          booted: false,
          screen: 'machine',
        }));
      },
      addUserImage: (img) => set((s) => ({ userImages: [...s.userImages.filter((i) => i.id !== img.id), img] })),
      removeUserImage: (id) => set((s) => ({ userImages: s.userImages.filter((i) => i.id !== id) })),
    }),
    {
      name: 'novaos-vm-v1',
      // never persist the screen/runtime flags: a reload must start on the desk
      // user uploads live on blob: URLs that die with the tab, so only the
      // scale and the built-in disk choice survive a reload
      partialize: (s) => ({ scale: s.scale, activeImageId: s.activeImageId }),
    },
  ),
);
