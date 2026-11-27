/**
 * NovaVM — thin controller around the v86 x86 emulator.
 *
 * The emulator is a real PC: SeaBIOS + VGA BIOS + floppy drive. Whatever boots
 * in it (NovaDesk by default, or a user-supplied FreeDOS/Windows disk image) is
 * genuine x86 machine code running on an emulated CPU, not a web mock-up.
 */
import { V86 } from 'v86';

export type BootSource = 'novadesk' | 'freedos-hd' | 'custom-floppy' | 'custom-hd' | 'custom-iso';

export interface VMOptions {
  /** where the machine screen is rendered */
  container: HTMLElement;
  /** binary to boot (already in memory) */
  image: Uint8Array;
  /** floppy (fda) by default; hda/cdrom for bigger OSes */
  slot?: 'fda' | 'hda' | 'cdrom';
  /** blank data disk for NovaFS, attached as the primary IDE master */
  dataDiskBytes?: number;
  /** initial contents for the data disk (a disk restored from storage) */
  dataDisk?: Uint8Array;
  memoryMB?: number;
  /** do not attach any disk: used when a self-contained snapshot supplies the machine */
  skipDisk?: boolean;
  /** start the CPU immediately (default true) */
  autostart?: boolean;
  onSerial?: (text: string) => void;
  onState?: (state: VMState) => void;
}

export type VMState = 'starting' | 'running' | 'paused' | 'stopped' | 'error';

export interface VMApi {
  setPaused: (paused: boolean) => void;
  restart: () => Promise<void>;
  sendText: (text: string) => void;
  /** type a whole command line and press Enter (v86 has no keycode for CR) */
  sendLine: (text: string) => void;
  /** send raw PS/2 set-1 scancodes (make/break pairs) */
  sendScancodes: (codes: number[]) => void;
  /** true once the guest has drawn something */
  isAlive: () => boolean;
  setScale: (n: number) => void;
  saveState: () => Promise<ArrayBuffer>;
  /** current bytes of the NovaFS data disk (empty when none is attached) */
  getDataDisk: () => Uint8Array | null;
  destroy: () => void;
  getState: () => VMState;
  /** slow the guest down (1 = full speed). Used by the thermal governor. */
  setThrottle: (factor: number) => void;
  /** resume an exported state (v86 save_state) without rebuilding the machine */
  restoreState: (state: ArrayBuffer) => Promise<void>;
  /** low-level handle, exposed for the toolkit (state snapshots, screenshots…) */
  raw: V86;
}

const ROMS = {
  bios: './roms/seabios.bin',
  vgaBios: './roms/vgabios.bin',
  wasm: './v86/v86.wasm',
};

