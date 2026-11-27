import { describe, expect, it } from 'vitest';
import { inspectPE, describePE } from '../src/system/pe';

/** build a structurally valid PE in memory: DOS stub, COFF header, optional header, sections */
function makePE(opts: { machine?: number; imports?: string[]; dll?: boolean; subsystem?: number }) {
  const { machine = 0x14c, imports = ['KERNEL32.dll'], dll = false, subsystem = 2 } = opts;
  const buf = new Uint8Array(0x600);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x4d;
  buf[1] = 0x5a;
  dv.setUint32(0x3c, 0x40, true);
  dv.setUint32(0x40, 0x00004550, true); // "PE\0\0"
  dv.setUint16(0x44, machine, true);
  dv.setUint16(0x46, 2, true); // sections
  dv.setUint16(0x54, 224, true); // optional header size
  dv.setUint16(0x56, dll ? 0x2102 : 0x0102, true);
  const opt = 0x58;
  dv.setUint16(opt, 0x10b, true); // PE32
  dv.setUint16(opt + 68, subsystem, true);
  const sec = opt + 224;
  // the inspector finds imports by section *name*, so the fixture must name it
  buf.set(new TextEncoder().encode('.idata\0\0'), sec);
  // .idata at raw 0x200, RVA 0x1000: descriptors first, then names
  dv.setUint32(sec + 8, 0x400, true); // vsize
  dv.setUint32(sec + 12, 0x1000, true); // va
  dv.setUint32(sec + 16, 0x400, true); // raw size
  dv.setUint32(sec + 20, 0x200, true); // raw ptr
  const enc = new TextEncoder();
  let nameOff = 0x280;
  imports.forEach((n, i) => {
    // name RVA = section RVA + offset of the name inside the section
    dv.setUint32(0x200 + i * 20 + 12, 0x1000 + (nameOff - 0x200), true);
    buf.set(enc.encode(n), nameOff);
    nameOff += n.length + 1;
  });
  return buf;
}

describe('PE inspection', () => {
  it('classifies a 32-bit GUI program', () => {
    const info = inspectPE(makePE({ imports: ['KERNEL32.dll', 'USER32.dll', 'GDI32.dll'] }));
    expect(info.ok).toBe(true);
    expect(info.verdict).toBe('native-32');
    expect(info.subsystem).toBe('gui');
    expect(info.imports).toContain('USER32.DLL');
  });

  it('detects .NET through mscoree', () => {
    expect(inspectPE(makePE({ imports: ['MSCOREE.dll'] })).verdict).toBe('dotnet');
  });

  it('detects 64-bit images', () => {
    const info = inspectPE(makePE({ machine: 0x8664 }));
    expect(info.verdict).toBe('native-64');
  });

  it('rejects non-PE and DOS-only files with a reason', () => {
    expect(inspectPE(new Uint8Array(1024)).ok).toBe(false);
    const dos = new Uint8Array(1024);
    dos[0] = 0x4d;
    dos[1] = 0x5a;
    expect(inspectPE(dos).ok).toBe(false);
  });

  it('describes a program in one line', () => {
    expect(describePE(inspectPE(makePE({})))).toContain('i386');
  });
});
