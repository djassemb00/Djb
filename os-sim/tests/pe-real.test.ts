import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { inspectPE, describePE } from '../src/system/pe';

/**
 * Real MSVC 2019 binaries, plus hostile variants derived from them in memory.
 *
 * Why this file exists: the synthetic PE in pe.test.ts is written by the same mind that
 * wrote the parser, so it agreed with every bug. On real files the inspector returned
 * FUNCTION names as "DLL names" (it scanned the import descriptors' thunks instead of
 * the directory) and zero imports for a 64-bit PE whose .idata was the sixth section.
 * Geometry and section order in real linkers are not what a fixture author imagines.
 */
const corpus = JSON.parse(
  gunzipSync(readFileSync('tests/fixtures/pe-real.json.gz')).toString('utf8'),
) as Record<string, string>;
const file = (name: string) => new Uint8Array(Buffer.from(corpus[name], 'base64'));
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const peOf = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset).getUint32(0x3c, true);

const X86 = 'complex-msvc2019-x86-O2.exe';
const X86OD = 'simple-msvc2019-x86-Od.exe';
const X64 = 'complex-msvc2019-x64-O2.exe';

describe('real PE files', () => {
  it('ships the three fixtures', () => {
    expect(Object.keys(corpus).sort()).toEqual([X64, X86, X86OD].sort());
  });

  it('identifies the 32-bit pair and the 64-bit one correctly', () => {
    const a = inspectPE(file(X86));
    expect(a.ok).toBe(true);
    expect(a.machineId).toBe(0x014c);
    expect(a.is64).toBe(false);
    expect(a.verdict).toBe('native-32');
    expect(a.subsystem).toBe('console');
    expect(a.sectionCount).toBe(7);
    expect(a.imageSize).toBe(892928);

    const b = inspectPE(file(X86OD));
    expect(b.machineId).toBe(0x014c);
    expect(b.is64).toBe(false);

    const c = inspectPE(file(X64));
    expect(c.machineId).toBe(0x8664);
    expect(c.is64).toBe(true);
    expect(c.verdict).toBe('native-64');
    expect(c.sectionCount).toBe(11);
  });

  it('reads DLL NAMES, not imported function names', () => {
    for (const f of [X86, X86OD, X64]) {
      const info = inspectPE(file(f));
      expect(info.imports.length, `${f} must expose at least one import`).toBeGreaterThan(0);
      for (const dll of info.imports) {
        // the old output looked like "\u0003LEAVECRITICALSECTION" -- a thunk, upper-cased
        expect(dll, `${f}: ${dll}`).toMatch(/^[\x20-\x7e]{3,63}$/);
        expect(dll.endsWith('.DLL') || dll.endsWith('.DRV') || dll.endsWith('.OCX')).toBe(true);
      }
      expect(info.imports).toContain('KERNEL32.DLL');
    }
  });

  it('does not call a plain Windows console program .NET', () => {
    for (const f of [X86, X86OD, X64]) {
      const info = inspectPE(file(f));
      expect(info.isDotNet).toBe(false);
      expect(info.verdict).not.toBe('dotnet');
      expect(describePE(info)).not.toContain('.NET');
    }
  });
});

