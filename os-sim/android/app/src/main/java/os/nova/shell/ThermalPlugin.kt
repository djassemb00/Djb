package os.nova.shell

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Thermal and battery readings for the emulator's governor.
 *
 * The web layer cannot see the platform's thermal state: the Battery Status API is
 * absent in WebView and there is no web thermal API at all, so `thermal.ts` was stuck
 * on "normal". These three platform calls close that gap — none of them needs a
 * permission and none of them touches Play Services:
 *
 *   PowerManager.getCurrentThermalStatus()   API 29+  (0..6, THERMAL_STATUS_*)
 *   PowerManager.getThermalHeadroom(minutes) API 30+  (>1.0 means throttling is close)
 *   BatteryManager.BATTERY_PROPERTY_CAPACITY  API 21+
 *
 * The JavaScript wrapper is src/system/thermalBridge.ts; the web build stays fully
 * functional without this plugin (it simply reports "unavailable").
 */
@CapacitorPlugin(name = "NovaThermal")
class ThermalPlugin : Plugin() {

    private val power: PowerManager by lazy {
        context.getSystemService(Context.POWER_SERVICE) as PowerManager
    }

    /**
     * Capacitor runs plugin methods on its own "CapacitorPlugins" HandlerThread
     * (Bridge.taskHandler), not on the UI thread. Every call below is a read-only
     * system property, and PowerManager/BatteryManager are safe from any thread, so
     * we stay off the main thread on purpose — a governor poll must never block UI.
     */
    @PluginMethod
    fun read(call: PluginCall) {
        val result = JSObject()
        // 0..6 matching Android's THERMAL_STATUS_* order; -1 means "this OS cannot say"
        var status = -1
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            status = power.currentThermalStatus
        }
        result.put("status", status)

        // getThermalHeadroom(seconds) — SECONDS, not minutes (PowerManager javadoc,
        // Android 11+): 1.0 is the SEVERE throttling threshold, values are clamped at
        // 0, and the platform rate-limits calls to one per second (a faster call
        // returns NaN, which is NOT "unsupported"). We poll every 10 s, so NaN here
        // means a misbehaving OEM HAL, and dropping the field is the honest answer.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val h: Float = power.getThermalHeadroom(10) // 10 s ahead
            if (!h.isNaN() && h > 0f && h < 10f) result.put("headroom", h.toDouble())
        }

        val battery = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        // getIntProperty returns Int.MIN_VALUE when the property is unsupported, and
        // it arrives as a nullable from Kotlin's view of the Java signature.
        val raw = battery?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val level = if (raw == null || raw < 0 || raw > 100) -1 else raw
        result.put("battery", level)
        result.put("charging", battery?.isCharging ?: false)
        result.put("sdk", Build.VERSION.SDK_INT)
        result.put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
        call.resolve(result)
    }
}
