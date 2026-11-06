// A module where every export, property and call is a harmless no-op.
// A call returns something that is both callable (an unsubscribe function)
// and a promise that resolves to undefined.
const handler = {
  get: (_target, key) => {
    if (key === '__esModule') return true;
    if (key === 'then') return undefined;
    if (key === Symbol.toPrimitive) return () => '';
    return new Proxy(function noop() {}, handler);
  },
  apply: () => {
    const done = Promise.resolve(undefined);
    const result = () => undefined;
    result.then = done.then.bind(done);
    result.catch = done.catch.bind(done);
    result.finally = done.finally.bind(done);
    return result;
  },
  construct: () => ({}),
};
module.exports = () => new Proxy(function root() {}, handler);
