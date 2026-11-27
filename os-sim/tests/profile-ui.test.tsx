// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GameSetupApp } from '../src/apps/GameSetupApp';
import * as nl from '../src/system/nativeLaunch';

/**
 * PLAN ٣-١ + ٣-٣ in the UI, proved by mounting rather than by reading.
 *
 * The acceptance criterion for ٣-١ is "a wrong file is rejected with a clear Arabic
 * message". A pure-function test can assert that; only a mounted component can prove the
 * user can reach it. So this drives the real textarea and button.
 */
const mount = async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<GameSetupApp />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { host, root };
};

const typeInto = async (el: HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const clickButton = async (label: string) => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (!btn) throw new Error(`button not found: ${label}`);
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
};

describe('the profile import box', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    nl.__setNativeLaunchForTest(null);
    nl.__resetSharedFileCache();
  });

  it('offers the import box to the user at all', async () => {
    const { root } = await mount();
    const ta = document.querySelector('textarea');
    expect(ta, 'no import textarea is rendered').toBeTruthy();
    await act(async () => root.unmount());
  });

  it('refuses a key Winlator ignores, naming it in Arabic', async () => {
    const { root } = await mount();
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    await typeInto(
      ta,
      JSON.stringify({
        schema: 1,
        game: { id: 'gta5', title: 'GTA V' },
        device: { soc: 'sd8gen1', gpu: 'adreno730', ramGB: 8 },
        container: { screenSize: '1280x720', emulator: 'FEXCore' },
        meta: { author: 'x', created: '2026-11-27', verifiedOnDevice: false },
      }),
    );
    await clickButton('تحقّق من الملف');
    const text = document.body.textContent ?? '';
    expect(text).toContain('مرفوض');
    expect(text).toContain('emulator');
    await act(async () => root.unmount());
  });

  it('says the file is not JSON rather than failing silently', async () => {
    const { root } = await mount();
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    await typeInto(ta, '{not json');
    await clickButton('تحقّق من الملف');
    expect(document.body.textContent).toContain('ليس JSON');
    await act(async () => root.unmount());
  });

  it('reports the local save outcome instead of letting the export tick stand for it', async () => {
    /*
     * The export (a file) and the local save are two different outcomes. In this
     * environment IndexedDB does not exist, so the save MUST come back as a failure --
     * and saying nothing, or inheriting the export's success, is the lie. Mutating the
     * save-state block out of the JSX originally left every test green, which is why this
     * one exists.
     */
    const { root } = await mount();
    await clickButton('نزّل ملف الحاوية');
    /*
     * Asserted on the status element itself, not on body.textContent: the first version
     * read the whole page, and "/لم يُحفظ/" matched a sentence elsewhere in the UI, so
     * flipping the failure into a success left the test green. A green tick that is read
     * from the wrong element is not a checkpoint.
     */
    const statuses = [...document.querySelectorAll('[role="status"]')].map(
      (el) => el.textContent ?? '',
    );
    const saveLine = statuses.find((t) => /لم يُحفظ|محفوظ على الجهاز/.test(t));
    expect(saveLine, `no save status element; got: ${JSON.stringify(statuses)}`).toBeTruthy();
    expect(saveLine).toContain('لم يُحفظ');
    expect(saveLine).toContain('التخزين المحلي');
    /*
     * The colour and the sentence must agree. Mutating the boolean alone used to leave
     * this green, because it only changed the style -- a green tick over "لم يُحفظ" is
     * precisely the lie this suite is supposed to catch.
     */
    const line = [...document.querySelectorAll('[role="status"]')].find((el) =>
      (el.textContent ?? '').includes('لم يُحفظ'),
    ) as HTMLElement;
    expect(line, 'the failure line is missing').toBeTruthy();
    expect(line.style.color, 'a failure must not be painted as success').toContain('f87171');
    /*
     * Two outcomes, two elements. In jsdom the export lane cannot succeed either
     * (`URL.createObjectURL` does not exist), so both statuses report failure -- which is
     * correct and is itself evidence that the two are tracked apart rather than sharing
     * one green tick.
     */
    const exportLine = statuses.find((t) => t !== saveLine);
    expect(exportLine, `expected a separate export status; got ${JSON.stringify(statuses)}`).toBeTruthy();
    expect(exportLine).not.toContain('محفوظ على الجهاز');
    await act(async () => root.unmount());
  });

  it('accepts a real profile and reports its container size', async () => {
    const { root } = await mount();
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    // built from the app's own generator through the schema, not hand-written
    const { generateProfile, toContainerJson } = await import('../src/system/winePrefix');
    const { buildProfile } = await import('../src/system/profileSchema');
    const p = generateProfile({ title: 'GTA V', is32: false });
    const built = buildProfile({
      id: 'gta5',
      title: 'GTA V',
      soc: 'sd8gen1',
      gpu: 'adreno730',
      ramGB: 8,
      container: JSON.parse(toContainerJson(p)),
      author: 'nova',
      created: '2026-11-27',
      verifiedOnDevice: false,
    });
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    await typeInto(ta, JSON.stringify(built.profile));
    await clickButton('تحقّق من الملف');
    const text = document.body.textContent ?? '';
    expect(text).toContain('مقبول');
    expect(text).toContain('GTA V');
    await act(async () => root.unmount());
  });
});

