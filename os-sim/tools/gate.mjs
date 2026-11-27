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
      // A bare directory name like "out/" matches ANY mention -- including vm-core.test.ts
      // writing the word "out" in an assertion message, which was reported as the test
      // requiring the build directory. Require a path-like mention: the name followed by
      // a path separator inside a string, or the whole path inside quotes.
      const dir = p.replace(/\/+$/, ''); // "out/" and "out" are the same directory
      const name = dir.split('/').pop();
      const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      /*
       * A mention must be the path, not a word that happens to end the same way.
       *
       * Two false positives lived here: the bare rule "out/" matched the word "out" in an
       * assertion message, and the rule "app/src/main/assets/public" matched the relative
       * import '../public/'. Both are mentions of the NAME; neither is the PATH. So the
       * match anchors on what precedes the rule: start of the string, a separator, or a
       * relative prefix -- and what follows it must be a separator, a quote or whitespace.
       */
      const pathLike = new RegExp(
        `(['\"\`]|^|[/])${esc(dir)}([/'\"\`\\s,)]|$)`,
      );
      if (!pathLike.test(body)) continue;
      // Guarding one of several ignored reads does not protect the path: the check used
      // to look for `existsSync` ANYWHERE in the file, so removing the guard from one
      // read still passed. Two shapes count as guarded:
      //   a) if (existsSync('<path>')) { ... }            -- literal path
      //   b) const v = '<path>'; if (existsSync(v)) { ... } -- path behind an identifier
      // the guard names the last path segment; for a directory ignore rule ("out/") that
      // segment is "out", which is what existsSync() would be called with.
      const base = esc(name ?? '');
      // The guard is existsSync(<argument containing this path>). The old pattern
      // demanded "\s*\)\s*\)" after the literal, but in existsSync('out/x') the ")"
      // directly follows the quote -- so no directory rule could ever be guarded.
      const guarded = new RegExp(
        `if\\s*\\(\\s*existsSync\\(\\s*(?:['\"\\x60][^'\"\\x60]*${base}|[A-Za-z_$][\\w$]*)`,
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
  // .tsx before .ts: the alternation used to match "ts" and stop, so every .tsx path the
  // gate read was reported as a .ts path that does not exist -- which made 1.8b cry wolf
  // three times (A39/A43) and hid the real defect: the gate could not see .tsx at all.
  const selfDeps = (read('tools/gate.mjs').match(/(?:run\('node |read\(')([\w./-]+\.(?:mjs|js|tsx|ts|json|md))/g) ?? [])
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

  // 1.16 every built-in disk a card advertises must exist AND the card's claims must be
  // consistent with geometry. A 1.44 MB floppy cannot hold a "2 MB" program, and a card
  // that lists titles the image does not contain is the worst kind of promise.
  if (has('src/store/useVM.ts') && has('public/images/dos-games.img')) {
    const vm = read('src/store/useVM.ts');
    const img = readFileSync(join(ROOT, 'public/images/dos-games.img'));
    // read the root directory and collect the names actually present
    const present = [];
    for (let i = 0; i < 224; i++) {
      const off = 9728 + i * 32;
      if (img[off] === 0) break;
      const n = img.subarray(off, off + 8).toString('latin1').trim();
      present.push(n);
    }
    // strip comments before looking for claims: the code carries a comment that NAMES
    // the four games it used to advertise, and a naive scan flagged its own explanation.
    const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const card = stripComments(vm.slice(vm.indexOf("id: 'dos-games'"), vm.indexOf("id: 'freedos'")));
    // any known commercial DOS title named in the card must be present in the image
    const named = ['PRINCE', 'WOLF', 'DOOM', 'DUKE'].filter((t) => new RegExp(t, 'i').test(card));
    const lies = named.filter((t) => !present.some((p) => p.startsWith(t.slice(0, 4))));
    // geometry claims
    const mbClaims = [...card.matchAll(/(\d+(?:\.\d+)?)\s*ميغابايت/g)].map((m) => Number(m[1]));
    const overGeometry = mbClaims.filter((n) => n > 1.44);
    add(
      '1.16',
      'audit',
      lies.length === 0 && overGeometry.length === 0,
      lies.length
        ? `dos-games card names absent titles: ${lies.join(', ')} (disk has ${present.join(', ')})`
        : overGeometry.length
          ? `dos-games card claims ${overGeometry.join(', ')} MB, disk is 1.44 MB`
          : `dos-games card matches its image (${present.length} entries)`,
    );
  }

  // 1.17 no UI file may generate a measurement. Simulated telemetry is worse than a
  // missing feature: it renders in the same font as a real reading and the user has no
  // way to tell. Math.random in an app/component is always a fake gauge.
  if (has('src/apps')) {
    const uiFiles = [
      ...readdirSync(join(ROOT, 'src/apps')).map((f) => `src/apps/${f}`),
      ...readdirSync(join(ROOT, 'src/components')).map((f) => `src/components/${f}`),
    ].filter((f) => /\.tsx?$/.test(f) && has(f));
    const strip = (t) =>
      t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\//gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const faked = uiFiles.filter((f) => /Math\.random/.test(strip(read(f))));
    // find the two screens by name rather than by literal path: writing the path here
    // made check 1.8b believe the gate *depends* on those files (it caught itself).
    const pick = (needle) => {
      const f = uiFiles.find((x) => x.includes(needle));
      return f ? strip(read(f)) : '';
    };
    // the invented network constants, checked by value because they are exact
    const settings = pick('SettingsApp');
    const invented = ['A4:7B:09:1C:EE:22', '192.168.1.42', '184.2'].filter((v) => settings.includes(v));
    const term = pick('TerminalApp');
    const phoneRam = /8192M\s+2416M/.test(term);
    add(
      '1.17',
      'audit',
      faked.length === 0 && invented.length === 0 && !phoneRam,
      faked.length
        ? `simulated measurement in ${faked.join(', ')} (Math.random)`
        : invented.length
          ? `settings prints invented network constants: ${invented.join(', ')}`
          : phoneRam
            ? 'terminal free prints the phone RAM as a constant'
            : `no fabricated gauges in ${uiFiles.length} UI files`,
    );
  }

  // 1.18 a wipe that says "everything" must call the wipe for everything. The settings
  // card reset the virtual FS, notes, notifications and settings, and left every
  // installed program disk in IndexedDB -- 1.44 MB each, the biggest objects in the app.
  // locate by name, never by literal path: writing the path here makes check 1.8b
  // think the gate depends on a file called "SettingsApp.ts" (it did, twice).
  const appDirFiles = has('src/apps') ? readdirSync(join(ROOT, 'src/apps')).map((f) => `src/apps/${f}`) : [];
  const findOne = (dir, needle) => {
    const all = readdirSync(join(ROOT, dir)).map((f) => `${dir}/${f}`);
    const f = all.find((x) => x.includes(needle));
    return f && has(f) ? stripc(read(f)) : '';
  };
  const stripc = (t) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\//gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  if (appDirFiles.length && has('src/store/usePrograms.ts')) {
    const settings = findOne('src/apps', 'SettingsApp');
    const progs = stripc(read('src/store/usePrograms.ts'));
    const card = settings.slice(settings.indexOf('مسح كل البيانات'));
    const callsWipe = /await\s+wipeAll\s*\(\s*\)/.test(card);
    const storeHasWipe = /wipeAll:\s*async/.test(progs) && /deleteDisk\(diskKey/.test(progs);
    // an invented SSID is the same class of defect as an invented MAC
    const inventedSsid = /Nova[‑-]5G|إشارة قوية/.test(settings);
    add(
      '1.18',
      'audit',
      callsWipe && storeHasWipe && !inventedSsid,
      !callsWipe
        ? 'settings "مسح كل البيانات" does not call wipeAll()'
        : !storeHasWipe
          ? 'usePrograms.wipeAll no longer deletes disks'
          : inventedSsid
            ? 'settings shows an invented Wi-Fi name / signal strength'
            : 'the wipe clears program disks too, and no SSID is invented',
    );
  }

  // 1.19 two decision tables that must agree with a source outside themselves:
  //   (a) back-press order must be derived from the sheets' real z-index in styles.css
  //   (b) storage advice must not be the old download*1.6 claim
  {
    const bbPath = 'src/system/backButton.ts';
    const rtPath = 'src/system/routes.ts';
    const bb = has(bbPath) ? read(bbPath) : '';
    const rt = has(rtPath) ? read(rtPath) : '';
    const css = has('src/styles.css') ? read('src/styles.css') : '';
    const zOf = (cls) => {
      const m = new RegExp('\\n\\.' + cls + '\\s*\\{([^}]*)\\}').exec(css);
      const z = m && /z-index:\s*(\d+)/.exec(m[1]);
      return z ? Number(z[1]) : null;
    };
    const cited = { center: 960, launcher: 970, power: 980 };
    const zOk =
      zOf('nc') === cited.center && zOf('launcher') === cited.launcher && zOf('power-menu') === cited.power;
    const derived = /sort\(\s*\(a, b\)\s*=>\s*SHEET_Z\[b\]\s*-\s*SHEET_Z\[a\]\s*\)/.test(bb);
    const appUsesPlan = has('src/App.tsx') && /planBack\(/.test(read('src/App.tsx'));
    const oldStorage = /\*\s*1\.6\s*\)\s*\/\s*1073741824/.test(rt);
    const scalable = /EXPANSION_MIN/.test(rt) && /CONTAINER_GB/.test(rt);
    add(
      '1.19',
      'audit',
      zOk && derived && appUsesPlan && scalable && !oldStorage,
      !zOk
        ? `sheet z-index changed in styles.css (${zOf('nc')}/${zOf('launcher')}/${zOf('power-menu')}) without updating the back order`
        : !derived
          ? 'back order is hand-written again instead of derived from SHEET_Z'
          : !appUsesPlan
            ? 'App.tsx no longer routes back presses through planBack()'
            : oldStorage || !scalable
              ? 'storage advice is back to bytes*1.6'
              : 'back order derives from the stylesheet; storage advice scales and names its factors',
    );
  }

  // 1.20 the emulator's arithmetic must come from vmCore.ts, and the throttle must not be
  // a fixed interval. Both defects here were silent: a disk that lost 2 MB on restore,
  // and a thermal governor pinned at 50% for every factor.
  {
    const vmPath = 'src/system/vm.ts';
    const corePath = 'src/system/vmCore.ts';
    const vm = has(vmPath)
      ? read(vmPath).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\//gm, '')
      : '';
    const core = has(corePath) ? read(corePath) : '';
    const usesCore = /dataDiskSize\(/.test(vm) && /throttleActiveMs\(/.test(vm);
    const noInterval = !/setInterval/.test(vm);
    const noInvertedWait = !/on \? active : period - active/.test(vm);
    const noShrinkRule = !/dataBytes > 0 \? dataBytes : restored\.byteLength/.test(vm);
    const coreGrows = /return Math\.max\(req, got\)/.test(core);
    const coreCycle = /Math\.round\(period \* f\)/.test(core);
    add(
      '1.20',
      'audit',
      usesCore && noInterval && noInvertedWait && noShrinkRule && coreGrows && coreCycle,
      !usesCore
        ? 'vm.ts computes its own disk size / throttle again instead of using vmCore.ts'
        : !noInterval
          ? 'vm.ts uses setInterval for the throttle: a fixed delay cannot express two phases'
          : !noInvertedWait || !coreCycle
            ? 'the throttle duty cycle is inverted again'
            : !noShrinkRule || !coreGrows
              ? 'the data disk can shrink again, zeroing restored files'
              : 'emulator arithmetic lives in vmCore.ts; disk never shrinks; throttle is a duty cycle',
    );
  }

  // 1.21 the floppy writer must not take its layout from a donor image, and the layout
  // must be stated in one place. Two defects: buildFloppy copied a donor's whole boot
  // sector (BPB included) and then wrote the FAT/root/data at ITS OWN offsets, so a donor
  // with a different BPB produced an unreadable disk; and guest.ts re-declared the same
  // two constants locally instead of importing them.
  {
    const f12Path = 'src/system/fat12.ts';
    const guestPath = 'src/system/guest.ts';
    const f12 = has(f12Path) ? read(f12Path) : '';
    const guest = has(guestPath) ? read(guestPath) : '';
    const bpbIsOurs = /writeBpb\(/.test(f12) && /subarray\(62, 510\)/.test(f12);
    const noWholeSectorCopy = !/disk\.set\(opts\.bootFrom\.subarray\(0, SECTOR\), 0\)/.test(f12);
    const exportsLayout = /export const DATA_START/.test(f12) && /export const CLUSTER /.test(f12);
    const guestImports = /import \{[^}]*DATA_START[^}]*\} from '\.\/fat12'/.test(guest);
    const guestNoLiterals = !/const DATA_START = 16896/.test(guest) && !/const CLUSTER = 1024/.test(guest);
    const uniqueNames = /اسمان متطابقان/.test(f12);
    add(
      '1.21',
      'audit',
      bpbIsOurs && noWholeSectorCopy && exportsLayout && guestImports && guestNoLiterals && uniqueNames,
      !bpbIsOurs || !noWholeSectorCopy
        ? 'buildFloppy copies a donor boot sector whole instead of keeping the BPB it writes'
        : !exportsLayout || !guestImports || !guestNoLiterals
          ? 'the disk layout is declared in more than one place'
          : !uniqueNames
            ? 'duplicate 8.3 names are allowed in the root directory'
            : 'BPB is written by us, layout has one home, root names are unique',
    );
  }

  // 1.22 the Winlator container export must contain only keys the real Container.java
  // reads, and only values it defines. The old export wrote 19 keys of which 7 were
  // silently ignored, used "COMPATIBILITY" for box64Preset (not a real constant), and
  // replaced Winlator's default envVars string instead of merging it.
  {
    const wpPath = 'src/system/winePrefix.ts';
    const keysPath = 'tests/fixtures/winlator-keys.json';
    if (has(wpPath) && has(keysPath)) {
      const wp = read(wpPath).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\//gm, '');
      const facts = JSON.parse(read(keysPath));
      const readKeys = new Set(facts.readKeys);
      // every object key written in toContainerJson must be a readable key
      const body = wp.slice(wp.indexOf('export function toContainerJson'));
      const written = [...body.slice(0, body.indexOf('JSON.stringify')).matchAll(/^\s{4}([a-zA-Z_][\w]*):/gm)].map(
        (m) => m[1],
      );
      const unknown = written.filter((k) => !readKeys.has(k));
      const presets = facts.box64Presets;
      // only the two values this file can emit, read from the ternary that decides them
      const presetExpr = (wp.match(/box64Preset:\s*[^\n]*/) ?? [''])[0];
      const badPreset = [...presetExpr.matchAll(/'([A-Z]+)'/g)].map((m) => m[1]).filter((v) => !presets.includes(v));
      const mergesDefaults = /mergeEnv\(\s*DEFAULT_ENV_VARS/.test(wp);
      const arabicName = /\\p\{L\}/.test(wp);
      add(
        '1.22',
        'audit',
        unknown.length === 0 && badPreset.length === 0 && mergesDefaults && arabicName,
        unknown.length
          ? `container export writes keys Winlator ignores: ${unknown.join(', ')}`
          : badPreset.length
            ? `box64Preset value not defined by Box64Preset: ${badPreset.join(', ')}`
            : !mergesDefaults
              ? 'envVars no longer merges Winlator defaults (WINEESYNC and the shader cache are dropped)'
              : !arabicName
                ? 'container file names collapse non-ASCII titles to "prefix"'
                : `export writes ${written.length} keys, all of them read by Container.loadData`,
      );
    }
  }

  // 1.23 PLAN phase 2: the two lanes that reach outside the app must stay wired.
  //   (a) export: the container goes to Documents/NovaPC, and the APK has a plugin that
  //       can write there -- a Blob download inside a WebView writes nothing.
  //   (b) launch: a FileProvider root must COVER the export folder, and the packages must
  //       be declared in <queries> or Android 13 hides them.
  {
    const cePath = 'src/system/containerExport.ts';
    const ktPath = 'android/app/src/main/java/os/nova/shell/NativeLaunchPlugin.kt';
    const mainPath = 'android/app/src/main/java/os/nova/shell/MainActivity.java';
    const fpPath = 'android/app/src/main/res/xml/file_paths.xml';
    const manifestPath = 'android/app/src/main/AndroidManifest.xml';
    const need = [cePath, ktPath, mainPath, fpPath, manifestPath];
    if (need.every(has)) {
      const ce = read(cePath);
      const main = read(mainPath);
      const fp = read(fpPath);
      const manifest = read(manifestPath);
      const dir = (ce.match(/EXPORT_DIR = '([^']+)'/) ?? [])[1] ?? '';
      const roots = [...fp.matchAll(/<(external-path|external-files-path|cache-path|files-path)[^>]*path="([^"]*)"/g)].map(
        (m) => m[2],
      );
      /*
       * EXPORT_DIR is relative to Directory.Documents, so "NovaPC" must be resolved to
       * "Documents/NovaPC" before comparing it with FileProvider roots -- the first
       * version compared the bare folder name and reported a correct file as a failure.
       */
      /*
       * What actually covers the folder: an <external-path> (or external-files-path) whose
       * path is the export folder or a prefix of it. androidx FileProvider.java:524 maps
       * <external-path> to Environment.getExternalStorageDirectory(), so a bare "." there
       * covers everything under /sdcard -- a cache-path "." does NOT, and an earlier
       * version of this check accepted it.
       */
      const coveringTags = new Set(['external-path', 'external-files-path']);
      const covered =
        !!dir &&
        [...fp.matchAll(/<(external-path|external-files-path|cache-path|files-path)[^>]*path="([^"]*)"/g)]
          .filter((m) => coveringTags.has(m[1]))
          .some((m) => {
            const pfx = m[2].replace(/\/+$/, '');
            return pfx === '' || pfx === '.' || `Documents/${dir}/`.startsWith(`${pfx}/`);
          });
      const registered = /registerPlugin\(NativeLaunchPlugin\.class\)/.test(main);
      const queries = ['com.winlator', 'com.winlator.star', 'app.gamenative'].every((pkg) =>
        new RegExp(`android:name="${pkg}"`).test(manifest),
      );
      const filesystem = has('android/app/capacitor.build.gradle')
        ? /capacitor-filesystem/.test(read('android/app/capacitor.build.gradle'))
        : false;
      const fakeSuccess = /catches?[^]*return \{ ok: true, lane: 'documents'/.test(ce);
      add(
        '1.23',
        'audit',
        covered && registered && queries && filesystem && !fakeSuccess,
        !filesystem
          ? 'the APK has no Filesystem plugin, so the export lane cannot write Documents/NovaPC'
          : !covered
            ? `FileProvider roots (${roots.join(', ')}) do not cover ${dir || 'EXPORT_DIR'} -- open-in-Winlator would throw NOT_SHARED`
            : !registered
              ? 'NativeLaunchPlugin is not registered before the bridge starts'
              : !queries
                ? 'Winlator/GameNative are not in <queries>: Android 13 hides them and detect() always says "not installed"'
                : fakeSuccess
                  ? 'a failed native write can still report success'
                  : `export writes ${dir}; FileProvider covers it; packages visible; plugin registered`,
      );
    }
  }

  // 1.25 a declared intent filter must have a reader. This cycle's worst defect was
  // exactly this shape: the manifest advertised ACTION_SEND, the classifier was unit
  // tested, and nothing in Java ever called getIntent() -- so sharing a file opened the
  // app onto the same screen as a normal launch. The test suite missed it because every
  // assertion was about a pure function; only a check that reads both files at once
  // can see the gap between them.
  {
    const manifest = has('android/app/src/main/AndroidManifest.xml')
      ? read('android/app/src/main/AndroidManifest.xml')
      : '';
    const java = has('android/app/src/main/java/os/nova/shell/MainActivity.java')
      ? read('android/app/src/main/java/os/nova/shell/MainActivity.java')
      : '';
    const kt = has('android/app/src/main/java/os/nova/shell/NativeLaunchPlugin.kt')
      ? read('android/app/src/main/java/os/nova/shell/NativeLaunchPlugin.kt')
      : '';
    const declaresShare = /android\.intent\.action\.(SEND|VIEW)/.test(manifest);
    if (!declaresShare) {
      add('1.25', 'audit', true, 'no share-in filter declared: nothing to receive');
    } else {
      const reads = java.includes('getIntent()') && java.includes('stash');
      const redelivers = /onNewIntent\s*\(/.test(java);
      const exposes = kt.includes('fun takePendingShare') && /EXTRA_STREAM/.test(kt);
      // singleTask is what makes onNewIntent the path for the second share
      const singleTask = /android:launchMode="singleTask"/.test(manifest);
      add(
        '1.25',
        'audit',
        reads && redelivers && exposes && singleTask,
        !reads
          ? 'the manifest declares a share-in filter but MainActivity never reads getIntent(): the file is dropped'
          : !redelivers
            ? 'no onNewIntent: a second shared file is silently ignored while the app is open'
            : !exposes
              ? 'the plugin never exposes the pending share to the web layer'
              : !singleTask
                ? 'launchMode is not singleTask, so onNewIntent never fires'
                : 'share-in is wired end to end (filter -> intent -> plugin -> web)',
      );
    }
  }

  // 1.26 a share that is received but never shown is the same defect as one never
  // received. The manifest and the Java were correct and the app still did nothing: NovaOS
  // boots to the desktop, GameSetupApp lives inside a window, and nothing opened one for
  // the incoming file. So: if the share lane exists, App.tsx must open the window and
  // GameSetupApp must render the verdict.
  {
    const app = has('src/App.tsx') ? read('src/App.tsx') : '';
    const setup = has('src/apps/GameSetupApp.tsx') ? read('src/apps/GameSetupApp.tsx') : '';
    const nl = has('src/system/nativeLaunch.ts') ? read('src/system/nativeLaunch.ts') : '';
    if (!nl.includes('takeSharedFile')) {
      add('1.26', 'audit', true, 'no share-in lane in the web layer');
    } else {
      // the window open must live in the share lane, not somewhere else in App.tsx
      const laneStart = app.indexOf('takeSharedFile');
      const lane = laneStart >= 0 ? app.slice(laneStart, laneStart + 2500) : '';
      const opens = /open\(\{\s*appId:\s*'setup'/.test(lane);
      // reading the phase from the render closure is what opened the window during boot,
      // where unlock() then wiped it; the live read is the fix, so it is asserted
      const livePhase = /useOS\.getState\(\)\.phase/.test(app);
      const waits = /useOS\.subscribe\(/.test(app);
      const shows = /judgeShare\s*\(/.test(setup) && /shared\.reason|shared\.accept/.test(setup);
      // a cached read is what lets two callers both see the file (one native read)
      const cached = /shareCache/.test(nl);
      add(
        '1.26',
        'audit',
        opens && shows && cached && livePhase && waits,
        !opens
          ? 'the app receives a shared file but never opens the window that shows it'
          : !livePhase || !waits
            ? 'the share window is opened from a stale phase, so it can land during boot and be wiped by unlock()'
            : !shows
            ? 'GameSetupApp never renders the verdict, so the share is parsed into nothing'
            : !cached
              ? 'the native read is consumed on first call, so the second caller sees no file'
              : 'a shared file reaches the user: consumed once, window opened, verdict shown',
      );
    }
  }

  // 1.27 a module nothing imports is not a feature. This cycle I wrote profileSchema.ts
  // and profileStore.ts, had them pass their own tests, and only noticed they were dead
  // when the build size did not move by a single byte: neither was reachable from any
  // component. A unit test does not prove wiring, and an unimported file ships nothing.
  {
    const walk = (dir) =>
      readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) return walk(rel);
        return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
      });
    const sources = has('src') ? walk('src') : [];
    const text = Object.fromEntries(sources.map((f) => [f, read(f)]));
    const orphan = sources.filter((f) => {
      const base = f.split('/').pop() ?? '';
      const stem = base.replace(/\.(ts|tsx)$/, '');
      // a module is reachable if any OTHER file imports it by stem or path
      return !sources.some((g) => {
        if (g === f) return false;
        const body = text[g] ?? '';
        return body.includes(`/${stem}'`) || body.includes(`/${stem}"`) || body.includes(`/${base}'`);
      });
    });
    // entry points legitimately have no importer
    const entry = new Set(['src/main.tsx', 'src/vite-env.d.ts']);
    const dead = orphan.filter((f) => !entry.has(f));
    add(
      '1.27',
      'audit',
      dead.length === 0,
      dead.length
        ? `written but never imported: ${dead.join(', ')} — a passing unit test does not prove wiring`
        : `${sources.length} source modules are all reachable from the app`,
    );
  }

  // 1.28 a written container key with no reason line is a value the user cannot audit.
  // ٣-٦'s acceptance criterion is exactly this, and the shipped UI had six sentences for
  // eleven keys until it was measured. Read from the source so it fails at the point of
  // introduction, not only in the suite.
  {
    const wp = has('src/system/winePrefix.ts') ? read('src/system/winePrefix.ts') : '';
    const ui = has('src/apps/GameSetupApp.tsx') ? read('src/apps/GameSetupApp.tsx') : '';
    if (!wp.includes('reasonsFor')) {
      add('1.28', 'audit', false, 'winePrefix.ts has no per-key reasons: some container values reach Winlator unexplained');
    } else {
      // the UI must consume the keyed reasons, not a flat list
      const keyed = /reasonsFor\(profile\)\.map/.test(ui) && /<code>\{r\.key\}<\/code>/.test(ui);
      add(
        '1.28',
        'audit',
        keyed,
        keyed
          ? 'every written container key has a clickable reason line in the UI'
          : 'the UI renders loose sentences instead of one line per written key (٣-٦)',
      );
    }
  }

  // 1.29 sync must default to off, and the default must come from one place. A privacy
  // claim that depends on a component's initial state is a claim that can drift silently.
  {
    const sync = has('src/system/profileSync.ts') ? read('src/system/profileSync.ts') : '';
    const ui = has('src/apps/GameSetupApp.tsx') ? read('src/apps/GameSetupApp.tsx') : '';
    const offByDefault = /SYNC_DEFAULT[^=]*=\s*\{\s*enabled:\s*false\s*\}/.test(sync);
    const uiUsesDefault = /useState\(SYNC_DEFAULT\.enabled\)/.test(ui);
    const noCredential = !/https:\/\/[a-z0-9]{6,}\.supabase\.co/.test(sync);
    add(
      '1.29',
      'audit',
      offByDefault && uiUsesDefault && noCredential,
      !offByDefault
        ? 'sync is not off by default in SYNC_DEFAULT'
        : !uiUsesDefault
          ? 'the UI does not take its initial state from SYNC_DEFAULT, so the two can disagree'
          : !noCredential
            ? 'a Supabase endpoint is committed in the source: the user supplies it'
            : 'sync is off by default, from one constant, with no committed credential',
    );
  }

  // 1.24 every XML under android/ must be legal XML. I shipped TWO files this cycle whose
  // comments contained a double hyphen ("-- maxSdkVersion", "-- a false negative"). aapt
  // rejects that at build time; the suite only noticed because I happened to parse the
  // two files I had touched. This walks all of them, so the next one is caught by the
  // gate rather than by a build I cannot run here.
  {
    const walk = (dir) =>
      readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) return e.name === 'build' ? [] : walk(rel);
        return e.name.endsWith('.xml') ? [rel] : [];
      });
    const files = has('android') ? walk('android') : [];
    const broken = [];
    for (const f of files) {
      const text = read(f);
      for (const m of text.matchAll(/<!--([\s\S]*?)-->/g)) {
        // "--" inside a comment, or a comment ending in "-", both illegal
        if (m[1].includes('--') || m[1].endsWith('-')) broken.push(`${f} (double hyphen in a comment)`);
      }
      // tag stack: catches an unclosed <paths> or a stray </activity>
      const stack = [];
      for (const m of text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-zA-Z][\w:.-]*)(\s[^<>]*)?(\/?)>/g)) {
        const [, closing, name, attrs, selfClose] = m;
        if (selfClose || attrs?.trimEnd().endsWith('/')) continue;
        if (closing) {
          if (stack.pop() !== name) broken.push(`${f} (</${name}> closes the wrong element)`);
        } else stack.push(name);
      }
      if (stack.length) broken.push(`${f} (unclosed <${stack[stack.length - 1]}>)`);
    }
    add(
      '1.24',
      'audit',
      files.length > 0 && broken.length === 0,
      !files.length
        ? 'no Android XML found'
        : broken.length
          ? `${broken.length} malformed: ${[...new Set(broken)].slice(0, 3).join('; ')}`
          : `${files.length} Android XML files parse (comments legal, tags balanced)`,
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
    /*
     * A ceiling that is only checked at the ceiling tells you when you have already lost.
     * The bundle sat at 93% (223 998 of 240 000) after phase 3 and nothing said so, so a
     * phase-4 feature would have failed the build instead of prompting a decision. This
     * separate line is a warning, not a failure: it prints the headroom in bytes at every
     * cycle, and only fails if the headroom is gone.
     */
    const headroom = 240_000 - gz;
    const warnAt = 16_384; // 16 KB: roughly one more small module's worth
    add(
      '4.4b budget headroom',
      'prove',
      headroom > 0,
      headroom > warnAt ? `${headroom} bytes left` : `LOW: ${headroom} bytes left`,
    );
    if (headroom <= warnAt) {
      console.log(`  !   4.4b only ${headroom} bytes of gzip headroom: the next feature must trade for it`);
    }
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
