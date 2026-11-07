package com.vega

import android.app.ActivityManager
import android.content.Context
import android.telephony.TelephonyManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.util.Locale

/**
 * Exposes the app's real heap limit (Runtime.maxMemory, which reflects
 * largeHeap) and the device's total RAM so settings can cap the player buffer
 * sliders at what the patched player will actually use.
 *
 * Also gives Live TV the country hints it picks a World channel list from:
 * the SIM country, the mobile network country and the phone's language
 * region. All three are read on the device; nothing is looked up online.
 */
class DeviceMemoryModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "VegaDeviceMemory"

    private fun memoryInfo(): Map<String, Any> {
        val activityManager =
            reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(info)
        return mapOf(
            "heapLimitMB" to (Runtime.getRuntime().maxMemory() / (1024 * 1024)).toInt(),
            "totalRamMB" to (info.totalMem / (1024 * 1024)).toInt(),
        )
    }

    // supportedAbis lets the in-app updater pick the APK built for this device.
    override fun getConstants(): MutableMap<String, Any> =
        memoryInfo().toMutableMap().apply {
            put("supportedAbis", android.os.Build.SUPPORTED_ABIS.joinToString(","))
            putAll(countryHints())
        }

    /** Lower-case two-letter codes, or "" when unknown (TV boxes have no SIM). */
    private fun countryHints(): Map<String, String> {
        val telephony = try {
            reactApplicationContext.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        } catch (_: Exception) {
            null
        }
        fun clean(value: String?) = value?.trim()?.lowercase(Locale.ROOT)?.takeIf { it.length == 2 } ?: ""
        val sim = try { clean(telephony?.simCountryIso) } catch (_: Exception) { "" }
        val network = try { clean(telephony?.networkCountryIso) } catch (_: Exception) { "" }
        val locale = try {
            clean(reactApplicationContext.resources.configuration.locales[0]?.country ?: Locale.getDefault().country)
        } catch (_: Exception) {
            clean(Locale.getDefault().country)
        }
        return mapOf("simCountry" to sim, "networkCountry" to network, "localeCountry" to locale)
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getCountryHints(): WritableMap =
        Arguments.createMap().apply { countryHints().forEach { (key, value) -> putString(key, value) } }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getHeapLimitMB(): Int = memoryInfo()["heapLimitMB"] as Int

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getTotalRamMB(): Int = memoryInfo()["totalRamMB"] as Int
}