export function createVM(opts: VMOptions): VMApi {
  const memoryMB = opts.memoryMB ?? 32;
  const slot = opts.slot ?? 'fda';
  let state: VMState = 'starting';
  let serialText = '';
  // throttle: when below 1 we let the CPU run only part of the time. Stopping and
  // restarting the emulator is the only portable lever v86 gives us, so we hold
  // each duty cycle long enough (120 ms of 200) that the guest stays smooth.
  let throttleTimer: number | null = null;
  let throttleFactor = 1;

  // The guest's own file system lives on an IDE disk. v86 mirrors writes into
  // this ArrayBuffer, so we can hand the bytes back as a downloadable image.
  const dataBytes = opts.dataDiskBytes ?? 0;
  const restored = opts.dataDisk && opts.dataDisk.byteLength > 0 ? opts.dataDisk : null;
  let dataDisk: Uint8Array | null = null;
  if (restored) {
    // the disk geometry must stay stable between sessions: pad or trim to size
    dataDisk = new Uint8Array(dataBytes > 0 ? dataBytes : restored.byteLength);
    dataDisk.set(restored.subarray(0, dataDisk.byteLength));
  } else if (dataBytes > 0) {
    dataDisk = new Uint8Array(dataBytes);
  }

  const emulator = new V86({
    wasm_path: new URL(ROMS.wasm, window.location.href).href,
    bios: { url: new URL(ROMS.bios, window.location.href).href },
    vga_bios: { url: new URL(ROMS.vgaBios, window.location.href).href },
    memory_size: memoryMB * 1024 * 1024,
    vga_memory_size: 8 * 1024 * 1024,
    screen_container: opts.container,
    // v86 derives a name from the buffer object, so it must be a File, not a Blob
    ...(opts.skipDisk
      ? {}
      : (() => {
          const drives: Record<string, unknown> = {
            [slot]: { buffer: new File([opts.image as BlobPart], `${slot}-image.img`) },
          };
          if (dataDisk) drives.hda = { buffer: new File([dataDisk as BlobPart], 'nova-data.img') };
          return drives;
        })()),
    autostart: opts.autostart ?? true,
  } as never);

  const raw = emulator as unknown as V86 & {
    v86?: { cpu?: { devices?: Record<string, unknown> } };
    bus?: { send?: (type: string, data: unknown) => void };
  };

  const setState = (next: VMState) => {
    state = next;
    opts.onState?.(next);
  };

  const emitter = raw as unknown as {
    add_listener: (event: string, fn: (arg: unknown) => void) => void;
  };
  // Text-mode output is drawn by v86 itself; COM1 is our diagnostic log and is
  // forwarded to the "console" panel instead of a second DOM element.
  try {
    const withSerial = emulator as unknown as { serial_configure?: (cfg: { type: string }) => void };
    withSerial.serial_configure?.({ type: 'none' });
  } catch {
    /* older builds have no serial_configure; logging is optional */
  }

  emitter.add_listener('emulator-ready', () => setState('running'));
  emitter.add_listener('emulator-started', () => setState('running'));
  emitter.add_listener('emulator-paused', () => setState('paused'));
  emitter.add_listener('emulator-stopped', () => setState('stopped'));
  emitter.add_listener('serial0-output-byte', (byte) => {
    serialText += String.fromCharCode(byte as number);
    if (serialText.length > 20000) serialText = serialText.slice(-12000);
    opts.onSerial?.(serialText);
  });

  const isAlive = () => {
    const vga = getVGA(raw);
    if (!vga) return false;
    if (vga.graphical_mode) {
      // a drawn desktop has hundreds of thousands of non-blank pixels
      const memory = vga.svga_enabled ? vga.svga_memory : vga.vga_memory;
      if (!memory) return false;
      let seen = 0;
      for (let i = 0; i < memory.length && i < 640 * 400; i += 5) if (memory[i]) seen++;
      return seen > 700;
    }
    // text mode: the 80x25 window is alive once it holds printable glyphs
    const memory = vga.vga_memory;
    if (!memory) return false;
    let glyphs = 0;
    for (let i = 0; i < 4000; i += 2) {
      const c = memory[i];
      if (c > 32 && c < 127) glyphs++;
    }
    return glyphs > 60;
  };

  return {
    setPaused: (paused) => {
      if (paused) void emulator.stop();
      else void emulator.run();
      setState(paused ? 'paused' : 'running');
    },
    restart: async () => {
      emulator.restart();
      setState('running');
    },
    sendText: (text) => emulator.keyboard_send_text(text),
    sendLine: (text) => {
      if (text) emulator.keyboard_send_text(text);
      emulator.keyboard_send_scancodes([0x1c, 0x9c]); // Enter / Enter-release
    },
    sendScancodes: (codes) => emulator.keyboard_send_scancodes(codes),
    setThrottle: (factor) => {
      // 0 is meaningful: it parks the CPU entirely (app went to the background)
      const f = Math.min(1, Math.max(0, factor));
      if (f === throttleFactor) return;
      throttleFactor = f;
      if (throttleTimer !== null) {
        window.clearInterval(throttleTimer);
        throttleTimer = null;
      }
      if (f >= 1) {
        void emulator.run();
        return;
      }
      if (f === 0) {
        try {
          void emulator.stop();
        } catch {
          /* nothing to stop */
        }
        return;
      }
      const period = 200;
      const active = Math.round(period * f);
      let on = true;
      try {
        void emulator.run();
      } catch {
        /* already running */
      }
      throttleTimer = window.setInterval(() => {
        on = !on;
        try {
          if (on) void emulator.run();
          else void emulator.stop();
        } catch {
          /* the machine may be starting or already gone */
        }
      }, on ? active : period - active);
    },
    restoreState: async (state) => {
      await emulator.restore_state(state);
      setState('running');
    },
    isAlive,
    setScale: (n) => emulator.screen_set_scale(n, n),
    saveState: () => emulator.save_state(),
    getDataDisk: () => {
      if (!dataDisk) return null;
      // v86 hands the disk device the same ArrayBuffer we passed in; copy it so
      // the caller can write a file without racing the emulator
      const ide = raw.v86?.cpu?.devices?.ide as { primary?: { master?: { buffer?: { buffer?: ArrayBuffer } } } } | undefined;
      const live = ide?.primary?.master?.buffer?.buffer;
      const src = live ? new Uint8Array(live) : dataDisk;
      return new Uint8Array(src);
    },
    destroy: () => {
      if (throttleTimer !== null) {
        window.clearInterval(throttleTimer);
        throttleTimer = null;
      }
      try {
        void emulator.destroy();
      } catch {
        /* already gone */
      }
      setState('stopped');
    },
    getState: () => state,
    raw: emulator,
  };
}

interface VGALike {
  svga_enabled: boolean;
  graphical_mode: boolean;
  svga_memory: Uint8Array;
  vga_memory: Uint8Array;
}

function getVGA(raw: unknown): VGALike | null {
  const r = raw as { v86?: { cpu?: { devices?: Record<string, unknown> } } };
  const vga = r.v86?.cpu?.devices?.vga as VGALike | undefined;
  return vga && 'svga_memory' in vga ? vga : null;
}

/** fetch an image from public/ as bytes */
export async function loadImage(path: string, onProgress?: (pct: number) => void): Promise<Uint8Array> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`cannot load ${path}: ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  if (!res.body || !total) {
    onProgress?.(0.9);
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.(1);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(Math.min(0.99, received / total));
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  onProgress?.(1);
  return out;
}