describe('٣-٤ the sync switch, off by default', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    nl.__setNativeLaunchForTest(null);
    nl.__resetSharedFileCache();
  });

  it('renders the sync section with its state stated in words', async () => {
    const { root } = await mount();
    const text = document.body.textContent ?? '';
    expect(text).toContain('المزامنة');
    // the default must be readable, not inferable from a toggle's appearance
    expect(text).toContain('معطّلة');
    expect(text).not.toContain('مفعّلة —');
    await act(async () => root.unmount());
  });

  it('a pull while off says nothing left the device', async () => {
    const { root } = await mount();
    await clickButton('اسحب الآن');
    const statuses = [...document.querySelectorAll('[role="status"]')].map(
      (el) => el.textContent ?? '',
    );
    const line = statuses.find((t) => t.includes('معطّلة') || t.includes('جهازك'));
    expect(line, `no sync status; got ${JSON.stringify(statuses)}`).toBeTruthy();
    expect(line).toContain('لا يخرج');
    await act(async () => root.unmount());
  });

  it('turning it on states what it would do, and still refuses without a server', async () => {
    const { root } = await mount();
    await clickButton('فعّل');
    expect(document.body.textContent).toContain('تخرج إعداداتك');
    await clickButton('اسحب الآن');
    const statuses = [...document.querySelectorAll('[role="status"]')].map(
      (el) => el.textContent ?? '',
    );
    const line = statuses.find((t) => t.includes('غير مُهيّأ') || t.includes('بلا عنوان'));
    expect(line, `expected the unconfigured refusal; got ${JSON.stringify(statuses)}`).toBeTruthy();
    await act(async () => root.unmount());
  });
});

describe('٣-٦ the reasons are per-key and reachable', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    nl.__setNativeLaunchForTest(null);
    nl.__resetSharedFileCache();
  });

  it('renders a clickable reason line for every written key', async () => {
    /*
     * Asserted against the rendered DOM, not against reasonsFor(): the defect was that the
     * data existed in one list and the UI showed six loose sentences. Only a render test can
     * see the difference.
     */
    const { generateProfile, toContainerJson } = await import('../src/system/winePrefix');
    const written = Object.keys(
      JSON.parse(toContainerJson(generateProfile({ title: 'GTA V', is32: false }))),
    );
    const { root } = await mount();
    // open the details block that holds the reasons
    const summary = [...document.querySelectorAll('summary')].find((el) =>
      (el.textContent ?? '').includes('لماذا هذه القيم'),
    );
    expect(summary, 'the "why these values" block is missing').toBeTruthy();
    await act(async () => {
      (summary as HTMLElement).parentElement?.setAttribute('open', '');
    });

    const codes = [...document.querySelectorAll('summary code')].map((c) => c.textContent);
    for (const k of written) {
      expect(codes, `no reason line for ${k}`).toContain(k);
    }
    await act(async () => root.unmount());
  });
});
