import {describe, expect, it} from '@jest/globals';
// A real DOM for the page script; the React Native preset cannot run under the jsdom environment.
const {JSDOM} = require('jsdom');
import {buildBootstrap, buildUserscriptInjection, callPage} from '../src/lib/browser/inject';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('page script in a page', () => {
  it('finds media, notices sign-ins, fills them and runs userscripts', async () => {
    const dom = new JSDOM('<!doctype html><html><head><title>Test</title></head><body></body></html>', {url: 'https://site.test/login', runScripts: 'outside-only'});
    const window = dom.window;
    const document = window.document;
    const location = window.location;
    const messages: any[] = [];
    window.ReactNativeWebView = {postMessage: (text: string) => messages.push(JSON.parse(text))};
    // jsdom has no layout; every element gets a size so it counts as visible.
    window.Element.prototype.getBoundingClientRect = () => ({width: 300, height: 40, top: 10, left: 0, right: 300, bottom: 50, x: 0, y: 10});
    window.requestAnimationFrame = (fn: () => void) => setTimeout(fn, 0);
    document.body.innerHTML = `
      <video id="v" src="https://cdn.test/movie_720p.mp4" poster="https://cdn.test/p.jpg"></video>
      <a href="magnet:?xt=urn:btih:abc&dn=Test">magnet</a>
      <form id="f"><input type="email" id="u" name="email"><input type="password" id="p"><button type="submit" id="b">Log in</button></form>`;
    const run = (code: string) => window.eval(code);
    run(buildBootstrap({token: 'TOK', desktop: true, darkPages: false, videoButton: true, detectLogins: true}));

    expect(messages[0]).toMatchObject({type: 'page', __dsb: 1});
    // Page scripts cannot replace the functions the app calls.
    window.__dsFill = () => undefined;
    expect(Object.getOwnPropertyDescriptor(window, '__dsFill')?.writable).toBe(false);

    await wait(1600);
    const media = messages.filter(message => message.type === 'media').flatMap(message => message.items);
    expect(media.map(item => item.url)).toEqual(expect.arrayContaining(['https://cdn.test/movie_720p.mp4', 'magnet:?xt=urn:btih:abc&dn=Test']));
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe('width=1280');

    (document.getElementById('u') as any).value = 'me@test';
    (document.getElementById('p') as any).value = 'secret';
    document.getElementById('f')!.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
    const login = messages.find(message => message.type === 'login');
    expect(login).toMatchObject({username: 'me@test', password: 'secret', __ds: 'TOK'});

    (document.getElementById('u') as any).value = '';
    (document.getElementById('p') as any).value = '';
    run(callPage('__dsFill', 'WRONG', location.origin, 'x', 'y', false));
    expect((document.getElementById('p') as any).value).toBe('');
    run(callPage('__dsFill', 'TOK', location.origin, 'saved@test', 'pw', false));
    expect((document.getElementById('u') as any).value).toBe('saved@test');
    expect((document.getElementById('p') as any).value).toBe('pw');

    run(callPage('__dsHide', ['.ad', 'bad[[selector']));
    expect(document.querySelector('style[data-ds="hide"]')).not.toBeNull();

    run(buildUserscriptInjection('TOK', {id: 'us1', code: 'window.__ran = GM_info.script.name + GM_getValue("n", 0); GM_setValue("n", 5);', runAt: 'document-start', name: 'Test'}, {n: 4}));
    expect(window.__ran).toBe('Test4');
    expect(messages.find(message => message.type === 'gm')).toMatchObject({op: 'set', script: 'us1', key: 'n', value: 5, __ds: 'TOK'});
    // Without the token, nothing runs.
    run(buildUserscriptInjection('NOPE', {id: 'us2', code: 'window.__ran2 = 1;', runAt: 'document-start', name: 'Bad'}, {}));
    expect(window.__ran2).toBeUndefined();
    // Stops the page's timers so Jest can finish.
    window.close();
  }, 20000);
});
