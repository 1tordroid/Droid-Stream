package com.vega

import android.graphics.Bitmap
import android.net.http.SslError
import android.os.Message
import android.view.KeyEvent
import android.webkit.ClientCertRequest
import android.webkit.HttpAuthHandler
import android.webkit.RenderProcessGoneDetail
import android.webkit.SafeBrowsingResponse
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream

/**
 * Wraps react-native-webview's own client for the browser screen. It adds
 * the request hook the library does not expose (ad blocking and media
 * detection in shouldInterceptRequest) and hands every other call to the
 * wrapped client unchanged.
 */
class BrowserWebClient(val inner: WebViewClient, @Volatile var tab: BrowserTab) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        if (tab.onRequest(request)) {
            return WebResourceResponse("text/plain", "utf-8", 204, "No Content", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        }
        return inner.shouldInterceptRequest(view, request)
    }

    @Deprecated("Deprecated in Java")
    override fun shouldInterceptRequest(view: WebView, url: String): WebResourceResponse? =
        @Suppress("DEPRECATION") inner.shouldInterceptRequest(view, url)

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
        inner.shouldOverrideUrlLoading(view, request)

    @Deprecated("Deprecated in Java")
    override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
        @Suppress("DEPRECATION") inner.shouldOverrideUrlLoading(view, url)

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        tab.onPageStarted(url.orEmpty())
        inner.onPageStarted(view, url, favicon)
    }

    override fun onPageFinished(view: WebView, url: String?) = inner.onPageFinished(view, url)

    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) =
        inner.doUpdateVisitedHistory(view, url, isReload)

    override fun onLoadResource(view: WebView, url: String?) = inner.onLoadResource(view, url)

    override fun onPageCommitVisible(view: WebView, url: String?) = inner.onPageCommitVisible(view, url)

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) =
        inner.onReceivedError(view, request, error)

    @Deprecated("Deprecated in Java")
    override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) =
        @Suppress("DEPRECATION") inner.onReceivedError(view, errorCode, description, failingUrl)

    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) =
        inner.onReceivedHttpError(view, request, errorResponse)

    override fun onFormResubmission(view: WebView, dontResend: Message?, resend: Message?) =
        inner.onFormResubmission(view, dontResend, resend)

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) =
        inner.onReceivedSslError(view, handler, error)

    override fun onReceivedClientCertRequest(view: WebView, request: ClientCertRequest) =
        inner.onReceivedClientCertRequest(view, request)

    override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String?, realm: String?) =
        inner.onReceivedHttpAuthRequest(view, handler, host, realm)

    override fun shouldOverrideKeyEvent(view: WebView, event: KeyEvent): Boolean = inner.shouldOverrideKeyEvent(view, event)

    override fun onUnhandledKeyEvent(view: WebView, event: KeyEvent) = inner.onUnhandledKeyEvent(view, event)

    override fun onScaleChanged(view: WebView, oldScale: Float, newScale: Float) = inner.onScaleChanged(view, oldScale, newScale)

    override fun onReceivedLoginRequest(view: WebView, realm: String?, account: String?, args: String?) =
        inner.onReceivedLoginRequest(view, realm, account, args)

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean =
        inner.onRenderProcessGone(view, detail)

    override fun onSafeBrowsingHit(view: WebView, request: WebResourceRequest, threatType: Int, callback: SafeBrowsingResponse) =
        inner.onSafeBrowsingHit(view, request, threatType, callback)

    @Deprecated("Deprecated in Java")
    override fun onTooManyRedirects(view: WebView, cancelMsg: Message?, continueMsg: Message?) =
        @Suppress("DEPRECATION") inner.onTooManyRedirects(view, cancelMsg, continueMsg)
}
