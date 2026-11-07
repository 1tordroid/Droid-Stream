/**
 * The script the browser runs at the start of every page (main frame): it
 * finds media (DOM, fetch and XHR), puts a download button on videos, hides
 * ads with CSS, detects sign-ins, fills saved ones, finds text, darkens
 * pages, and gives userscripts their GM functions. It talks to the app
 * through window.ReactNativeWebView.postMessage.
 *
 * Messages that matter for privacy (sign-ins, GM requests) carry a token
 * the page cannot read: it lives only in this script's closure, and the
 * functions the app calls later are defined read-only before page scripts
 * run. Hermes cannot turn functions back into source, so this is a string.
 */

export interface BootstrapOptions {
  token: string;
  desktop: boolean;
  darkPages: boolean;
  videoButton: boolean;
  detectLogins: boolean;
}

export const buildBootstrap = (options: BootstrapOptions): string => `
(function () {
  if (window.__dsBooted) return;
  try { Object.defineProperty(window, '__dsBooted', {value: true}); } catch (e) { return; }
  var C = ${JSON.stringify(options)};
  var TOKEN = C.token;
  var bridge = window.ReactNativeWebView;
  var postRaw = bridge && bridge.postMessage ? bridge.postMessage.bind(bridge) : null;
  var stringify = JSON.stringify;
  var parse = JSON.parse;
  function post(message, secure) {
    if (!postRaw) return;
    if (secure) message.__ds = TOKEN;
    message.__dsb = 1;
    try { postRaw(stringify(message)); } catch (e) {}
  }
  function define(name, fn) {
    try { Object.defineProperty(window, name, {value: fn, writable: false, configurable: false, enumerable: false}); } catch (e) {}
  }
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, {once: true});
    else fn();
  }
  function root() { return document.head || document.documentElement; }

  post({type: 'page', url: location.href, title: document.title});

  /* Passkeys: a passkey sign-in that fails here (often because the passkey
     manager does not serve this app) is reported, so the app can offer to
     sign in with Chrome. The page still gets the same result and error. */
  try {
    var credentialsProto = window.CredentialsContainer && window.CredentialsContainer.prototype;
    if (credentialsProto) {
      ['get', 'create'].forEach(function (op) {
        var original = credentialsProto[op];
        if (typeof original !== 'function') return;
        var wrapped = function (options) {
          var result = original.apply(this, arguments);
          if (options && options.publicKey && result && typeof result.then === 'function') {
            result.then(null, function (error) {
              var name = error && error.name;
              if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotSupportedError') post({type: 'passkeyFailed', op: op, error: name, url: location.href}, true);
            });
          }
          return result;
        };
        try { Object.defineProperty(credentialsProto, op, {value: wrapped, writable: true, configurable: true}); } catch (e) {}
      });
    }
  } catch (e) {}

  /* Desktop layout: a wide viewport, so pages lay out as on a computer. */
  if (C.desktop) {
    var fixViewport = function () {
      var meta = document.querySelector('meta[name="viewport"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        if (root()) root().appendChild(meta);
      }
      if (meta.getAttribute('content') !== 'width=1280') meta.setAttribute('content', 'width=1280');
    };
    onReady(fixViewport);
    try { new MutationObserver(function () { try { var m = document.querySelector('meta[name="viewport"]'); if (m && m.getAttribute('content') !== 'width=1280') fixViewport(); } catch (e) {} }).observe(document.documentElement, {childList: true, subtree: true}); } catch (e) {}
  }

  /* Dark pages: invert light pages, then turn pictures and video back. */
  if (C.darkPages) {
    onReady(function () {
      var luminance = function (color) {
        var m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/.exec(color || '');
        if (!m || (m[4] !== undefined && Number(m[4]) < 0.1)) return null;
        return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
      };
      var body = document.body ? luminance(getComputedStyle(document.body).backgroundColor) : null;
      var html = luminance(getComputedStyle(document.documentElement).backgroundColor);
      var light = body !== null ? body > 0.5 : html !== null ? html > 0.5 : true;
      if (!light) return;
      var style = document.createElement('style');
      style.textContent = 'html{filter:invert(0.9) hue-rotate(180deg)!important;background:#fff!important}' +
        'img,video,picture,canvas,iframe,embed,object,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}';
      root().appendChild(style);
    });
  }

  /* Ad hiding: the app sends the selectors for this site. */
  define('__dsHide', function (selectors) {
    if (!selectors || !selectors.length) return;
    var style = document.createElement('style');
    style.setAttribute('data-ds', 'hide');
    (root() || document.documentElement).appendChild(style);
    var sheet = style.sheet;
    if (!sheet) return;
    for (var i = 0; i < selectors.length; i += 200) {
      var chunk = selectors.slice(i, i + 200);
      try {
        sheet.insertRule(chunk.join(',') + '{display:none!important}', sheet.cssRules.length);
      } catch (e) {
        for (var j = 0; j < chunk.length; j++) {
          try { sheet.insertRule(chunk[j] + '{display:none!important}', sheet.cssRules.length); } catch (e2) {}
        }
      }
    }
  });

  /* Media on the page. */
  var MEDIA = /\\.(m3u8|mpd|mp4|m4v|webm|mkv|mov|mp3|m4a|aac|ogg|opus|flac|wav)(\\?|#|$)/i;
  var seen = {};
  var queue = [];
  var flushTimer = 0;
  function report(item) {
    if (!item.url || seen[item.url]) return;
    seen[item.url] = 1;
    queue.push(item);
    if (!flushTimer) flushTimer = setTimeout(function () {
      flushTimer = 0;
      var items = queue.splice(0, queue.length);
      if (items.length) post({type: 'media', pageUrl: location.href, title: document.title, items: items});
    }, 700);
  }
  function absolute(url) {
    try { return new URL(url, location.href).href; } catch (e) { return ''; }
  }
  function scanVideo(el, tag) {
    var src = el.currentSrc || el.src || '';
    if (!src) {
      var source = el.querySelector('source[src]');
      if (source) src = source.src;
    }
    if (!src) return;
    if (/^blob:/i.test(src)) {
      report({url: 'blob:' + location.href, blob: true, tag: tag, width: el.videoWidth || 0, height: el.videoHeight || 0, poster: el.poster || ''});
      return;
    }
    if (!/^https?:/i.test(src)) return;
    report({url: src, tag: tag, width: el.videoWidth || 0, height: el.videoHeight || 0, poster: el.poster || '', duration: isFinite(el.duration) ? el.duration : 0});
  }
  function scan() {
    var videos = document.querySelectorAll('video');
    for (var i = 0; i < videos.length; i++) scanVideo(videos[i], 'video');
    var audios = document.querySelectorAll('audio');
    for (var a = 0; a < audios.length; a++) scanVideo(audios[a], 'audio');
    var sources = document.querySelectorAll('video source[src], audio source[src]');
    for (var s = 0; s < sources.length; s++) {
      var url = sources[s].src;
      if (/^https?:/i.test(url)) report({url: url, tag: 'source', mime: sources[s].type || ''});
    }
    var images = document.images;
    for (var k = 0; k < images.length && k < 400; k++) {
      var img = images[k];
      var w = img.naturalWidth || 0, h = img.naturalHeight || 0;
      var src2 = img.currentSrc || img.src;
      if (w * h >= 250000 && /^https?:/i.test(src2)) report({url: src2, tag: 'img', width: w, height: h});
    }
    var links = document.querySelectorAll('a[href^="magnet:"], a[href*=".torrent"], a[href*=".m3u8"], a[href*=".mp4"], a[href*=".mp3"], a[href*=".mkv"]');
    for (var l = 0; l < links.length && l < 200; l++) {
      var href = links[l].href;
      if (/^magnet:/i.test(href) || /\\.torrent(\\?|$)/i.test(href) || MEDIA.test(href)) report({url: href, tag: 'a', text: (links[l].textContent || '').trim().slice(0, 120)});
    }
    if (C.videoButton) placeButtons();
  }
  var scanTimer = 0;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () { scanTimer = 0; try { scan(); } catch (e) {} }, 600);
  }
  document.addEventListener('play', function (event) { if (event.target && event.target.tagName) scanVideo(event.target, event.target.tagName.toLowerCase()); scheduleScan(); }, true);
  document.addEventListener('loadedmetadata', scheduleScan, true);
  onReady(function () {
    scheduleScan();
    try { new MutationObserver(scheduleScan).observe(document.documentElement, {childList: true, subtree: true}); } catch (e) {}
    setInterval(function () { if (!document.hidden) scheduleScan(); }, 4000);
  });

  /* Streams a player fetches itself. */
  function watchUrl(url) {
    try {
      var full = absolute(String(url));
      if (/^https?:/i.test(full) && MEDIA.test(full.split('#')[0])) report({url: full, tag: 'net'});
    } catch (e) {}
  }
  try {
    var nativeFetch = window.fetch;
    if (nativeFetch) window.fetch = function (input) {
      watchUrl(input && input.url ? input.url : input);
      return nativeFetch.apply(this, arguments);
    };
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      watchUrl(url);
      return open.apply(this, arguments);
    };
  } catch (e) {}

  /* A download button on each playing or large video. */
  var buttons = [];
  function placeButtons() {
    var videos = Array.prototype.slice.call(document.querySelectorAll('video')).filter(function (v) {
      var r = v.getBoundingClientRect();
      return r.width >= 160 && r.height >= 90 && r.bottom > 0 && r.top < innerHeight;
    }).slice(0, 4);
    while (buttons.length > videos.length) { var old = buttons.pop(); old.el.remove(); }
    videos.forEach(function (video, index) {
      var entry = buttons[index];
      if (!entry) {
        var el = document.createElement('div');
        var shadow = el.attachShadow ? el.attachShadow({mode: 'closed'}) : el;
        var button = document.createElement('button');
        button.setAttribute('aria-label', 'Download video');
        button.textContent = '\\u2B07';
        button.style.cssText = 'all:initial;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:20px;background:rgba(0,0,0,.65);color:#fff;font:20px sans-serif;border:1px solid rgba(255,255,255,.4);cursor:pointer';
        shadow.appendChild(button);
        el.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;pointer-events:auto';
        document.documentElement.appendChild(el);
        entry = {el: el, button: button, video: null};
        button.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          var v = entry.video;
          if (!v) return;
          var src = v.currentSrc || v.src || '';
          post({type: 'videoButton', url: /^blob:/i.test(src) ? '' : src, blob: /^blob:/i.test(src), poster: v.poster || '', pageUrl: location.href, title: document.title, width: v.videoWidth || 0, height: v.videoHeight || 0});
        }, true);
        buttons[index] = entry;
      }
      entry.video = video;
      var rect = video.getBoundingClientRect();
      entry.el.style.transform = 'translate(' + Math.round(Math.min(innerWidth - 48, rect.right - 48)) + 'px,' + Math.round(Math.max(8, rect.top + 8)) + 'px)';
    });
  }
  if (C.videoButton) {
    var raf = 0;
    var move = function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; try { placeButtons(); } catch (e) {} }); };
    addEventListener('scroll', move, true);
    addEventListener('resize', move);
  }

  /* Long press on a link or picture. */
  document.addEventListener('contextmenu', function (event) {
    var node = event.target;
    var link = node && node.closest ? node.closest('a[href]') : null;
    var img = node && node.closest ? node.closest('img') : null;
    if (!link && !img) return;
    event.preventDefault();
    post({type: 'context', href: link ? link.href : '', src: img ? (img.currentSrc || img.src) : '', text: link ? (link.textContent || '').trim().slice(0, 200) : ''});
  }, true);

  /* Find in page. */
  var findState = {text: '', index: 0, count: 0};
  define('__dsFind', function (text, backwards) {
    try {
      if (!text) {
        if (window.getSelection) getSelection().removeAllRanges();
        findState = {text: '', index: 0, count: 0};
        post({type: 'find', count: 0, index: 0});
        return;
      }
      if (text !== findState.text) {
        var body = document.body ? document.body.innerText || '' : '';
        var lower = body.toLowerCase(), needle = text.toLowerCase(), count = 0, at = lower.indexOf(needle);
        while (at >= 0 && count < 9999) { count++; at = lower.indexOf(needle, at + needle.length); }
        findState = {text: text, index: 0, count: count};
        if (window.getSelection) getSelection().removeAllRanges();
      }
      var found = window.find ? window.find(text, false, !!backwards, true, false, false, false) : false;
      if (found && findState.count) {
        findState.index = backwards ? (findState.index <= 1 ? findState.count : findState.index - 1) : (findState.index >= findState.count ? 1 : findState.index + 1);
      }
      post({type: 'find', count: findState.count, index: found ? findState.index : 0});
    } catch (e) {
      post({type: 'find', count: 0, index: 0});
    }
  });

  /* Sign-ins: noticed when a form with a password is sent. */
  function visible(el) {
    if (!el || el.disabled || el.type === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function passwordFields(scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll('input[type="password"]')).filter(visible);
  }
  function userFieldFor(password, scope) {
    var inputs = Array.prototype.slice.call((scope || document).querySelectorAll('input')).filter(function (el) {
      return visible(el) && /^(text|email|tel|)$/i.test(el.type || '') && el !== password;
    });
    var before = inputs.filter(function (el) { return password && (el.compareDocumentPosition(password) & 4); });
    var named = inputs.filter(function (el) { return /user|mail|login|phone|account|id/i.test((el.autocomplete || '') + ' ' + el.name + ' ' + el.id); });
    return named.length ? named[named.length - 1] : before.length ? before[before.length - 1] : inputs[0] || null;
  }
  var lastSent = '';
  var USER_KEY = '__dsLoginUser';
  function rememberUser(value) { try { sessionStorage.setItem(USER_KEY, value); } catch (e) {} }
  function rememberedUser() { try { return sessionStorage.getItem(USER_KEY) || ''; } catch (e) { return ''; } }
  function captureLogin(scope) {
    if (!C.detectLogins) return;
    var fields = passwordFields(scope).filter(function (el) { return el.value; });
    if (!fields.length) {
      var user = userFieldFor(null, scope);
      if (user && user.value) rememberUser(user.value);
      return;
    }
    if (fields.length > 2) return;
    var password = fields[0].value;
    var userField = userFieldFor(fields[0], scope);
    var username = userField && userField.value ? userField.value : rememberedUser();
    var key = username + '\\u0000' + password;
    if (key === lastSent) return;
    lastSent = key;
    post({type: 'login', url: location.href, username: username, password: password, signup: fields.length === 2}, true);
  }
  document.addEventListener('submit', function (event) { try { captureLogin(event.target); } catch (e) {} }, true);
  document.addEventListener('click', function (event) {
    try {
      var node = event.target && event.target.closest ? event.target.closest('button, input[type="submit"], [role="button"], a') : null;
      if (!node) return;
      var label = (node.textContent || node.value || node.getAttribute('aria-label') || '').toLowerCase();
      if (node.type === 'submit' || /log ?in|sign ?in|next|continue|submit|enter/.test(label)) {
        var form = node.closest('form');
        captureLogin(form || document);
      }
    } catch (e) {}
  }, true);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' || !event.target || event.target.tagName !== 'INPUT') return;
    try { captureLogin(event.target.form || document); } catch (e) {}
  }, true);

  /* Filling a saved sign-in, only on the site it was saved for. */
  function setValue(el, value) {
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
  }
  define('__dsFill', function (token, origin, username, password, automatic) {
    if (token !== TOKEN || location.origin !== origin) return;
    var tries = 0;
    var fill = function () {
      if (location.origin !== origin) return true;
      var field = passwordFields()[0];
      var user = userFieldFor(field || null);
      if (field) {
        if (user && username && !user.value) setValue(user, username);
        if (!field.value || !automatic) setValue(field, password);
        return true;
      }
      if (user && username && !user.value && (automatic ? /user|mail|login|phone/i.test((user.autocomplete || '') + user.name + user.id + user.type) : true)) {
        setValue(user, username);
        return !automatic;
      }
      return false;
    };
    if (fill()) return;
    var timer = setInterval(function () { tries++; if (fill() || tries > 20) clearInterval(timer); }, 500);
  });
  define('__dsHasLoginForm', function () { post({type: 'loginForm', present: passwordFields().length > 0}); });
  onReady(function () { setTimeout(function () { if (passwordFields().length) post({type: 'loginForm', present: true}); }, 800); });

  /* Userscripts: the app injects each matching script with this token. */
  var gmCallbacks = {};
  var gmSeq = 0;
  define('__dsGmDone', function (token, id, result) {
    if (token !== TOKEN || !gmCallbacks[id]) return;
    var callbacks = gmCallbacks[id];
    delete gmCallbacks[id];
    try {
      if (result.error) { if (callbacks.onerror) callbacks.onerror({error: result.error, status: 0}); }
      else {
        var response = result.response;
        if (callbacks.responseType === 'json') { try { response.response = parse(response.responseText); } catch (e) { response.response = null; } }
        else response.response = response.responseText;
        response.readyState = 4;
        if (callbacks.onload) callbacks.onload(response);
      }
    } catch (e) { console.error(e); }
    if (callbacks.onloadend) try { callbacks.onloadend(); } catch (e) {}
    if (callbacks.resolve) callbacks.resolve(result.response);
  });
  define('__dsUS', function (token, id, runAt, info, values, body) {
    if (token !== TOKEN) return;
    var store = values || {};
    var api = {};
    api.GM_addStyle = function (css) {
      var style = document.createElement('style');
      style.textContent = css;
      (root() || document.documentElement).appendChild(style);
      return style;
    };
    api.GM_getValue = function (key, fallback) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback; };
    api.GM_setValue = function (key, value) { store[key] = value; post({type: 'gm', op: 'set', script: id, key: key, value: value}, true); };
    api.GM_deleteValue = function (key) { delete store[key]; post({type: 'gm', op: 'delete', script: id, key: key}, true); };
    api.GM_listValues = function () { return Object.keys(store); };
    api.GM_xmlhttpRequest = function (details) {
      var callId = id + ':' + (++gmSeq);
      gmCallbacks[callId] = {onload: details.onload, onerror: details.onerror, onloadend: details.onloadend, responseType: details.responseType, resolve: details.__resolve};
      post({type: 'gm', op: 'xhr', script: id, call: callId, request: {method: details.method, url: absolute(details.url), headers: details.headers, data: typeof details.data === 'string' ? details.data : undefined, timeout: details.timeout}}, true);
      return {abort: function () { delete gmCallbacks[callId]; }};
    };
    api.GM_openInTab = function (url) { post({type: 'gm', op: 'open', script: id, url: absolute(url)}, true); };
    api.GM_setClipboard = function (text) { post({type: 'gm', op: 'clipboard', script: id, text: String(text)}, true); };
    api.GM_notification = function (details, title) { post({type: 'gm', op: 'notify', script: id, text: typeof details === 'string' ? details : (details && details.text) || '', title: title || ''}, true); };
    api.GM_info = info;
    api.GM = {
      addStyle: function (css) { return Promise.resolve(api.GM_addStyle(css)); },
      getValue: function (k, d) { return Promise.resolve(api.GM_getValue(k, d)); },
      setValue: function (k, v) { api.GM_setValue(k, v); return Promise.resolve(); },
      deleteValue: function (k) { api.GM_deleteValue(k); return Promise.resolve(); },
      listValues: function () { return Promise.resolve(api.GM_listValues()); },
      xmlHttpRequest: function (d) { return new Promise(function (resolve) { d.__resolve = resolve; api.GM_xmlhttpRequest(d); }); },
      openInTab: function (u) { api.GM_openInTab(u); return Promise.resolve(); },
      setClipboard: function (t) { api.GM_setClipboard(t); return Promise.resolve(); },
      notification: function (d, t) { api.GM_notification(d, t); return Promise.resolve(); },
      info: info,
    };
    var run = function () {
      try { body(api.GM_addStyle, api.GM_getValue, api.GM_setValue, api.GM_deleteValue, api.GM_listValues, api.GM_xmlhttpRequest, api.GM_openInTab, api.GM_setClipboard, api.GM_notification, api.GM_info, window, api.GM); }
      catch (e) { console.error('[userscript ' + (info && info.script && info.script.name) + ']', e); }
    };
    if (runAt === 'document-start') run();
    else if (runAt === 'document-end') onReady(run);
    else onReady(function () { setTimeout(run, 0); });
  });
})();
true;
`;

