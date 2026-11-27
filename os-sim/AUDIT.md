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

## ما هو **غير محسوم** ولم أدّعِ إغلاقه

| البند | لماذا |
| --- | --- |
| `adjustMarginsForEdgeToEdge: 'force'` على MagicOS تحديداً | السلوك مقروء من كود Capacitor، لكن لم يُرَ على HONOR Magic4 Pro. يحتاج جهازك |
| بناء APK و`aapt dump badging` | لا JDK ولا Android SDK في هذه البيئة |
| قيم الحرارة الحقيقية | تحتاج عتاداً |