describe('hostile and damaged input derived from real files', () => {
  const mutate = (fn: (b: Uint8Array) => void) => {
    const copy = file(X86);
    fn(copy);
    return copy;
  };

  it('rejects a PE header that points past the end of the file', () => {
    const bad = mutate((b) => view(b).setUint32(0x3c, 0x7fffffff, true));
    expect(inspectPE(bad).ok).toBe(false);
    expect(inspectPE(bad).verdict).toBe('unknown');
  });

  it('rejects a file whose section table is missing (truncated download)', () => {
    const full = file(X86);
    for (const cut of [600, 1024, 2048]) {
      const info = inspectPE(full.slice(0, cut));
      // must NOT be reported as a working 32-bit program
      expect(info.ok, `truncated to ${cut}B must not pass`).toBe(false);
      expect(info.verdict).toBe('unknown');
      expect(info.verdictText).toContain('ناقص');
    }
  });

  it('survives an absurd section count without reading out of bounds', () => {
    const bad = mutate((b) => view(b).setUint16(peOf(b) + 6, 0xffff, true));
    expect(inspectPE(bad).ok).toBe(false);
  });

  it('survives a lying SizeOfImportDirectory', () => {
    const bad = mutate((b) => {
      const opt = peOf(b) + 24;
      view(b).setUint32(opt + 96 + 8 + 4, 0xffffffff, true); // PE32 import dir size
    });
    const info = inspectPE(bad);
    expect(info.ok).toBe(true);
    // capped at 64 descriptors, and still only real DLL names
    expect(info.imports.length).toBeLessThanOrEqual(64);
    for (const dll of info.imports) expect(dll.endsWith('.DLL')).toBe(true);
  });

  it('survives a lying import RVA', () => {
    const bad = mutate((b) => {
      const opt = peOf(b) + 24;
      view(b).setUint32(opt + 96 + 8, 0xffffffff, true);
    });
    const info = inspectPE(bad);
    expect(info.ok).toBe(true);
    expect(info.imports).toEqual([]);
  });

  it('rejects a descriptor whose name RVA is not a DLL name', () => {
    /**
     * The DLL-name filter is load-bearing, not decoration: a corrupt or hostile
     * descriptor can point its Name RVA at any readable string, and we would then report
     * "hello" or "printf" as a library. Mutation 4 (deleting the filter) passed the whole
     * suite until this test existed, because pointing at .text produced an EMPTY list and
     * an empty list trivially satisfies "no bad entries".
     *
     * To make the difference observable we write a clean ASCII string into the file and
     * point the first descriptor at it. With the filter: rejected. Without it: reported.
     */
    const b = file(X86);
    const dv = view(b);
    const pe = peOf(b);
    const opt = pe + 24;
    const optSize = dv.getUint16(pe + 20, true);
    const sec = opt + optSize;
    const n = dv.getUint16(pe + 6, true);
    const importRva = dv.getUint32(opt + 96 + 8, true);

    let dirOff = -1;
    let rdataRaw = -1;
    let rdataRva = 0;
    for (let i = 0; i < n; i++) {
      const s = sec + i * 40;
      const name = new TextDecoder().decode(b.subarray(s, s + 8)).replace(/\0.*$/, '');
      const va = dv.getUint32(s + 12, true);
      const vs = dv.getUint32(s + 8, true);
      const raw = dv.getUint32(s + 20, true);
      if (importRva >= va && importRva < va + vs) dirOff = raw + (importRva - va);
      if (name === '.rdata') {
        rdataRaw = raw;
        rdataRva = va;
      }
    }
    expect(dirOff).toBeGreaterThan(0);
    expect(rdataRaw).toBeGreaterThan(0);

    // put "hello" at the END of .rdata (which is already in the file) and aim at it
    const at = rdataRaw + 16;
    b.set(new TextEncoder().encode('hello\0'), at);
    dv.setUint32(dirOff + 12, rdataRva + 16, true);

    const info = inspectPE(b);
    expect(info.ok).toBe(true);
    // "hello" is readable ASCII and would survive a charset test; only the .dll rule stops it
    expect(info.imports).not.toContain('HELLO');
  });

  it('never throws on garbage', () => {
    const junk = [
      new Uint8Array(0),
      new Uint8Array(1),
      new Uint8Array(4096),
      (() => {
        const b = new Uint8Array(4096);
        b[0] = 0x4d;
        b[1] = 0x5a;
        for (let i = 2; i < 4096; i++) b[i] = (i * 37) & 0xff;
        return b;
      })(),
    ];
    for (const b of junk) {
      expect(() => inspectPE(b)).not.toThrow();
      expect(inspectPE(b).ok).toBe(false);
    }
  });

  it('parses a 1.2 MB file in well under a frame', () => {
    const big = file(X64);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) inspectPE(big);
    const perCall = (performance.now() - t0) / 20;
    expect(perCall).toBeLessThan(5); // ms; it is a header read, not a file scan
  });
});
