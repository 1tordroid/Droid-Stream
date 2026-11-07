import React, {memo, useEffect, useRef, useState} from 'react';
import {View, type HostInstance} from 'react-native';
import {getNodeHandle} from '../../tv/focus';
import {WebView} from '../../webview';
import type {BrowserTabViewProps} from '../engine';
import {attachWebView, browserNativeAvailable, detachWebView} from '../native';

const BLANK = '<!doctype html><meta name="viewport" content="width=device-width"><body style="background:#000"></body>';

/**
 * One tab's WebView. It starts on an empty page, hooks the native request
 * handler (ad blocking, media detection, downloads), and only then loads
 * the tab's address, so the first page is covered too.
 */
const WebViewTab = ({tab, visible, bootstrap, userAgent, autofill, passkeys, callbacks}: BrowserTabViewProps) => {
  const ref = useRef<WebView>(null);
  // The WebView ref is an imperative handle, not a native view, so the native
  // hook is given this wrapper's view and finds the WebView inside it.
  const hostRef = useRef<HostInstance>(null);
  const [ready, setReady] = useState(!browserNativeAvailable());
  const clearedHistory = useRef(false);
  const tabId = tab.id;

  useEffect(() => {
    const view = () => ref.current;
    callbacks.register(tabId, {
      load: url => view()?.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`),
      goBack: () => view()?.goBack(),
      goForward: () => view()?.goForward(),
      reload: () => view()?.reload(),
      injectScript: code => view()?.injectJavaScript(code),
    });
    return () => callbacks.register(tabId, null);
  }, [callbacks, tabId]);

  useEffect(() => {
    if (ready) return undefined;
    let cancelled = false;
    // The native view exists a moment after the first render.
    const timer = setTimeout(() => {
      const tag = getNodeHandle(hostRef.current);
      attachWebView(tag, tabId, {autofill, passkeys}).finally(() => {
        if (!cancelled) setReady(true);
      });
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Attach once per WebView; the options apply to its whole life.
  }, [tabId]);

  useEffect(() => () => detachWebView(tabId), [tabId]);

  return (
    <View ref={hostRef} collapsable={false} style={visible ? {flex: 1} : {display: 'none'}} pointerEvents={visible ? 'auto' : 'none'}>
      <WebView
        ref={ref}
        source={ready ? {uri: tab.startUrl} : {html: BLANK}}
        userAgent={userAgent}
        injectedJavaScriptBeforeContentLoaded={bootstrap}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        allowsFullscreenVideo
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="compatibility"
        setSupportMultipleWindows
        setBuiltInZoomControls
        setDisplayZoomControls={false}
        geolocationEnabled={false}
        cacheMode={tab.private ? 'LOAD_NO_CACHE' : 'LOAD_DEFAULT'}
        saveFormDataDisabled={tab.private}
        textZoom={100}
        style={{flex: 1, backgroundColor: '#000'}}
        onMessage={event => callbacks.onMessage(tabId, event.nativeEvent.data)}
        onNavigationStateChange={state => {
          if (!ready || state.url.startsWith('data:') || state.url === 'about:blank') return;
          callbacks.onNavigation(tabId, {url: state.url, title: state.title || '', loading: state.loading, canGoBack: state.canGoBack, canGoForward: state.canGoForward});
        }}
        onLoadProgress={event => ready && callbacks.onProgress(tabId, event.nativeEvent.progress)}
        onLoadEnd={event => {
          if (!ready) return;
          const {url, title} = event.nativeEvent;
          if (!/^https?:/i.test(url)) return;
          // Drops the empty start page from Back.
          if (!clearedHistory.current) {
            clearedHistory.current = true;
            (ref.current as unknown as {clearHistory?: () => void})?.clearHistory?.();
          }
          callbacks.onLoadEnd(tabId, url, title);
        }}
        onOpenWindow={event => callbacks.onOpenWindow(tabId, event.nativeEvent.targetUrl)}
        onShouldStartLoadWithRequest={request => (ready ? callbacks.onShouldStart(tabId, request.url, request.isTopFrame !== false) : true)}
        onRenderProcessGone={() => callbacks.onCrash(tabId)}
        onContentProcessDidTerminate={() => callbacks.onCrash(tabId)}
      />
    </View>
  );
};

export default memo(WebViewTab);
