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

    @PluginMethod
    fun read(call: PluginCall) {
        val result = JSObject()
        // 0..6 matching Android's THERMAL_STATUS_* order; -1 means "this OS cannot say"
        var status = -1
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            status = power.currentThermalStatus
        }
        result.put("status", status)

        var headroom: Double? = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // 10-minute forecast; clamp because some vendors return Float.NaN
            val h = power.getThermalHeadroom(10)
            if (!h.isNaN() && h > 0f && h < 10f) headroom = h.toDouble()
        }
        if (headroom != null) result.put("headroom", headroom)

        val battery = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val level = battery?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
        result.put("battery", level)
        result.put("charging", battery?.isCharging ?: false)
        result.put("sdk", Build.VERSION.SDK_INT)
        result.put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
        call.resolve(result)
    }
}
