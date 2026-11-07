package com.vega

import android.content.Context
import androidx.javascriptengine.IsolateStartupParameters
import androidx.javascriptengine.JavaScriptSandbox
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Runs yt-dlp's YouTube challenge solver (yt-dlp-ejs) in Android's JavaScript
 * sandbox: the WebView V8 engine in an isolated process, with no network or
 * file access. One sandbox is kept for the process; each script gets a fresh
 * isolate.
 */
object YtdlJsSandbox {
    private const val TAG = "YtdlJsSandbox"
    private const val HEAP_BYTES = 512L * 1024 * 1024
    private const val TIMEOUT_SECONDS = 120L
    // Without this feature a script must fit in one Binder transaction.
    private const val SMALL_SCRIPT_LIMIT = 800_000

    @Volatile private var sandbox: JavaScriptSandbox? = null
    private val lock = Any()

    fun isSupported(): Boolean = try {
        JavaScriptSandbox.isSupported()
    } catch (_: Throwable) {
        false
    }

    private fun connect(context: Context): JavaScriptSandbox {
        synchronized(lock) {
            sandbox?.let { return it }
            val created = JavaScriptSandbox.createConnectedInstanceAsync(context.applicationContext)
                .get(30, TimeUnit.SECONDS)
            sandbox = created
            return created
        }
    }

    private fun drop() {
        synchronized(lock) {
            try {
                sandbox?.close()
            } catch (_: Throwable) {
            }
            sandbox = null
        }
    }

    /**
     * Runs a script that prints its answer with console.log, the way yt-dlp
     * runs Deno or Node, and returns what it printed.
     */
    fun run(context: Context, script: String): String {
        if (!isSupported()) throw IllegalStateException("This WebView has no JavaScript sandbox")
        val current = connect(context)
        val wrapped = wrap(script)
        if (wrapped.length > SMALL_SCRIPT_LIMIT &&
            !current.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_EVALUATE_WITHOUT_TRANSACTION_LIMIT)) {
            throw IllegalStateException("Update Android System WebView to solve YouTube challenges")
        }
        val parameters = IsolateStartupParameters()
        if (current.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_ISOLATE_MAX_HEAP_SIZE)) {
            parameters.maxHeapSizeBytes = HEAP_BYTES
        }
        try {
            val isolate = current.createIsolate(parameters)
            try {
                return isolate.evaluateJavaScriptAsync(wrapped).get(TIMEOUT_SECONDS, TimeUnit.SECONDS) ?: ""
            } finally {
                isolate.close()
            }
        } catch (error: Throwable) {
            VegaLog.w(TAG, "Challenge script failed", error)
            // A crashed or dead sandbox process is replaced on the next call.
            drop()
            throw error
        }
    }

    /**
     * Collects console.log output and returns it as the script's result. The
     * solver also prints the whole preprocessed player (megabytes) for a cache
     * yt-dlp keeps switched off; it is dropped here so the answer stays small.
     */
    private fun wrap(script: String): String {
        val body = JSONObject.quote(script)
        return """
            (function () {
              var __out = [];
              var __print = function () {
                var line = Array.prototype.map.call(arguments, String).join(' ');
                try {
                  var parsed = JSON.parse(line);
                  if (parsed && typeof parsed === 'object' && 'preprocessed_player' in parsed) {
                    delete parsed.preprocessed_player;
                    line = JSON.stringify(parsed);
                  }
                } catch (ignored) {}
                __out.push(line);
              };
              var console = {log: __print, info: function () {}, warn: function () {}, error: function () {}, debug: function () {}};
              globalThis.console = console;
              (0, eval)($body);
              return __out.join('\n');
            })()
        """.trimIndent()
    }
}
