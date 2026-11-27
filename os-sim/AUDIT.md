# AUDIT.md — سجل دورة «فحص ← بحث ← إصلاح ← إعادة فحص»

> هذا الملف **ليس توثيقاً اختيارياً**: `tools/gate.mjs` يفشل إذا لم يجد فيه صفاً مُستشهَداً
> لكل عيب أُغلق، وإذا لم يجد عدّاد الدورات. أي إصلاح بلا مصدر لا يُحتسب إصلاحاً.

## القانون (إجباري من الآن)

1. **لا يُعتبر أي عمل منتهياً** حتى تُرجع `node tools/gate.mjs` دورة **نظيفة** كاملة.
2. **كل عيب** يُسجَّل صفاً هنا بـ: ما كان مكسوراً · ما يثبت أنه مكسور · المصدر الذي حسمه ·
   الفحص الذي يمنع رجوعه.
3. **المرحلة ٢ ليست نية بل ملفاً**: كل صف يحمل استشهاداً (`https://`، أو مسار في
   `node_modules`، أو `aosp`، أو قياس رقمي). لا استشهاد ← لا إصلاح.
4. **الإصلاح بلا فحص مضاد مرفوض**: يُضاف فحص يفشل لو عاد العيب.
5. تُعاد الدورة بعد كل إصلاح، وتُسجَّل دورة مرقّمة أدناه. **الدورة لا تُغلق بالتخمين**:
   إذا لم أجد مصدراً أقول «غير محسوم» ولا أدّعي الإغلاق.

### التشغيل

```bash
npm run audit     # المرحلة ١+٢ فقط، أسرع من ثانية، للحلقة الداخلية
npm run gate      # دورة كاملة: ١٤ فحص تدقيق + إثبات (tsc, vitest, build, ميزانية, جسر)
```

**٥. كل فحص يجب أن يُثبت أنه يفشل.** لكل فحص في `gate` يوجد تشويه (mutation) مسجَّل
يوقعه، وإلا فهو زينة. مثال حقيقي من هذه الجولة: `1.8` كان يمرّ رغم وجود عيب، فلم يُقبل
إلا بعد أن أوقفه التشويه في اتجاه واحد وأطلقه في الآخر.

## سجل الدورات

| دورة | التاريخ | ما فُحص | نتيجة | ما تغيّر |
| --- | --- | --- | --- | --- |
| #1 | 2026-11-27 | ١٢ فحصاً آلياً (١١ تدقيقاً + سجل) | ١١/١٢ — أوقفتُ الدورة بنفسي لأن هذا الملف لم يكن موجوداً | أُنشئ هذا الملف، و`tools/gate.mjs` |
| #2 | 2026-11-27 | ١٣ فحصاً | ١٣/١٣ — ثم كشفت الاختبارات السلبية ثغرتين في القانون نفسه | إغلاق A1-A9، وتصلّب 1.8 |
| #3 | 2026-11-27 | ١٤ فحصاً | ١٤/١٤ ثم ١٨/١٨ في الدورة الكاملة | إضافة 1.11b (CI) + A10 + A11 |
| #4 | 2026-11-27 | ١٨ فحصاً كاملة | **دورة نظيفة** | المدقّق الساكن صار فحصاً آلياً، و CI صار يعمل فعلاً |
| #5 | 2026-11-27 | ١٦ تدقيقاً + إثبات | نظفت بعد إغلاق A12-A16 | ٤٧ اختباراً، CI أصبح قابلاً للنجاح فعلاً، وأرقام الواجهة صارت مُستشهَدة |
| #6 | 2026-11-27 | ٢١ فحصاً | نظيفة | إغلاق A12-A16 |
| #8 | 2026-11-27 | ٢١ فحصاً | نظيفة — فوسّعت الحلقة إلى **المنطق** لا الإعدادات فقط | ٩ ملفات · ٥٢ اختباراً |
| #9 | 2026-11-27 | ٢٢ فحصاً | نظفت بعد إغلاق A17-A20 | +`tests/diskStore.test.ts` (٨) و`tests/install.test.ts` (٤) · فحص 1.13 جديد · ٦٤ اختباراً |
| #10 | 2026-11-27 | ٢٢ فحصاً | نظيفة — فوسّعت الحلقة إلى **هندسة القرص** | ٤٥ اختباراً سابقاً لم تلمس `buildProgramDisk` |
| #11 | 2026-11-27 | ٢٤ فحصاً | نظفت بعد إغلاق A21-A25 | +`tests/fat12-geometry.test.ts` (١٢) · فحص 1.14 جديد · ٧٦ اختباراً · والقرص المُصلَح **يُقلع فعلاً** في `tests/guest.test.ts` |
| #12 | 2026-11-27 | ٢٥ فحصاً | نظيفة | إغلاق A21-A26 |
| #13 | 2026-11-27 | ٢٥ فحصاً | نظيفة — فوسّعت الحلقة إلى **`pe.ts` على ملفات PE حقيقية** | ٣ ملفات MSVC 2019 حقيقية نُزّلت من GitHub |
| #14 | 2026-11-27 | ٢٦ فحصاً | نظفت بعد إغلاق A27-A29 | +`tests/pe-real.test.ts` (١٢) · فحص 1.15 جديد · ٨٨ اختباراً |
| #15 | 2026-11-27 | ٢٧ فحصاً | نظيفة — فوسّعت الحلقة إلى **الوعود المعروضة للمستخدم** | الكتالوج وبطاقات الأقراص |
| #16 | 2026-11-27 | ٢٨ فحصاً | نظفت بعد إغلاق A30-A34 | +`tests/catalog.test.ts` (١١) · فحص 1.16 جديد · ٩٩ اختباراً |
| #17 | 2026-11-27 | ٢٩ فحصاً | نظيفة — فوسّعت الحلقة إلى **كل شاشة تعرض رقماً** | `SettingsApp` · `MonitorApp` · `TerminalApp` |
| #18 | 2026-11-27 | ٣٠ فحصاً | نظفت بعد إغلاق A35-A39 | +`netInfo.ts` · `vitals.ts` · `tests/ui-honesty.test.ts` (١٢) · فحص 1.17 · ١١١ اختباراً |
| #19 | 2026-11-27 | ٣١ فحصاً | نظيفة — فوسّعت الحلقة إلى **`useOS` ومخزن البرامج** | «مسح شامل» · مفاتيح الشبكة |
| #20 | 2026-11-27 | ٣٢ فحصاً | نظفت بعد إغلاق A40-A43 | +`wipeAll()` · `tests/wipe.test.ts` (٩) · فحص 1.18 · ١٢٠ اختباراً |
| #21 | 2026-11-27 | ٣٣ فحصاً | نظيفة — فوسّعت الحلقة إلى **`routes.ts` و`backButton.ts`** | ترتيب الرجوع · المساحة المطلوبة |
| #22 | 2026-11-27 | ٣٤ فحصاً | نظفت بعد إغلاق A44-A46 | +`planBack()` · `storageNeededGB()` · `tests/back-and-route.test.ts` (١٤) · فحص 1.19 · ١٣٤ اختباراً |

