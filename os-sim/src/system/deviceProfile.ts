/**
 * Device-specific guidance.
 *
 * The emulator is a long-running, CPU-heavy app, which puts it straight into the
 * path of OEM power management. Honor/Huawei (MagicOS/EMUI) is the most
 * aggressive of the mainstream skins: it freezes or kills background apps unless
 * "App launch" is set to manual. Rather than guess, we detect the vendor and show
 * the exact switches the user has to flip.
 *
 * Also recorded here: what the device *cannot* do, so we never advertise a path
 * the hardware has no support for.
 */
export interface DeviceProfile {
  vendor: 'honor' | 'huawei' | 'samsung' | 'xiaomi' | 'generic';
  label: string;
  /** steps to keep a heavy app alive, in the device's own menu language */
  keepAlive: string[];
  /** hardware facts that decide which emulation paths are even possible */
  limits: string[];
  /** one-line verdict: what this phone should actually run */
  verdict: string;
}

const UA = typeof navigator === 'undefined' ? '' : navigator.userAgent;

export function detectDevice(): DeviceProfile {
  const ua = UA.toLowerCase();
  if (ua.includes('hihonor') || ua.includes('honor')) {
    return {
      vendor: 'honor',
      label: 'HONOR / MagicOS',
      keepAlive: [
        'الإعدادات ← التطبيقات ← إدارة بدء التشغيل ← أوقف «الإدارة التلقائية للكل»',
        'ثم اختر التطبيق وفعّل المفاتيح الثلاثة: بدء تلقائي · بدء ثانوي · التشغيل في الخلفية',
        'الإعدادات ← البطارية ← تحسين البطارية ← التطبيق ← «غير مسموح» (أي بلا قيود)',
        'في قائمة التطبيقات الأخيرة: اسحب نافذة التطبيق لأسفل واقفلها 🔒 حتى لا تُغلق',
      ],
      limits: [
        'لا يوجد AVF/pKVM على أجهزة HONOR ← مسار «آلة افتراضية أصلية» غير متاح',
        'MagicOS مبني على أندرويد ١٣/١٤ ← وضع سطح مكتب أندرويد ١٦/١٧ غير متاح',
        'Snapdragon 8 Gen 1 يسخن سريعاً ← حاكم الحرارة ضرورة لا رفاهية',
        'أندرويد ١٢+ يقتل «العمليات الشبحية» عند ٣٢ عملية لكل النظام، ويقتل ما يستهلك CPU في الخلفية',
      ],
      verdict:
        'جهازك ممتاز لهذا المحرك: Adreno 730 مدعوم رسمياً في Turnip، و٨ غيغا تكفي أكثر من اللازم. ' +
        'القيد الحقيقي هو الحرارة وMagicOS، لا العتاد.',
    };
  }
  if (ua.includes('huawei')) {
    return {
      vendor: 'huawei',
      label: 'Huawei / EMUI',
      keepAlive: [
        'الإعدادات ← البطارية ← إدارة بدء التشغيل ← إدارة يدوية',
        'فعّل: بدء تلقائي · بدء ثانوي · التشغيل في الخلفية',
        'الإعدادات ← التطبيقات ← التطبيق ← استهلاك الطاقة ← إدارة يدوية',
      ],
      limits: ['لا يوجد AVF/pKVM على أجهزة Huawei'],
      verdict: 'Kirin يحتاج Box64 لا FEX: أداء أقل في مسار .exe الأصلي. محركانا المتصفحي لا يتأثر.',
    };
  }
  if (ua.includes('samsung')) {
    return {
      vendor: 'samsung',
      label: 'Samsung / One UI',
      keepAlive: [
        'الإعدادات ← البطارية ← حدود استخدام الخلفية ← أضف التطبيق إلى «التطبيقات التي لا تُنام»',
        'الإعدادات ← التطبيقات ← التطبيق ← البطارية ← «غير مقيد»',
      ],
      limits: ['AVF متاح على أجهزة Exynos الحديثة فقط، وليس على كل طرازات سامسونج'],
      verdict: 'مسار .exe الأصلي أضعف على Mali/Xclipse؛ الأفضل هنا مسار المتصفح وBoxedwine.',
    };
  }
  if (ua.includes('miui') || ua.includes('redmi') || ua.includes('xiaomi')) {
    return {
      vendor: 'xiaomi',
      label: 'Xiaomi / HyperOS',
      keepAlive: [
        'الإعدادات ← التطبيقات ← التطبيق ← بدء التشغيل التلقائي: تشغيل',
        'الإعدادات ← البطارية ← موفّر البطارية للتطبيقات ← «بلا قيود»',
        'اقفل التطبيق في قائمة التطبيقات الأخيرة',
      ],
      limits: [],
      verdict: 'HyperOS يقتل الخلفية بشراسة مشابهة؛ طبّق خطوات التثبيت الثلاث.',
    };
  }
  return {
    vendor: 'generic',
    label: 'Android',
    keepAlive: ['الإعدادات ← التطبيقات ← التطبيق ← البطارية ← «بلا قيود»'],
    limits: [],
    verdict: 'جهاز عام: كل مسارات المتصفح تعمل، والمسار الأصلي يعتمد على نوع المعالج.',
  };
}
