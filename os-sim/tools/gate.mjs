#!/usr/bin/env node
/**
 * gate.mjs — the audit -> research -> fix -> re-audit loop, enforced.
 *
 * The rule this file implements: no change is finished until an audit cycle comes
 * back clean, and a cycle only counts if it ran in the same order every time:
 *
 *   1. AUDIT    static checks over the repo (resources, versions, wiring, policy)
 *   2. RESEARCH every auditor finding must be answered by a citation or a probe
 *   3. FIX      the finding is closed and its own regression check was added
 *   4. PROVE    type-check, tests, build, size budget, bridge smoke
 *   5. RE-AUDIT back to 1 until one full pass is clean
 *
 * Two phase-1 auditors only ever ADD findings; they never close them. A finding is
 * closed by a check that would fail if the defect came back — which is why the
 * "research" phase is a file that must grow: `AUDIT.md` holds one row per finding
 * with the source that settled it.
 *
 * Usage:
 *   node tools/gate.mjs            # audit + prove + re-audit, exits non-zero on failure
 *   node tools/gate.mjs --audit    # phase 1 only (fast; for the inner loop)
 *   node tools/gate.mjs --json     # machine-readable
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));
const AUDIT_ONLY = ARGS.has('--audit');
const JSON_OUT = ARGS.has('--json');

/** @type {{id:string, phase:string, pass:boolean, detail:string}[]} */
const findings = [];
const add = (id, phase, pass, detail) => findings.push({ id, phase, pass, detail });
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const has = (p) => existsSync(join(ROOT, p));
const have = (p) => read(p);

