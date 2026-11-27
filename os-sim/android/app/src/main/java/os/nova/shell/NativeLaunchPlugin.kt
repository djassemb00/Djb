package os.nova.shell

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.FileProvider
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * PLAN ٢-٢ + ٢-٣: the native bridge that makes "open in Winlator" a real button.
 *
 * Why this cannot be done in JavaScript: a web app cannot enumerate installed packages,
 * cannot start an activity in another app, and cannot hand a file to a FileProvider. All
 * three are platform calls. Everything here is a *query plus a refusal*: if Winlator is
 * not installed we say so and return the store URL -- we never leave a button that does
 * nothing (that was the defect this whole cycle exists to remove).
 *
 * Matched against the real API, not from memory:
 *   Bridge.getActivity()          -> AppCompatActivity   (capacitor/.../Bridge.java:440)
 *   PluginCall.resolve(JSObject)  -> void                 (PluginCall.java:47)
 *   PluginCall.reject(msg,code)   -> void                 (PluginCall.java:108)
 */
@CapacitorPlugin(name = "NativeLaunch")
class NativeLaunchPlugin : Plugin() {

    /**
     * A shared file waiting to be read by the web app.
     *
     * The manifest can declare an intent filter, but only Java reads the intent. This is
     * the hand-off between the two: MainActivity.onCreate/onNewIntent put the incoming
     * intent here, the web app takes it exactly once, and nothing is consumed on the web
     * side until the user is actually in the share flow.
     */
    companion object {
        @Volatile
        private var pending: Intent? = null

        fun stash(activity: android.app.Activity, intent: Intent?) {
            if (intent == null) return
            val action = intent.action ?: return
            if (action != Intent.ACTION_SEND && action != Intent.ACTION_VIEW) {
                // The launcher intent lands here on every cold start; keeping it would
                // make the app think it was opened to receive a file every single time.
                return
            }
            pending = intent
        }
    }

    /**
     * Packages that can open a container. `com.winlator.star` is Bannerlator, which
     * shares the container format; GameNative publishes as `app.gamenative`.
     * Order matters: the first installed one wins.
     */
    private val candidates = listOf(
        "com.winlator",
        "com.winlator.star",
        "app.gamenative",
    )

    /** Which of the three is installed, if any. Never throws: a missing package is data. */
    @PluginMethod
    fun detect(call: PluginCall) {
        val pm = context.packageManager
        val found = JSArray()
        for (pkg in candidates) {
            try {
                pm.getPackageInfo(pkg, 0)
                found.put(pkg)
            } catch (_: PackageManager.NameNotFoundException) {
                // not installed: nothing to report, and nothing to pretend
            }
        }
        // JSArray.getString(0) on an empty array throws JSONException, so the version is
        // only read when something was actually found. Detect must never throw: the
        // caller treats a throw as "the plugin is broken" and falls back to the browser,
        // which would turn "Winlator is not installed" into a worse lie than it is.
        val first: String? = if (found.length() > 0) found.getString(0) else null
        val ret = JSObject()
        ret.put("installed", found)
        ret.put("version", if (first == null) "" else installedVersion(first))
        call.resolve(ret)
    }

    /** Open a container file in the first installed host app. */
    @PluginMethod
    fun openContainer(call: PluginCall) {
        val path = call.getString("path")
        if (path == null || path.isEmpty()) {
            call.reject("path is required", "MISSING_PATH")
            return
        }
        val file = File(path)
        if (!file.exists()) {
            // The export lane and this one must agree; a missing file is a real failure.
            call.reject("file does not exist: $path", "NO_FILE")
            return
        }
        val pkg = firstInstalled()
        if (pkg == null) {
            val ret = JSObject()
            ret.put("launched", false)
            ret.put("storeUrl", "https://github.com/brunodev85/winlator/releases")
            ret.put("reason", "no host app installed")
            call.resolve(ret)
            return
        }
        try {
            // FileProvider authority is <applicationId>.fileprovider (see manifest)
            val uri: Uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                file,
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/json")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                setPackage(pkg)
            }
            activity.startActivity(intent)
            val ret = JSObject()
            ret.put("launched", true)
            ret.put("package", pkg)
            call.resolve(ret)
        } catch (e: ActivityNotFoundException) {
            call.reject("no activity can open this file: ${e.message}", "NO_ACTIVITY")
        } catch (e: IllegalArgumentException) {
            // FileProvider throws this when the path is outside its declared roots
            call.reject("file is outside the shared roots: ${e.message}", "NOT_SHARED")
        }
    }

    /**
     * PLAN ٢-٣ receive side. Returns the shared file's name/type/uri, or
     * `{pending:false}` when the app was opened normally. Cleared on read so a stale
     * share cannot be re-imported after the user backs out.
     */
    @PluginMethod
    fun takePendingShare(call: PluginCall) {
        val intent = pending
        // Consumed the moment it is read, whatever the outcome: a share that is kept
        // because the caller crashed halfway would be re-imported on the next open.
        pending = null
        val ret = JSObject()
        if (intent == null) {
            ret.put("pending", false)
            call.resolve(ret)
            return
        }
        val uri: Uri? = if (intent.action == Intent.ACTION_SEND) {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        } else {
            intent.data
        }
        if (uri == null) {
            // ACTION_SEND without EXTRA_STREAM is legal and useless; say so, do not guess.
            ret.put("pending", false)
            ret.put("reason", "intent carried no stream")
            call.resolve(ret)
            return
        }
        // The display name is what classifyShare() decides on, so it has to be the real
        // one from the content provider, not the opaque last path segment.
        val name = try {
            context.contentResolver.query(uri, null, null, null, null)?.use { c ->
                val idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (idx >= 0 && c.moveToFirst()) c.getString(idx) else uri.lastPathSegment
            } ?: uri.lastPathSegment
        } catch (_: Exception) {
            uri.lastPathSegment
        }
        ret.put("pending", true)
        ret.put("name", name ?: "")
        ret.put("type", intent.type ?: "")
        ret.put("uri", uri.toString())
        call.resolve(ret)
    }

    private fun firstInstalled(): String? {
        val pm = context.packageManager
        for (pkg in candidates) {
            try {
                pm.getPackageInfo(pkg, 0)
                return pkg
            } catch (_: PackageManager.NameNotFoundException) {
                continue
            }
        }
        return null
    }

    private fun installedVersion(pkg: String): String {
        if (pkg.isEmpty()) return ""
        return try {
            val info = context.packageManager.getPackageInfo(pkg, 0)
            info.versionName ?: ""
        } catch (_: PackageManager.NameNotFoundException) {
            ""
        }
    }
}
