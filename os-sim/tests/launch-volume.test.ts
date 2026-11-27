import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `useVM` is wrapped in zustand's `persist`, and in Node there is no storage: while the
 * middleware waits for a storage that never arrives, the store's `set` never settles and the
 * test hangs with no output. The first version of this file did exactly that.
 *
 * So the storage is stubbed. A test of the store's SHAPE must not depend on persistence.
 */
vi.mock('zustand/middleware', async () => {
  const actual = await vi.importActual<typeof import('zustand/middleware')>('zustand/middleware');
  return {
    ...actual,
    persist: (init: unknown) => init,
  };
});

const { useVM } = await import('../src/store/useVM');

/**
 * The store contract for a program that needs a FAT16 volume (٥-٢).
 *
 * This exists because the first version put the VOLUME in `bytes` and the BOOT FLOPPY in a
 * helper field, with a comment saying "when bootBytes is present, bytes is the volume". Every
 * test passed. The app would have booted the volume -- a disk that cannot boot -- and the
 * only symptom would be "Boot failed: not a bootable disk" on a phone.
 *
 * The bug was a contract in a comment. So the contract is now a test: `bytes` is what boots,
 * `volumeBytes` is what is attached as a fixed disk, and neither is inferred from the other.
 */
/*
 * Small stand-ins, not 32 MB volumes: this file tests the CONTRACT (which field holds which
 * disk), and the sizes are irrelevant to it. An earlier version allocated a real 32 MB volume
 * per test and the worker died of heap exhaustion -- a test that crashes proves nothing, and
 * a crash is not a pass. The real sizes are exercised in `fat16-boot.test.ts` and `install.test.ts`.
 */
/*
 * Eight bytes each, not a real 1.44 MB floppy and a real 32 MB volume. This file tests WHICH
 * FIELD holds which disk, and the sizes are irrelevant to that. Two earlier versions of this
 * file allocated megabytes: one died of V8 heap exhaustion, the other made zustand's persist
 * middleware try to serialize megabytes on every `set` and hang the worker with no output at
 * all. A test that crashes proves nothing, and stderr silence is not a pass.
 *
 * The real sizes are exercised where they matter: `fat16-boot.test.ts` (a 32 MB volume and a
 * 2 MB program booting) and `install.test.ts` (the stored record's size).
 */
const BOOT = new Uint8Array(8).fill(0x11);
const VOLUME = new Uint8Array(8).fill(0x22);

describe('٥-٢ launching with a volume', () => {
  beforeEach(() => {
    useVM.setState({ userImages: [], activeImageId: 'novadesk', screen: 'desktop', booted: true });
  });

  it('puts the boot floppy in bytes and the volume in volumeBytes', () => {
    useVM.getState().launchProgramWithVolume({ name: 'BIG.EXE', boot: BOOT, volume: VOLUME });
    const img = useVM.getState().userImages.at(-1);
    expect(img).toBeDefined();
    // what boots must be the floppy, and it must be the slot that boots
    expect(img?.bytes).toBe(BOOT);
    expect(img?.slot).toBe('fda');
    expect(img?.volumeBytes).toBe(VOLUME);
    // and the volume must not be reachable through `bytes`: distinct objects, distinct bytes
    expect(img?.volumeBytes).not.toBe(img?.bytes);
    expect(img?.bytes?.[0]).toBe(0x11);
    expect(img?.volumeBytes?.[0]).toBe(0x22);
  });

  it('makes the new entry active and switches to the machine', () => {
    useVM.getState().launchProgramWithVolume({ name: 'BIG.EXE', boot: BOOT, volume: VOLUME });
    const s = useVM.getState();
    expect(s.screen).toBe('machine');
    expect(s.activeImageId).toBe(s.userImages.at(-1)?.id);
    // a stale "booted" flag would show the previous guest's screen behind the new one
    expect(s.booted).toBe(false);
  });

  it('a plain program still launches with bytes only, and no volume', () => {
    // the ordinary floppy path must not acquire a volume field or a second image
    useVM.getState().launchProgram({ name: 'SMALL.COM', disk: BOOT });
    const imgs = useVM.getState().userImages;
    expect(imgs).toHaveLength(1);
    expect(imgs[0].bytes).toBe(BOOT);
    expect(imgs[0].volumeBytes).toBeUndefined();
  });
});
