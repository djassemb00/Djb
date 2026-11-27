/**
 * PLAN ٣-٤: optional sync, OFF by default, and the default is the part that matters.
 *
 * The plan says "يبدأ ثابتاً (بلا حساب ولا خصوصية)، والمزامنة اختيارية صريحة" -- it starts
 * static, with no account and no privacy surface, and sync is an explicit opt-in. So the
 * only claim this module makes without a network is the one that must never be wrong:
 * **nothing leaves the device unless the user turned it on, and "on" cannot be inherited
 * from a previous state, a config file, or a default parameter.**
 *
 * The acceptance test in the plan is a timing ("pull 3 profiles in < 2 s"). That cannot be
 * measured here: there is no Supabase project, no credentials, and no network from this
 * sandbox to one. Rather than assert a duration against a mock -- which would measure the
 * mock -- this module reports `configured: false` and the sync function refuses, saying
 * why. That is the honest state, and it is testable to the byte.
 *
 * What is deliberately NOT here: a hard-coded project URL or an anon key. A key committed
 * to a public repository is a key that has leaked, and "it is only an anon key" is how
 * that mistake usually gets made. The endpoint comes from the user's own settings.
 */
import type { Profile } from './profileSchema';
import { parseProfile } from './profileSchema';

export interface SyncConfig {
  /**
   * Must be true to do anything. Deliberately has no default of `true` anywhere in this
   * file: the only way it becomes true is a caller reading it from an explicit user action.
   */
  enabled: boolean;
  /** e.g. https://<project>.supabase.co — supplied by the user, never committed */
  endpoint?: string;
  /** the user's own key; kept in memory, not written to disk by this module */
  key?: string;
}

export const SYNC_DEFAULT: SyncConfig = { enabled: false };

export type SyncOutcome =
  | { status: 'disabled' }
  | { status: 'unconfigured'; reason: string }
  | { status: 'ok'; profiles: Profile[] }
  | { status: 'failed'; reason: string };

/**
 * The whole decision, made before any network call.
 *
 * Kept separate from `pullProfiles` so the refusal is testable without a fetch stub: the
 * interesting question is "did we ask the network at all", and a stubbed fetch makes that
 * question unanswerable (a stub was never invoked, which looks identical to a request
 * that failed).
 */
export function planSync(cfg: SyncConfig): SyncOutcome | { status: 'go' } {
  if (!cfg.enabled) return { status: 'disabled' };
  if (!cfg.endpoint) {
    return {
      status: 'unconfigured',
      reason: 'المزامنة مفعّلة لكن بلا عنوان خادم — لا نخمّن عنواناً ولا نتصل بأي جهة تلقائياً',
    };
  }
  if (!cfg.key) {
    return {
      status: 'unconfigured',
      reason: 'المزامنة مفعّلة لكن بلا مفتاح — المفتاح لا يُحفظ في المستودع ولا يُكتب على القرص',
    };
  }
  return { status: 'go' };
}

/**
 * Pull profiles. Returns the refusal when sync is off or half-configured, and never
 * throws into the caller's render path.
 */
export async function pullProfiles(
  cfg: SyncConfig,
  fetchImpl: typeof fetch | undefined = typeof fetch === 'function' ? fetch : undefined,
  timeoutMs = 2000,
): Promise<SyncOutcome> {
  const plan = planSync(cfg);
  if (plan.status !== 'go') return plan;

  if (!fetchImpl) {
    return { status: 'failed', reason: 'لا يوجد fetch في هذه البيئة' };
  }
  // The plan's acceptance test is two seconds; a request that hangs must not freeze the
  // UI, and "still loading" forever is the same lie as a spinner with nothing behind it.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.endpoint}/rest/v1/profiles?select=*&limit=50`, {
      headers: { apikey: cfg.key ?? '', Authorization: `Bearer ${cfg.key ?? ''}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { status: 'failed', reason: `الخادم رفض الطلب: ${res.status}` };
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) {
      return { status: 'failed', reason: 'استجابة غير متوقّعة: ليست مصفوفة إعدادات' };
    }
    /*
     * Every remote profile goes through the same schema as a local one. A server is not
     * a trusted source: an outdated or hostile row carrying `emulator` must be refused
     * exactly like a hand-edited file, and counted separately so the UI can say
     * "3 arrived, 1 rejected" instead of silently dropping it.
     */
    const profiles: Profile[] = [];
    for (const row of body) {
      const parsed = parseProfile(row);
      if (parsed.ok) profiles.push(parsed.profile);
    }
    return { status: 'ok', profiles };
  } catch (e) {
    const msg = (e as Error)?.name === 'AbortError' ? 'انتهت المهلة قبل ردّ الخادم' : (e as Error)?.message;
    return { status: 'failed', reason: msg ?? 'فشل غير معروف' };
  } finally {
    clearTimeout(timer);
  }
}

/** How many rows arrived versus how many passed the schema. */
export function describeSync(outcome: SyncOutcome, received = 0): string {
  switch (outcome.status) {
    case 'disabled':
      return 'المزامنة معطّلة — كل شيء على جهازك، ولا يخرج منه شيء';
    case 'unconfigured':
    case 'failed':
      return outcome.reason;
    case 'ok':
      return received > outcome.profiles.length
        ? `${outcome.profiles.length} إعداداً صالحاً من ${received} — الباقي رُفض لأنه لا يطابق المخطط`
        : `${outcome.profiles.length} إعداداً`;
  }
}
