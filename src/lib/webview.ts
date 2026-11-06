import {WebView as UpstreamWebView} from 'react-native-webview';

/**
 * react-native-webview 14.0.1 declares `class WebView<P = undefined>`, which
 * turns every prop into `never` under React Native's strict types (13.x used
 * `{}`). Pin the generic here; the component itself is unchanged.
 */
export const WebView = UpstreamWebView<object>;
export type WebView = UpstreamWebView<object>;
