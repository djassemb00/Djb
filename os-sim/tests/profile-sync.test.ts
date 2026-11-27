import { describe, expect, it } from 'vitest';
import { SYNC_DEFAULT, describeSync, planSync, pullProfiles } from '../src/system/profileSync';
import { buildProfile, type Profile } from '../src/system/profileSchema';
import { generateProfile, toContainerJson } from '../src/system/winePrefix';

/**
 * PLAN ٣-٤: the claim that needs no network is "nothing leaves the device by default".
 * The claim that needs a network is "pull 3 profiles in under two seconds" -- and there is
 * no Supabase project and no route to one from here, so it is NOT claimed. What is
 * tested is the refusal, which is the half that can be proven to the byte.
 *
 * No fetch stub is used for the off cases on purpose: a fetch that was never called and a
 * fetch that failed look identical through a stub, so the stub would prove nothing. The
 * real check is that the planner refuses before a request could be made.
 */
const validProfile = (id = 'gta5'): Profile => {
  const built = buildProfile({
    id,
    title: 'GTA V',
    soc: 'sd8gen1',
    gpu: 'adreno730',
    ramGB: 8,
    container: JSON.parse(toContainerJson(generateProfile({ title: 'GTA V', is32: false }))),
    author: 'nova',
    created: '2026-11-27',
    verifiedOnDevice: false,
  });
  if (!built.ok) throw new Error(JSON.stringify(built.issues));
  return built.profile;
};

describe('٣-٤ sync is off unless the user turned it on', () => {
  it('the module default is disabled', () => {
    expect(SYNC_DEFAULT.enabled).toBe(false);
    expect(planSync(SYNC_DEFAULT)).toEqual({ status: 'disabled' });
  });

  it('refuses to pull when disabled, without touching fetch', async () => {
    let called = 0;
    const fakeFetch = (() => {
      called++;
      throw new Error('must not be called');
    }) as unknown as typeof fetch;
    const r = await pullProfiles(SYNC_DEFAULT, fakeFetch);
    expect(r.status).toBe('disabled');
    expect(called, 'a disabled sync must not make a network request').toBe(0);
  });

  it('says why it cannot run when enabled but unconfigured', async () => {
    const r = await pullProfiles({ enabled: true });
    expect(r.status).toBe('unconfigured');
    if (r.status === 'unconfigured') {
      expect(r.reason).toMatch(/[؀-ۿ]/);
      expect(r.reason).toContain('عنوان');
    }
  });

  it('will not run with an endpoint but no key', async () => {
    const r = await pullProfiles({ enabled: true, endpoint: 'https://x.supabase.co' });
    expect(r.status).toBe('unconfigured');
    if (r.status === 'unconfigured') expect(r.reason).toContain('مفتاح');
  });

  it('describes the disabled state without implying anything synced', () => {
    const text = describeSync({ status: 'disabled' });
    expect(text).toContain('معطّلة');
    expect(text).toContain('جهازك');
    expect(text).not.toContain('تمت المزامنة');
  });
});

describe('٣-٤ when configured, the remote is not trusted', () => {
  it('validates every remote row with the same schema and drops bad ones', async () => {
    const good = validProfile('gta5');
    const bad = { ...validProfile('old1'), container: { screenSize: '1280x720', emulator: 'X' } };
    const fakeFetch = (async () =>
      ({
        ok: true,
        json: async () => [good, bad],
      }) as unknown as Response) as typeof fetch;

    const r = await pullProfiles(
      { enabled: true, endpoint: 'https://x.supabase.co', key: 'k' },
      fakeFetch,
    );
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.profiles).toHaveLength(1);
      expect(r.profiles[0].game.id).toBe('gta5');
      // and the count is reported, so the user is not told one row arrived when two did
      expect(describeSync(r, 2)).toContain('من 2');
    }
  });

  it('reports a server error rather than an empty success', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 401 }) as unknown as Response) as typeof fetch;
    const r = await pullProfiles(
      { enabled: true, endpoint: 'https://x.supabase.co', key: 'bad' },
      fakeFetch,
    );
    expect(r.status).toBe('failed');
    if (r.status === 'failed') expect(r.reason).toContain('401');
  });

  it('gives up at the deadline instead of hanging', async () => {
    // a fetch that never settles, aborted by the timeout the module installs
    const hanging = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })) as unknown as typeof fetch;
    const started = Date.now();
    const r = await pullProfiles(
      { enabled: true, endpoint: 'https://x.supabase.co', key: 'k' },
      hanging,
      50,
    );
    expect(r.status).toBe('failed');
    if (r.status === 'failed') expect(r.reason).toContain('المهلة');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('٣-٤ the module carries no credential', () => {
  it('has no hard-coded endpoint or key in the source', async () => {
    /*
     * A key committed to a public repository has leaked, and "it is only an anonymous
     * key" is the usual way that mistake is made. This asserts the file contains no URL
     * and no long token, so the endpoint can only come from the user's own settings.
     */
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/system/profileSync.ts', 'utf8');
    expect(src).not.toMatch(/https:\/\/[a-z0-9]{6,}\.supabase\.co/);
    // no JWT-shaped literal (three base64url segments)
    expect(src).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  });
});

describe('٣-٤ no credential reaches the app store', () => {
  it('the persisted slice cannot carry a sync key', async () => {
    /*
     * The UI tells the user "the key is not written to disk". That is a privacy claim, so
     * it must be proved rather than eyeballed: useOS persists through zustand's
     * `persist` with an explicit partialize list, and a key stored in a *different*
     * store (or added to this list later) would silently falsify the sentence.
     */
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/store/useOS.ts', 'utf8');
    const block = src.slice(src.indexOf('partialize:'), src.indexOf('partialize:') + 500);
    expect(block).not.toMatch(/key|endpoint|sync|supabase/i);
    // and the profile store writes profiles only, never a SyncConfig
    const store = fs.readFileSync('src/system/profileStore.ts', 'utf8');
    expect(store).not.toMatch(/SyncConfig|localStorage/);
  });
});