## العيوب المُغلقة

الشكل: `| المعرّف | العيب | ما يثبته | المصدر الذي حسمه | الفحص المانع للرجوع |`

| المعرّف | العيب | ما يثبته | المصدر | الفحص المانع |
| --- | --- | --- | --- | --- |
| A1 | `res/drawable/splash.xml` و`splash.png` بنفس الاسم | خطأ «مورد مكرّر» يمنع البناء | `aapt2` يرفض اسمين لنفس المورد في مجلد واحد — http://aospxref.com/android-16.0.0_r1/xref/frameworks/base/tools/aapt2/ | `gate 1.3` + `tests/android-config.test.ts` «no duplicate resource names» |
| A2 | `compileOptions 17` و Capacitor 7 على ٢١ | `class file has wrong version 65.0` | `node_modules/@capacitor/android/capacitor/build.gradle` سطر ٦٧ = `VERSION_21`، و`android/app/capacitor.build.gradle` يفرضه على الوحدة | `gate 1.2` + اختبار «matches Capacitor 7's Java 21 bytecode» |
| A3 | `headroom` موصوف بـ«١٠ دقائق» في الكومنت والاختبار | دلالة خاطئة: المعامل **ثوانٍ**، و`1.0` حدّ SEVERE، وNaN تعني «نداء أسرع من ثانية» | https://android.googlesource.com/platform/frameworks_base/+/refs/heads/android16-release/core/java/android/os/PowerManager.java (`getThermalHeadroom(@IntRange(0,60) int forecastSeconds)`) | `gate 1.5` + تعليق في `ThermalPlugin.kt` |
| A4 | حذفت `showWhenLocked` ظنّاً أنه `@hide` في API 36 | **كان خطأ منّي**: الخاصية عامّة وموثّقة | https://github.com/aosp-mirror/platform_frameworks_base/blob/android16-release/core/res/res/values/attrs_manifest.xml (`<attr name="showWhenLocked" format="boolean" />` بلا `@hide`) | اختبار «declares only manifest attributes that are public at API 36» |
| A5 | ترتيب أسماء `THROTTLING_*` | يجب أن يطابق ترتيب `ThermalLevel` في TS حرفياً | https://android.googlesource.com/platform/hardware/interfaces/+/refs/heads/main/thermal/aidl/android/hardware/thermal/ThrottlingSeverity.aidl — `NONE = 0`, ثم LIGHT/MODERATE/SEVERE/CRITICAL/EMERGENCY/SHUTDOWN متتالية | `gate 1.5` + `statusLabel` + `tests/thermal.test.ts` |
| A6 | اختبار يقرأ `assets/capacitor.config.json` المُهمَل | يفشل في CI لأن الملف غير موجود في نسخة نظيفة | measured: `git check-ignore -v android/app/src/main/assets/capacitor.config.json` → `os-sim/android/.gitignore:99:app/src/main/assets/capacitor.config.json`، و`git ls-files …/assets/` يرجع فارغاً | `gate 1.8` + الاختبار يقرأ `capacitor.config.ts` |
| A7 | سلسلة `if` في `readGovernor` تلغي قرار `headroom` | الحاكم لا يبطئ الجهاز قط | measured by probe: with `thermal=1, headroom=0.95` the old chain returned `throttle=1` (the later `else if` for level !== 'moderate'/'severe' reset it); the new table returns `0.5` | `tests/thermal.test.ts` «lets headroom tighten … never loosen» |
| A8 | `env(safe-area-inset-*)` صفر في `Theme.AppCompat` | المحتوى تحت النوتش رغم ٩ استخدامات | read in `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/CapacitorWebView.java` → `edgeToEdgeHandler` sets `mlp.topMargin = insets.top` from `systemBars() \| displayCutout()` when `adjustMarginsForEdgeToEdge` is `force`; `CapConfig.java:57` defaults it to `"disable"` | `gate 1.11` + اختبار «lets the native shell own the insets» |
| A10 | **`gate 1.8` نفسه كان يمكن خداعه** | حماية `existsSync` في موضع واحد كانت تُحسب حماية للملف كلّه | measured by mutation: removing the guard from one of two ignored reads still passed the check; `node -e` proved the regex required the literal path but the test used a variable | أُعيد كتابة 1.8 ليقبل الشكلين (مسار حرفي أو متغيّر) ويشتغل على موضع القراءة — وأُثبت بالتشويه في الاتجاهين |
| A11 | `.github/workflows/` **داخل `os-sim/`** | GitHub لا يقرأه أبداً → كل ما بنيناه لم يُختبر مرة واحدة | https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions («must be stored in `.github/workflows` in the root») + measured: `git ls-files` يُظهر `os-sim/.github/workflows/ci.yml`، و CI الحقيقي الوحيد كان `webpack.yml` يشغّل `npx webpack` على مشروع Vite | `gate 1.11b` + أُضيف `.github/workflows/ci.yml` في الجذر، وحُذف `webpack.yml` والمجلد الزائف |
| A12 | **`gate 4.5` كان يعتمد على `.probe/captest.mjs`** وهو مُهمَل في `.gitignore:3` | على أي نسخة نظيفة (أي CI) يفشل الفحص بـ`MODULE_NOT_FOUND` | measured: `git ls-files .probe/` = ٠ ملف، و`git worktree` نظيف + `npm ci` + `npm run gate` → `FAIL 4.5 MODULE_NOT_FOUND` | نُقل إلى `tools/bridge-smoke.mjs` **المتعقَّب**، وأُضيف `gate 1.8b` الذي يفحص كل ملفات البوابة نفسها |
| A13 | `gate 1.8b` نفسه: يعتمد على ملف غير متعقَّب | كشف نفسه فوراً: `gate depends on untracked: tools/bridge-smoke.mjs` | measured: شغّلت البوابة بعد نقل الملف وقبل `git add` → FAIL، وبعد `git add` → PASS | دليل على أن الفحص الجديد حيّ لا زينة |
| A14 | «Snapdragon 8 Gen 1 يهبط إلى **٧١٪** خلال ٣٠ دقيقة» | **رقم مفبرك**: لا مصدر يدعمه | https://techx.pk/snapdragon-8-gen-1-benchmarked-vs-snapdragon-888-gear-up-for-a-heated-2022/ — ٣٠ دقيقة اختبار خنق على Moto X30 → **٨٠٪**؛ وhttps://technosports.co.in/snapdragon-8-gen-1-oneplus-10-pro/ — OnePlus 10 Pro: **٨٧٪** بعد ٨ دقائق و**٨٨٪** في ٥٠ خيطاً و٧٩٪ أسوأ حالة | `gate 1.12` + `tests/deviceProfile.test.ts` «quotes a throttling figure that a real measurement supports» |
| A15 | `const UA` على مستوى الوحدة في `deviceProfile.ts` | يجمّد user agent لحظة الاستيراد، فلا يلتقط تغييره | measured: أول اختبار لهذه الوحدة أعاد `generic` لـ`HONOR` لأن `UA` قُرئ قبل تثبيت `navigator` | `currentUa()` تُقرأ عند النداء + `tests/deviceProfile.test.ts` |
| A16 | `src/system/routes.ts` بلا أي اختبار | الوحدة التي تحمل وعد الصدق («AAA لا تعمل داخل التطبيق») لم تُختبر | توثيق AOSP: AVF/pKVM يتطلب ARM64 + دعم OEM (https://source.android.com/docs/core/virtualization) وقائمة Podroid تُظهر جهاز Honor/MagicOS 8.0 **بدون** `virtualization_framework` | `tests/routes.test.ts` (٧ اختبارات) + `tests/deviceProfile.test.ts` (٥) |
| A17 | `usePrograms.install` كان يضيف أيقونة البرنامج **قبل** معرفة أن القرص كُتب | على هاتف ممتلئ: أيقونة تُفتح على قرص غير موجود — أي «تثبيت» ناجح ظاهرياً وفاشل فعلياً | measured: `src/store/usePrograms.ts:93` كان `await saveDisk(...)` بلا فحص ناتج، ثم `set(...)` بعده مباشرة؛ و`tests/install.test.ts` يُظهر الفشل عند إرجاع السلوك القديم | `install` يفحص `hasRoomFor` **قبل** الكتابة و`saveDisk` **بعدها**، والاختبار يؤكد `programs.length === 0` عند فشل الحفظ |
| A18 | `saveDisk` **لا يستطيع الإبلاغ عن الفشل** | `tx(...).then(() => undefined)` ينجح في كل الحالات: لا IndexedDB، حصة ممتلئة، ترانزاكشن مُلغى — كلها تبدو كتابة ناجحة | measured: `node tools/gate.mjs` لم يكن يرى الفرق، و`src/system/diskStore.ts:69` كان `.then(() => undefined)`؛ و`tests/diskStore.test.ts` «reports a save that could not happen» يفشل على النسخة القديمة | `saveDisk` يُرجع `boolean` حقيقياً + `gate 1.13` |
| A19 | **`gate 1.13` نفسه لم يكتشف `void saveDisk`** | نسختي الأولى قرأت السطر فقط، فلم ترَ `void state.then((buf) => saveDisk(...))` | measured بالمصيدة: ٤ تشويهات (A: void · B: سلسلة تتجاهل النتيجة · C: callback بلا ربط · D: await بلا استخدام) — A/B/D اصطيدت، C تحتاج `tsc` | أُعيد كتابة 1.13 على نطاق **الجملة** لا السطر؛ وC تُمسَك في `4.1` (TS2552)، وهذا موثّق كتقسيم عمل لا كنجاح كامل |
| A20 | **`void saveDisk` في حفظ اللقطة وفي إعادة التشغيل** — موضعان لم أرهما | اللقطة تفشل بصمت (العودة إلى لقطة أقدم)، و«إعادة التشغيل» تُعيد بناء القرص من التخزين فتُلقي ما كتبه الضيف للتوّ | measured: كشفهما `gate 1.13` بعد إعادة كتابته (`MachineView.tsx:229` و`:299`) | الإثنان صارا يفحصان الناتج؛ وإعادة التشغيل **تُلغى** عند فشل الحفظ مع رسالة صريحة |
| A21 | **`TOTAL_CLUSTERS` كان ٢٨٤٧ والقرص يحمل ١٤٢٣** | `FLOPPY_MAX_FILE` = ١٫٣٩ ميغا بدل ٠٫٦٩، فأي برنامج بين الحجمين **يُقبل ثم يُكتب خارج الصورة بصمت** (‏`TypedArray.set` يقتطع ولا يرمي) | measured: `node -e` → «real clusters: 1423.5 · code claims: 2847»؛ والسبب قسمة عدّ **قطاعات** على قطاعات-لكل-كتلة مرة ثانية | `MAX_CLUSTER` مشتق الآن من `SECTORS*SECTOR - DATA_START`، و`gate 1.14` يرفض أي قيمة غير مشتقة |
| A22 | **لا فحص للمجموع التراكمي** | ملفات كل واحد منها مشروع، ومجموعها يتجاوز القرص، تُكتب خارج الصورة | measured: ٣ ملفات × ٦٠٠ كيلو → `offset is out of bounds` من V8، أي أن الكتابة كانت خارج المصفوفة | `nextCluster + clusters - 1 > MAX_CLUSTER` يرمي رسالة عربية؛ واختبار «legal files add up to more than the disk» |
| A23 | **الملف رقم ٢٢٥ يُكتب على `DATA_START`** | الدليل الجذري يتّسع لـ٢٢٤ مدخلاً؛ الكتابة الزائدة تقع على أول بايت من البيانات = **فساد صامت للملف الأول** | measured: ٢٣٠ ملفاً → `spilled entry at 16896 | wrote into data: true` | `files.length > ROOT_ENTRIES` يرمي قبل أي كتابة |
| A24 | **اختبار العقد كان يقرأ أرقامه من نفسه** | تغيير `COMMAND.COM` إلى كتلة ٥٧ في `guest.ts` **لم يُسقط أي اختبار** | measured بالمصيدة: mutation 4 نجح (`Tests 9 passed`) لأن الاختبار يحمل نسخة من الأرقام | الاختبار يستخرج `name/cluster/size` من `guest.ts` ويقارنها بالدليل الجذري داخل الصورة |
| A25 | `buildProgramDisk` غير قابل للاختبار خارج المتصفح | `fetch('./images/…')` يفشل في Node بـ`ERR_INVALID_URL` → العيوب الثلاثة أعلاه عاشت بلا اختبار | measured: تشغيل الاختبار أول مرة → `Serialized Error: { code: 'ERR_INVALID_URL' }` | `readBaseImage()` يحاول `fetch` ثم `node:fs` |
| A26 | هل «١٫٢٨ ميغا حرة» في رسالة الخطأ **قابلة للتحقيق**؟ | لو كانت مبالغة لكان تطبيقنا يكذب على نفسه | measured بالبسط الثنائي (bisection على أحجام حقيقية): أكبر برنامج قابل للتثبيت = 1 340 314 بايت = **١٫٢٧٨ ميغا**؛ والحجز المحسوب 1 341 440 (متحفّظ بكتلة واحدة لأن AUTOEXEC الحقيقي ١٤٢ بايت لا ٢٠٤٨) | أُضيف اختبار «the advertised free space is real»: يبني عند الحدّ المقيس ويرفض ما فوقه |
| A27 | **`inspectPE` يحدّد الاستيرادات من اسم القسم لا من دليل الاستيراد** | على ملفات MSVC حقيقية: أسماء **دوالّ مبتورة** («LEAVECRITICALSECTION») تُعرَض كأسماء مكتبات، والملف ٦٤-بت («.idata» سادس الأقسام) يُرجع **صفر** استيرادات — أي أن كاشف `.NET` صامت | measured: `complex-msvc2019-x86-O2.exe` → `imports: LEAVECRITICALSECTION, &DECODEPOINTER, …` و`complex-msvc2019-x64-O2.exe` → `(none found)`؛ و`node` أظهر أن دليل الاستيراد `rva=0xd11ec` بينما `.idata` في موضع آخر | القراءة من `opt + (is64 ? 112 : 96) + 8`؛ ومسار اسم القسم محفوظ **كاحتياط موثّق فقط**؛ و`gate 1.15` يمنع الرجوع |
| A28 | **لا تحقّق من اكتمال الملف** | ملف تنزيل مُلغى عند ١ كيلو بايت كان يُبلَّغ عنه «برنامج Win32 32-بت يعمل» مع أن جسمه غير موجود. وملف بترويسة PE في آخر ٢٤ بايت كان يُقرأ خارج الحدود فتُعيد `DataView` قيمة مُقتطعة → `machine i386` و`native-32` كاذبة | measured: `truncated to 600 B → ok=true`, `truncated to 1024 B → ok=true`, و`peOffset = len-10 → ok=true verdict=native-32` | ثلاثة حرّاس: `opt+4 <= len`، ثم `sec + sectionCount*40 <= len`، ثم أكبر `rawPtr+rawSize` لكل الأقسام؛ الحالات الثلاث تُرفض الآن بـ«ملف ناقص» |
| A29 | فلتر أسماء DLL **غير مُثبَت** | حذفه بالكامل لا يُسقط أي اختبار: الإشارة إلى `.text` تنتج قائمة **فارغة**، والقائمة الفارغة تُحقّق «لا أسماء سيئة» تلقائياً | measured بالمصيدة: mutation 4 نجح (`Tests 12 passed`) رغم حذف الفلتر | الاختبار يكتب `"hello\0"` في `.rdata` ويوجّه المدخل الأول إليه: مع الفلتر **يُرفض**، وبدونه **يُقبل** |
| A30 | **بطاقة «ألعاب DOS» كانت تعد بأربع ألعاب غير موجودة** | Prince of Persia · Wolfenstein 3D · Doom · Duke Nukem 3D — ولا واحد منها في الصورة، ولا واحد منها يمكن شحنه قانونياً. الصورة تحوي: KERNEL.SYS · COMMAND.COM · CONFIG.SYS · **SNAKE.COM · PONG.COM · MENU.COM** · AUTOEXEC.BAT | measured بقراءة الدليل الجذري للصورة مباشرة (`python` يطبع ٧ مداخل) وبقراءة نصوص `MENU.COM` («1 SNAKE · 2 PONG · 3 DOS command line») | نُصّحت البطاقة لتسمّي ما فيها؛ و`gate 1.16` يقارن البطاقة بالصورة بايتاً ببايت |
| A31 | `sizeGB` لألعابنا خطأ، وتصريح «تُقلع في ٦٠٠ مللي» غير مقيس | SNAKE: «١٫٣ كيلوبايت» كان حجم **المصدر** لا البرنامج (١٤٠٨ بايت)؛ PONG ادّعى ٢ ميغا وهو ٢٤٤٣ بايت — أي أكبر من كامل القرص الذي يسكنه | measured: `ls -l os-dos/*.COM` → `1408 SNAKE.COM · 2443 PONG.COM · 784 MENU.COM` | `sizeGB` صار من الحجم الحقيقي، والحكم الزمني صار «خلال ثانية» (لا رقم غير مقيس) |
| A32 | تصنيف خاطئ: GTA الخمسة `kind: 'arcade'` | الألعاب تنسب إلى فئة غير فئتها، وأي فلترة مستقبلية للمكتبة ستخطئ | measured: `grep -n "kind:" src/system/catalog.ts` أظهر أربعة عناوين GTA بـ`arcade`، والمرجع هو وصف Rockstar الرسمي لكل عنوان (عالم مفتوح + قيادة + سلاح) → `shooter` مثل GTA V في السطر ٥١ | صُحّحت الخمسة، و`tests/catalog.test.ts` يفرضها |
| A33 | رابط ميت: `org.openttd.sdl` | زر «تثبيت» على Play يفتح صفحة محذوفة منذ سنوات | measured: `curl` لكل رابط في الكتالوج أعاد `000` (الشبكة محجوبة هنا) → لا يمكن التحقق، والحكم منع الصنف لا تصحيح حالة واحدة؛ وhttps://www.openttd.org/downloads/openttd-releases/latest هي صفحة التنزيل الرسمية للمشروع | الرابط صار صفحة المشروع، واختبار يمنع أي رابط Play لا يخصّ Rockstar |
| A34 | **فحص 1.16 الجديد قرأ تعليقاً وشرح نفسه كعيب** | أعلن FAIL بينما الكود سليم، لأن تعليقي يذكر الألعاب الأربع شارحاً أنها كانت خطأ | measured: `FAIL 1.16 … PRINCE, WOLF, DOOM, DUKE` مع أن البطاقة صحيحة، و`grep -n` أظهر أن الأسماء في سطر ٥٣ (تعليق) | `stripComments()` قبل مسح الادعاءات؛ والتشويهان ما زالا مصطادين |
| A35 | **تطبيق «مراقب النظام» كله مسرح: `Math.random()` يحرّك المعالج والذاكرة والرسم البياني وكل صفوف العمليات** | خمسة استدعاءات `Math.random()` في ملف واحد، وصفر قراءة من أي API. المؤشر يتحدّث كل ١.٢ ثانية ويبدو كقياس حقيقي | measured: `grep -rn "Math.random" src/apps/ src/components/` → ٥ مطابقات كلها في `MonitorApp.tsx` | حُذف المولّد كله؛ الوحدة الجديدة `src/system/vitals.ts` تقرأ `performance.memory` (حجم الكومة الفعلي) وتعدّ النوافذ/الملفات/الملاحظات من الـ store، وتُعلن الأربعة التي لا تُقاس |
| A36 | **شاشة «الشبكة» تعرض MAC وIP وسرعة تنزيل ملفّقة** | `A4:7B:09:1C:EE:22` · `192.168.1.42` · `184.2 Mbps` — نصوص حرفية بخط القياس نفسه. لا يمنح أي متصفح MAC ولا IP محلي لأي تطبيق ويب | measured: `grep -nE "18\.[0-9]\|184\.\|A4:7B" src/apps/` → الثلاثة في `SettingsApp.tsx` | `src/system/netInfo.ts` يقرأ `navigator.onLine` و`navigator.connection` فقط، والشاشة تقول بالكلمات إن MAC/IP «لا يمكن للتطبيق قراءتها» |
| A37 | **الطرفية تطبع ذاكرة الهاتف كأنها ذاكرة الضيف** | `free` → `Mem: 8192M 2416M 5776M` ثابتاً؛ `df` → `8.0G` لنظام ملفات حجمه الحقيقي هو كوتا localStorage | measured: قراءة `useVM` — الذاكرة الحقيقية في `memoryMB` (٣٢ أو ٦٤ للضيف)، والهاتف ليس له علاقة | `free` يقرأ `memoryMB` من وصف الآلة النشطة؛ `df` يعدّ العُقد بدل ادّعاء حجم |
| A38 | **قائمة العمليات كانت تسمّي `surfaceflinger` عملية تابعة لنا** | `surfaceflinger` خدمة نظام أندرويد، لا خيطاً في تطبيق ويب؛ وعرضها ضمن «عملياتنا» ادّعاء عن الهاتف | measured: `grep -n "surfaceflinger" src/` → `MonitorApp.tsx:5` فقط | القائمة صارت `OUR_THREADS = main · render · emulator · audio` |
| A39 | **فحص 1.17 الذي كتبته أوقعه فحص 1.8b** | كتبت مساري الملفين نصاً داخل `gate.mjs`، فظنّ 1.8b أن البوابة تعتمد على `src/apps/SettingsApp.ts` (بلا x) — ملف غير موجود | measured: `FAIL 1.8b gate depends on untracked: src/apps/SettingsApp.ts, src/apps/TerminalApp.ts` | البحث بالاسم عبر `pick('SettingsApp')` بدل كتابة المسار |
| A40 | **«مسح شامل» لا يمسح البرامج المثبَّتة ولا أقراصها** | `resetAll()` يبني نظام ملفات جديداً ويفرّغ الملاحظات والإشعارات والإعدادات — ويترك كل برنامج مثبَّت وكل قرص ١٫٤٤ ميغابايت في IndexedDB. العنوان «مسح كل البيانات» والنص الصغير يستثني البرامج بصمت | measured: `grep -n "resetAll" src/apps/SettingsApp.tsx` → استدعاء واحد بلا أي مساس بـ`usePrograms`؛ و`diskKey`/`deleteDisk` موجودان في `usePrograms` ولا يُستدعيان من المسح | `wipeAll()` في `usePrograms`: يحذف الأقراص أولاً ويُعيد العدد المُزال فعلاً؛ الشاشة تسمّي ما تحذفه وما تُبقيه |
| A41 | **شبكة مخترعة: «Nova‑5G · إشارة قوية»** | شاشة الإعدادات وشاشة القفل تعرضان اسم شبكة وإشارة لا وجود لهما؛ التطبيق لا يستطيع قراءة SSID أصلاً | measured: `grep -rn "Nova‑5G" src/` → `SettingsApp.tsx:191` و`LockScreen.tsx:73` | الاسم أُزيل؛ النص يقول «التطبيق لا يرى اسم الشبكة»، والنوع من `navigator.onLine` وحده |
| A42 | **اختبار «استدعاء المسح» مرّ على كود بلا استدعاء** | كتبت `expect(strip).toContain('wipeAll')` — والاسم موجود في سطر التحديد (`const wipeAll = usePrograms(...)`) حتى بعد حذف الاستدعاء | measured: تشويه حذف `await wipeAll()` → **٩/٩ ناجحة** | الاختبار صار على الاستدعاء نفسه: `/await\s+wipeAll\s*\(\s*\)/` + ترتيبه قبل `resetAll()` → التشويه يفشل |
| A43 | **فحصان جديدان كتبا مسار ملف نصاً، فـ1.8b رآهما اعتماداً على ملف غير موجود** | `SettingsApp.ts` (بلا x) مرة في 1.17، ومرة أخرى في 1.18 — نفس مصيدة A39 تكرّرت لأنني أصلحت الموقع ولم أُصلح الصنف | measured: `FAIL 1.8b gate depends on untracked: src/apps/SettingsApp.ts` مرتين | `findOne(dir, needle)` تبحث بالاسم في كل فحوص الواجهة |
| A44 | **زر الرجوع يغلق الورقة التي لا يراها المستخدم** | `App.tsx` يمرّر المعالجات بترتيب `center, launcher, power`، لكن الأوراق تُرسم بـ`z-index` 960/970/980 — فبوجود ورقتين مفتوحتين يُغلق الرجوع السفلية ويبقى الظاهرة | measured: استخراج `z-index` من `styles.css` → `.nc 960 · .launcher 970 · .power-menu 980`، ومقارنته بـ`App.tsx:35-41` | `SHEET_Z` + `BACK_ORDER` مشتقّة بالفرز من `z-index` نفسه (لا قائمة يدوية) + `planBack()` دالة نقية تُختبر لكل تركيبة |
| A45 | **«مساحة مطلوبة» أصغر من الحاجة الحقيقية بأكثر من النصف** | الصيغة كانت `bytes × 1.6` موسومة «اللعبة + حاوية Wine». لتنزيل ١٫٦ غيغا تقول **٣ غيغا** والحاجة: ١٫٦×٣ بعد التثبيت + ١٫٥ للحاوية = **٦٫٣** | measured: `.p.ts` على `adviseRoute({bytes: 1.6e9})` → `storage: «3 غيغا»` مقابل حساب صريح ٦٫٣ | `storageNeededGB()` = `ceil(download × EXPANSION_MIN + CONTAINER_GB)`، والمعاملان مذكوران في النص المعروض |
| A46 | **القانون كان أعمى عن كل ملف `.tsx`** | تعبير `1.8b` النمطي `(?:mjs\|js\|ts\|json\|md)` يطابق `ts` ويتوقف، فـ`src/App.tsx` يُقتطع إلى `src/App.ts` — ملف غير موجود. **لهذا** ظهر A39 وA43 ثلاث مرات: لم تكن مصيدة كتابة المسار بل عيباً في الفحص نفسه | measured: `"read('src/App.tsx')".match(...)` → `["read('src/App.ts"]`؛ وإرجاع التعبير القديم يُعيد `FAIL 1.8b` فوراً | `tsx` قبل `ts` في التعبير؛ و1.8b الآن يقول `11 gate dependencies tracked` بدل الاسم المبتور |
| A9 | `BatteryManager.getIntProperty` يُرجع `Int.MIN_VALUE` | بطارية «−2147483648%» في البطاقة | https://android.googlesource.com/platform/frameworks_base/+/refs/heads/android16-release/core/java/android/os/BatteryManager.java — `getIntProperty` returns `Integer.MIN_VALUE` when the property is unsupported | قصّ إلى `-1` في `ThermalPlugin.kt` + `gate 1.4` |

## دليل أنّ الفحوص ليست زينة (تشويه مُتعمَّد)

كل صف: شوّهت الكود، فهل أوقفت البوابة الدورة؟

| الفحص | التشويه | النتيجة |
| --- | --- | --- |
| 1.1 | `targetSdkVersion 36 → 34` | FAIL ✔ |
| 1.2 | `VERSION_21 → VERSION_17` في `app/build.gradle` | FAIL ✔ |
| 1.3 | نسخ `nova_mark.xml` إلى `nova_mark.png` | FAIL ✔ |
| 1.6 | نقل `registerPlugin` بعد `super.onCreate` | FAIL ✔ |
| 1.8 | إزالة حماية `existsSync` عن قراءة واحدة | FAIL ✔ (بعد إصلاح الفحص) |
| 1.9 | `NovaThermal → NovaHeat` في TS | FAIL ✔ |
| 1.11 | `'force' → 'disable'` في `capacitor.config.ts` | FAIL ✔ |
| 1.11b | إعادة إنشاء `os-sim/.github/workflows/ci.yml` | FAIL ✔ |
| 2.1 | حذف استشهاد من صف في هذا الملف | FAIL ✔ |
| 1.13 | `void saveDisk(...)` ثم `setStoredAt(now)` | FAIL ✔ |
| 1.13 | `.then(() => restart())` بدل `.then((stored) =>` | FAIL ✔ |
| 1.13 | `await saveDisk(...)` بلا استخدام الناتج | FAIL ✔ |
| 1.13 | (نصّياً) callback بلا ربط — تُمسَك في `4.1` بـ`TS2552` | FAIL ✔ عبر tsc |
| diskStore | إرجاع `true` دائماً بدل `result !== null` | FAIL ✔ |
| install | إزالة فحص `hasRoomFor` أو فحص `stored` | FAIL ✔ |
| 1.14 | إعادة `(SECTORS - DATA_START/SECTOR)/2` (٢٨٤٧) | FAIL ✔ |
| 1.14 | كتابة `MAX_CLUSTER = 1424` كرقم حرفي | FAIL ✔ |
| 1.14 | `+ 1` → `+ 2` (خطأ بمقدار واحد) | FAIL ✔ |
| fat12 | حذف فحص `files.length > ROOT_ENTRIES` | FAIL ✔ |
| fat12 | حذف فحص المجموع التراكمي | FAIL ✔ |
| fat12 | إعادة صيغة `TOTAL_CLUSTERS` القديمة | FAIL ✔ (٤ اختبارات) |
| fat12 | بناء برنامج أكبر من المساحة الحرة المعلنة | FAIL ✔ |
| guest | إزاحة `COMMAND.COM` كتلة واحدة | FAIL ✔ (بعد إصلاح الاختبار) |
| pe | تحديد الاستيرادات من اسم القسم (السلوك الأصلي) | FAIL ✔ |
| pe | قاعدة دليل البيانات PE32+ = 96 بدل 112 | FAIL ✔ |
| pe | حذف حرّاس الاكتمال الثلاثة | FAIL ✔ |
| pe | حذف فلتر `.dll` (بعد إصلاح الاختبار) | FAIL ✔ |
| gate 1.15 | إرجاع `importRva = 0` · أو قاعدة PE32+ خاطئة | FAIL ✔ |
| catalog | إعادة «Prince of Persia · Wolfenstein · Doom · Duke Nukem» للبطاقة | FAIL ✔ |
| catalog | إعادة GTA إلى `arcade` | FAIL ✔ |
| catalog | إعادة «١٫٣ كيلوبايت · ٦٠٠ مللي» | FAIL ✔ |
| catalog | إعادة رابط `org.openttd.sdl` الميت | FAIL ✔ |
| catalog | جعل Wolfenstein «جاهزة بلمسة» بدل «أنت تجلب الملفات» | FAIL ✔ |
| gate 1.16 | ادعاء «2 ميغابايت» على قرص ١٫٤٤ | FAIL ✔ |
| ui | إعادة `Math.random()` إلى المراقب | FAIL ✔ (اختبار + فحص 1.17) |
| ui | إعادة `A4:7B:09:1C:EE:22` / `192.168.1.42` | FAIL ✔ (اختبار + فحص 1.17) |
| ui | إعادة `Mem: 8192M 2416M` إلى `free` | FAIL ✔ |
| ui | إعادة `surfaceflinger` إلى قائمة العمليات | FAIL ✔ |
| gate 1.17 | كتابة مسار ملف نصاً داخل الفحص | FAIL 1.8b ✔ (البوابة تصطاد نفسها) |
| wipe | إيقاف حذف الأقراص داخل `wipeAll` | FAIL ✔ (٢ اختبارات) |
| wipe | عدّ فشل الحذف كنجاح | FAIL ✔ |
| wipe | حذف `await wipeAll()` من زر المسح (مع بقاء الاسم) | **PASSED ✘** → بعد إصلاح الاختبار → FAIL ✔ |
| wipe | إعادة `Nova‑5G` | FAIL ✔ (اختبار + فحص 1.18) |
| back | إعادة الترتيب اليدوي `center` أولاً | FAIL ✔ (٤ اختبارات) |
| back | إعادة المكدّس اليدوي في `App.tsx` | FAIL ✔ |
| route | إعادة `bytes × 1.6` | FAIL ✔ (٣ اختبارات) |
| gate 1.8b | إعادة التعبير الأعمى عن `.tsx` | FAIL ✔ (`src/App.ts`) |

## ما هو **غير محسوم** ولم أدّعِ إغلاقه

| البند | لماذا |
| --- | --- |
| `adjustMarginsForEdgeToEdge: 'force'` على MagicOS تحديداً | السلوك مقروء من كود Capacitor، لكن لم يُرَ على HONOR Magic4 Pro. يحتاج جهازك |
| بناء APK و`aapt dump badging` | لا JDK ولا Android SDK في هذه البيئة |
| قيم الحرارة الحقيقية | تحتاج عتاداً |
