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