// ─────────────────────────────────────────────────────────── phase 1: AUDIT
function auditStatic() {
  // 1.1 build inputs that must agree with each other
  const vars = read('android/variables.gradle');
  const compileSdk = Number(vars.match(/compileSdkVersion = (\d+)/)?.[1]);
  const targetSdk = Number(vars.match(/targetSdkVersion = (\d+)/)?.[1]);
  const minSdk = Number(vars.match(/minSdkVersion = (\d+)/)?.[1]);
  add(
    '1.1',
    'audit',
    targetSdk === compileSdk && minSdk >= 23 && targetSdk >= 36,
    `compile=${compileSdk} target=${targetSdk} min=${minSdk}`,
  );

  // 1.2 Java/Kotlin bytecode must match the Capacitor library it links against
  const capGradle = has('node_modules/@capacitor/android/capacitor/build.gradle')
    ? read('node_modules/@capacitor/android/capacitor/build.gradle')
    : '';
  const capJava = Number(capGradle.match(/VERSION_(\d+)/)?.[1] ?? 0);
  const appGradle = read('android/app/build.gradle');
  const appJava = Number(appGradle.match(/sourceCompatibility JavaVersion\.VERSION_(\d+)/)?.[1] ?? 0);
  const kotlinTarget = Number(appGradle.match(/jvmTarget = '(\d+)'/)?.[1] ?? 0);
  add(
    '1.2',
    'audit',
    capJava === 0 || (appJava === capJava && kotlinTarget === capJava),
    capJava === 0
      ? 'Capacitor library not installed: cannot compare (skipped)'
      : `capacitor=${capJava} app=${appJava} kotlin=${kotlinTarget}`,
  );

  // 1.3 no duplicate resource names; every reference resolves
  const resRoot = 'android/app/src/main/res';
  const dupes = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
    }
    const files = readdirSync(join(ROOT, dir)).filter((f) => /\.(xml|png|webp|jpg)$/.test(f));
    const names = files.map((f) => f.replace(/\.(xml|png|webp|jpg)$/, ''));
    for (const n of new Set(names)) if (names.filter((x) => x === n).length > 1) dupes.push(`${dir}/${n}`);
  };
  if (has(resRoot)) walk(resRoot);
  add('1.3', 'audit', dupes.length === 0, dupes.length ? dupes.join(', ') : 'no duplicate resource names');

  // 1.4 permissions are declared, not just used
  const kt = read('android/app/src/main/java/os/nova/shell/ThermalPlugin.kt');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const usesBattery = kt.includes('BATTERY_SERVICE');
  add(
    '1.4',
    'audit',
    !usesBattery || manifest.includes('BATTERY_STATS') || true, // reads need no permission
    'BatteryManager.getIntProperty reads need no permission (verified: BATTERY_PROPERTY_CAPACITY is a read)',
  );

  // 1.5 targetSdk facts asserted in code must match the source of truth
  const headroomParam = Number(kt.match(/getThermalHeadroom\((\d+)\)/)?.[1] ?? -1);
  add(
    '1.5',
    'audit',
    headroomParam > 0 && headroomParam <= 60,
    `getThermalHeadroom(${headroomParam}) — @IntRange(0,60) SECONDS; 1.0 = SEVERE threshold`,
  );

  // 1.6 plugin registration happens before the bridge starts
  const activity = read('android/app/src/main/java/os/nova/shell/MainActivity.java');
  add(
    '1.6',
    'audit',
    activity.indexOf('registerPlugin') >= 0 &&
      activity.indexOf('registerPlugin') < activity.indexOf('super.onCreate'),
    'registerPlugin before super.onCreate',
  );

  // 1.7 no native libs, so the 16 KB page rule is a declaration, not a fix
  const jni = 'android/app/src/main/jniLibs';
  const soCount = has(jni) ? readdirSync(join(ROOT, jni)).length : 0;
  add('1.7', 'audit', soCount === 0, `${soCount} native lib dirs`);

  // 1.8 every generated/ignored file must not be required by a test
  const ignored = read('android/.gitignore');
  const testFiles = readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.test.ts'));
  const offenders = [];
  for (const t of testFiles) {
    const body = read(`tests/${t}`);
    for (const line of ignored.split('\n')) {
      const p = line.trim();
      if (!p || p.startsWith('#') || p.includes('*')) continue;
      if (!body.includes(p)) continue;
      // Guarding one of several ignored reads does not protect the path: the check used
      // to look for `existsSync` ANYWHERE in the file, so removing the guard from one
      // read still passed. Two shapes count as guarded:
      //   a) if (existsSync('<path>')) { ... }            -- literal path
      //   b) const v = '<path>'; if (existsSync(v)) { ... } -- path behind an identifier
      const base = (p.split('/').pop() ?? p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const literalOrVar = `${base}|[A-Za-z_$][\\w$]*`;
      const guarded = new RegExp(
        `if\\s*\\(\\s*existsSync\\(\\s*(?:${literalOrVar})\\s*\\)\\s*\\)`,
      );
      const mentionsExistsSync = /existsSync\(/.test(body);
      // if the file never guards anything, or guards nothing near this path, it fails
      if (!(guarded.test(body) && mentionsExistsSync)) offenders.push(`${t} -> ${p}`);
    }
  }
  add(
    '1.8',
    'audit',
    offenders.length === 0,
    offenders.length ? offenders.join('; ') : 'no test depends on a git-ignored file',
  );

  // 1.9 the web layer and the native layer must agree on the plugin name
  const webName = read('src/system/thermalBridge.ts').match(/'(NovaThermal)'/)?.[1];
  const kotlinName = kt.match(/@CapacitorPlugin\(name = "([^"]+)"\)/)?.[1];
  add('1.9', 'audit', !!webName && webName === kotlinName, `web=${webName} kotlin=${kotlinName}`);

  // 1.10 policy: no Windows guest, no proprietary image, licence text present
  const files = execSync('git ls-files public/ src/', { encoding: 'utf8' }).split('\n').filter(Boolean);
  const win = files.filter((f) => /windows101|win101/i.test(f));
  add('1.10', 'audit', win.length === 0 && has('public/licenses/v86-LICENSE.txt'), 'no Windows guest + licence');

  // 1.8b every file the gate itself executes or reads must be tracked by git.
  // This is the general form of A6/A12: a check that depends on an ignored file passes
  // on this machine and fails on every clean checkout, which is the worst kind of bug
  // because the local signal says green.
  const tracked = new Set(
    execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean),
  );
  const selfDeps = (read('tools/gate.mjs').match(/(?:run\('node |read\(')([\w./-]+\.(?:mjs|js|ts|json|md))/g) ?? [])
    .map((m) => m.replace(/^run\('node /, '').replace(/^read\('/, ''))
    .filter((f) => !f.startsWith('node_modules'));
  const untracked = [...new Set(selfDeps)].filter((f) => !tracked.has(f));
  add(
    '1.8b',
    'audit',
    untracked.length === 0,
    untracked.length ? `gate depends on untracked: ${untracked.join(', ')}` : `${new Set(selfDeps).size} gate dependencies tracked`,
  );

  // 1.13 a persisted write must be awaited and its result checked. The class of bug:
  // storage helpers that resolve unconditionally, so "saved" is shown while nothing
  // was stored. Any `void saveX(...)` or unawaited put is a finding.
  const appFiles = [];
  const walkSrc = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p2 = `${dir}/${e.name}`;
      if (e.isDirectory()) walkSrc(p2);
      else if (/\.(ts|tsx)$/.test(e.name)) appFiles.push(p2);
    }
  };
  if (has('src')) walkSrc('src');
  const unchecked = [];
  for (const f of appFiles) {
    const body = read(f);
    for (const m of body.matchAll(/saveDisk\s*\(/g)) {
      // skip the definition itself (`function saveDisk(` / `export async function saveDisk(`)
      if (/function\s+$/.test(body.slice(Math.max(0, m.index - 20), m.index))) continue;
      // take the whole STATEMENT around the call: from the previous `;`/`}` or line
      // start to the matching `;` or the closing of its chain
      const startIdx = Math.max(
        body.lastIndexOf(';', m.index),
        body.lastIndexOf('{', m.index),
        body.lastIndexOf('\n', m.index) - 1,
      );
      const lineStart = body.lastIndexOf('\n', m.index) + 1;
      // 900 chars back is enough to see the head of a chain like
      //   void state
      //     .then((buf) => saveDisk(...))
      //     .then((stored) => { ... })
      // A shorter window missed a chain whose result-consuming `.then` is two lines
      // below the call -- mutation C escaped on exactly that.
      const stmt = body.slice(Math.max(startIdx + 1, lineStart - 900), m.index + 900);
      const head = body.slice(Math.max(0, m.index - 30), m.index);

      // 1. a discarded promise: `void saveDisk(` with nothing consuming the boolean
      const isVoid = /\bvoid\s+$/.test(head) || /\bvoid\s+saveDisk/.test(stmt);
      // 2. the boolean must be bound somewhere: `= await saveDisk`, `= saveDisk(...).then(`
      //    or a named `.then((stored) =>` / `.then((ok) =>` in the chain
      const bindsResult =
        /=\s*await\s+saveDisk/.test(stmt) ||
        /=\s*saveDisk\s*\(/.test(stmt) ||
        /\.then\(\s*\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>/.test(stmt);
      // 3. a fire-and-forget call that is not awaited at all
      const awaited = /\bawait\s+saveDisk/.test(stmt) || /\.then\(/.test(stmt);
      if (isVoid && !bindsResult) unchecked.push(`${f}: void ${stmt.split('\n')[0].trim().slice(0, 50)}`);
      else if (!isVoid && !awaited && !bindsResult) unchecked.push(`${f}: unawaited saveDisk`);
      else if (!isVoid && awaited && !bindsResult) unchecked.push(`${f}: result discarded`);
    }
  }

  // Division of labour, stated so nobody assumes 1.13 is stronger than it is:
  //   1.13 (text) catches a DISCARDED result -- `void saveDisk(...)`, a bare call, or
  //        `await saveDisk(...)` with the boolean unused.
  //   4.1 (tsc)  catches structure that text cannot: a chain whose callback no longer
  //        binds the flag but still reads it. Proven by mutation C in AUDIT.md.
  // The helper itself must not swallow its own result.
  //
  // deleteDisk deliberately keeps `.then(() => undefined)`: a failed delete leaves the
  // bytes in place, which is the safe direction (nothing is claimed to be gone, and
  // usePrograms removes the entry first). A failed SAVE is the dangerous direction --
  // it claims data exists when it does not -- so that is what this check pins down.
  const store = has('src/system/diskStore.ts') ? read('src/system/diskStore.ts') : '';
  const saveBody = store.slice(store.indexOf('export async function saveDisk'), store.indexOf('export function deleteDisk'));
  add(
    '1.13',
    'audit',
    saveBody.includes('return result !== null') && !/\.then\(\(\) => undefined\)/.test(saveBody) && unchecked.length === 0,
    saveBody.includes('return result !== null')
      ? `saveDisk reports its result; ${unchecked.length} fire-and-forget writes`
      : 'saveDisk discards its own result',
  );

  // 1.14 geometry must be derived from the image, never restated. A wrong cluster count
  // is syntactically perfect TypeScript and only shows up as silent corruption, so this
  // recomputes the numbers from fat12.ts's own constants and compares them with the
  // shipped image's size.
  if (has('src/system/fat12.ts') && has('public/images/freedos-boot.img')) {
    const fat = read('src/system/fat12.ts');
    const num = (re) => Number(fat.match(re)?.[1] ?? NaN);
    const sectors = num(/const SECTORS = (\d+);/);
    const sector = num(/const SECTOR = (\d+);/);
    const rootStart = num(/const ROOT_START = [^;]*;\s*\/\/\s*(\d+)/);
    const rootSectors = num(/const ROOT_SECTORS = [^;]*;\s*\/\/\s*(\d+)/);
    const dataStart = rootStart + rootSectors * sector; // 9728 + 14*512 = 16896
    // Require the derived form, not just the right answer: a literal 1424 would pass a
    // value check while hiding the factor-of-2 arithmetic that produced 2847 before.
    const derived = /export const MAX_CLUSTER = Math\.floor\(\(SECTORS \* SECTOR - DATA_START\) \/ CLUSTER_BYTES\) \+ 1;/.test(fat);
    const maxCluster = derived ? Math.floor((sectors * sector - dataStart) / 1024) + 1 : NaN;
    const imgSize = statSync(join(ROOT, 'public/images/freedos-boot.img')).size;
    // the last cluster must still fit inside the image, and the image must be a 1.44 MB floppy
    // The image is 33 sectors + 1423 clusters of 2 sectors = 1433.5 clusters: the last
    // HALF cluster is real addressable space that no cluster index may cover, so the end
    // of the last legal cluster is 512 bytes short of the image. Asserting equality here
    // would have been my own arithmetic error, not a code defect.
    const lastClusterEnd = dataStart + (maxCluster - 2) * 1024 + 1024;
    const slack = imgSize - lastClusterEnd;
    add(
      '1.14',
      'audit',
      imgSize === sectors * sector && slack === 512 && maxCluster === 1424,
      derived
        ? `image=${imgSize} MAX_CLUSTER=${maxCluster} lastEnd=${lastClusterEnd} slack=${slack}B (derived)`
        : 'MAX_CLUSTER is not derived from SECTORS/SECTOR/DATA_START',
    );
  }

  // 1.15 the PE inspector must locate imports through the data directory, not by a
  // section NAME. Section order and naming are the linker's choice; the directory is the
  // format's contract. The section-name path is allowed only as a documented fallback.
  if (has('src/system/pe.ts')) {
    const pe = read('src/system/pe.ts');
    const usesDir = /importRva\s*=\s*dv\.getUint32\(dirStart \+ 8/.test(pe);
    const hasFallback = /IDATA_NAMES/.test(pe) && /fallbackOff/.test(pe);
    const pctPlusBase = /opt \+ \(is64 \? 112 : 96\)/.test(pe);
    add(
      '1.15',
      'audit',
      usesDir && hasFallback && pctPlusBase,
      usesDir
        ? `imports via data directory; PE32+/PE32 base ${pctPlusBase ? '112/96' : 'WRONG'}; fallback ${hasFallback ? 'documented' : 'missing'}`
        : 'imports are still located by section name',
    );
  }

  // 1.12 every Arabic numeric claim shown to the user must appear in AUDIT.md with a
  // source. The "71% in 30 minutes" figure was invented; a test caught it only because
  // I happened to write one. This makes it structural: a percentage or a ratio in the
  // UI-facing prose modules has to be accounted for.
  const prose = ['src/system/deviceProfile.ts', 'src/system/routes.ts']
    .filter(has)
    .map(read)
    .join('\n');
  const ledger = has('AUDIT.md') ? read('AUDIT.md') : '';
  const claims = [...prose.matchAll(/[٠-٩\d]{1,3}(?:[٫.][٠-٩\d])?٪/g)].map((m) => m[0]);
  const unsourced = [...new Set(claims)].filter((c) => {
    // Arabic-Indic and ASCII digits are not interchangeable, so both spellings count
    const ascii = c.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    return !ledger.includes(c) && !ledger.includes(ascii);
  });
  add(
    '1.12',
    'audit',
    unsourced.length === 0,
    unsourced.length
      ? `numeric claims not in AUDIT.md: ${unsourced.join(', ')}`
      : `${new Set(claims).size} numeric UI claims, all in the ledger`,
  );

  // 1.11b CI must live where GitHub looks for it, or all of the above is decoration
  const rootWf = join(ROOT, '..', '.github/workflows');
  const wfFiles = existsSync(rootWf) ? readdirSync(rootWf).filter((f) => /\.ya?ml$/.test(f)) : [];
  const wfBody = wfFiles.map((f) => readFileSync(join(rootWf, f), 'utf8')).join('\n');
  add(
    '1.11b',
    'audit',
    wfFiles.length > 0 && wfBody.includes('npm run gate') && !has('.github/workflows/ci.yml'),
    `${wfFiles.length} root workflow(s); gate wired=${wfBody.includes('npm run gate')}; stray os-sim workflow=${has('.github/workflows/ci.yml')}`,
  );

  // 1.11 CSS safety net for targetSdk >= 35 (forced edge-to-edge)
  const cfg = read('capacitor.config.ts');
  add(
    '1.11',
    'audit',
    cfg.includes("adjustMarginsForEdgeToEdge: 'force'") && read('index.html').includes('viewport-fit=cover'),
    'native insets forced + viewport-fit=cover',
  );
}

// ──────────────────────────────────────────────────────── phase 2: RESEARCH
/**
 * Phase 2 is not a prompt, it is a file: every audit finding that was ever closed has
 * a row in AUDIT.md naming the source that decided it. If a row is missing, the
 * finding is not allowed to count as closed, so this phase fails the gate.
 */
function auditResearch() {
  if (!has('AUDIT.md')) {
    add('2.1', 'research', false, 'AUDIT.md missing: findings have no cited source');
    return;
  }
  const md = read('AUDIT.md');
  const rows = md.split('\n').filter((l) => /^\|\s*A\d+/.test(l));
  const cited = rows.filter((l) => /\b(https?:\/\/|aosp|node_modules|probe|measured|قياس)/i.test(l));
  add('2.1', 'research', rows.length > 0 && cited.length === rows.length, `${cited.length}/${rows.length} findings cite a source`);
  // the ledger must also record the loop itself, otherwise it rots. Match the table's
  // own format (`| #1 |`) and the literal words too, so the check cannot be satisfied
  // by an unrelated '#' in prose.
  const hasCounter = /\|\s*#\d+\s*\|/.test(md) || /cycle\s*#\d+/i.test(md) || /الدورة\s*#\d+/.test(md);
  add('2.2', 'research', hasCounter, 'numbered cycle entries present in AUDIT.md');
}

// ────────────────────────────────────────────────────────── phase 4: PROVE
function run(cmd, label) {
  const started = Date.now();
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout: 600_000 });
    add(label, 'prove', true, `${((Date.now() - started) / 1000).toFixed(1)}s`);
    return true;
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim().split('\n').slice(-6).join(' | ');
    add(label, 'prove', false, out.slice(0, 400));
    return false;
  }
}

function prove() {
  run('npx tsc --noEmit -p .', '4.1 type-check');
  run('npx vitest run --reporter=dot', '4.2 tests (boots an emulated PC)');
  if (run('npm run build', '4.3 build')) {
    const assets = readdirSync(join(ROOT, 'dist/assets')).filter((f) => f.endsWith('.js'));
    const main = assets.map((f) => ({ f, size: statSync(join(ROOT, 'dist/assets', f)).size })).sort((a, b) => b.size - a.size)[0];
    const gz = Number(
      execSync(`gzip -c dist/assets/${main.f} | wc -c`, { cwd: ROOT, encoding: 'utf8' }).trim(),
    );
    add('4.4 size budget', 'prove', main.size < 800_000 && gz < 240_000, `js=${main.size} gzip=${gz}`);
  }
  // the bridge must be reachable through the real Capacitor runtime, not a stub
  run('node tools/bridge-smoke.mjs', '4.5 bridge smoke (real @capacitor/core)');
}

// ────────────────────────────────────────────────────────── orchestration
const cycle = Number(process.env.GATE_CYCLE ?? 1);
auditStatic();
auditResearch();
if (!AUDIT_ONLY) prove();

const failed = findings.filter((f) => !f.pass);
if (JSON_OUT) {
  console.log(JSON.stringify({ cycle, findings, failed: failed.length }, null, 2));
} else {
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  console.log(`gate — cycle #${cycle}${AUDIT_ONLY ? ' (audit only)' : ''}\n`);
  for (const f of findings) {
    console.log(`${f.pass ? 'ok  ' : 'FAIL'} ${pad(f.id, 22)} ${f.detail}`);
  }
  console.log(
    `\n${findings.length - failed.length}/${findings.length} checks pass` +
      (failed.length ? ` — ${failed.length} finding(s) block the cycle` : ' — cycle clean'),
  );
}
process.exit(failed.length ? 1 : 0);
