/* global globalThis */
// Minimal Expo native runtime globals (what jest-expo installs), so expo-*
// packages can be imported in tests without the native binary.
class EventEmitter {
  addListener() { return {remove() {}}; }
  removeListener() {}
  removeAllListeners() {}
  emit() {}
  listenerCount() { return 0; }
}
class NativeModule extends EventEmitter {}
class SharedObject extends EventEmitter { release() {} }
class SharedRef extends SharedObject {}
const stubs = new Map();
// Each native module is an object whose members are constructible no-ops, so
// `class X extends Module.NativeThing` and `Module.method()` both work.
const member = () => {
  function Stub() {}
  Stub.prototype = Object.create(SharedObject.prototype);
  return Stub;
};
const nativeModule = name => {
  if (!stubs.has(name)) {
    const cache = {};
    stubs.set(name, new Proxy(new NativeModule(), {
      get: (target, key) => {
        if (key in target) return target[key];
        if (typeof key !== 'string') return undefined;
        if (!(key in cache)) cache[key] = member();
        return cache[key];
      },
    }));
  }
  return stubs.get(name);
};
if (!globalThis.expo) {
  globalThis.expo = {
    EventEmitter,
    NativeModule,
    SharedObject,
    SharedRef,
    modules: new Proxy({}, {get: (_target, name) => nativeModule(name)}),
    uuidv4: () => '00000000-0000-4000-8000-000000000000',
    uuidv5: () => '00000000-0000-5000-8000-000000000000',
    getViewConfig: () => ({validAttributes: {}, directEventTypes: {}}),
    reloadAppAsync: async () => undefined,
  };
}