/** Code that runs one userscript in the page. The script body stays the user's own code. */
export const buildUserscriptInjection = (
  token: string,
  script: {id: string; code: string; runAt: string; name: string; version?: string; namespace?: string; description?: string},
  values: Record<string, unknown>,
): string => {
  const info = {script: {name: script.name, version: script.version || '', namespace: script.namespace || '', description: script.description || ''}, scriptHandler: 'Droid Stream', version: '1'};
  return `(function () {
  if (typeof window.__dsUS !== 'function') return;
  window.__dsUS(${JSON.stringify(token)}, ${JSON.stringify(script.id)}, ${JSON.stringify(script.runAt)}, ${JSON.stringify(info)}, ${JSON.stringify(values)}, function (GM_addStyle, GM_getValue, GM_setValue, GM_deleteValue, GM_listValues, GM_xmlhttpRequest, GM_openInTab, GM_setClipboard, GM_notification, GM_info, unsafeWindow, GM) {
${script.code}
  });
})();
true;`;
};

/** Calls one of the page functions above with JSON arguments. */
export const callPage = (name: string, ...args: unknown[]): string =>
  `(function(){try{if(typeof window.${name}==='function')window.${name}(${args.map(arg => JSON.stringify(arg ?? null)).join(',')});}catch(e){}})();true;`;
