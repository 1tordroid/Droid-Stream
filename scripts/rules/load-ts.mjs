// Loads app TypeScript (the rules checks and the site readers) into Node by
// bundling it with esbuild, so the scripts run exactly the app's code.
// React Native and Expo modules are replaced by empty stand-ins: the code
// these scripts call never uses them.
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const NATIVE = /^(react-native(-[a-z0-9-]+)?|@react-native(-[a-z]+)?\/.*|@dr\.pogodin\/.*|expo(-[a-z-]+)?|@expo\/.*)$/;

const stub = {
  name: 'native-stub',
  setup(build) {
    build.onResolve({filter: NATIVE}, args => ({path: args.path, namespace: 'native-stub'}));
    build.onLoad({filter: /.*/, namespace: 'native-stub'}, () => ({
      // Any name read from the stand-in is another stand-in. esbuild copies a
      // CommonJS module's own names into a new object whose prototype is the
      // module's prototype, so that prototype answers every name too.
      contents: `
        const read = (_target, key) => (key === 'then' || typeof key === 'symbol' ? undefined : make());
        const names = new Proxy({}, {get: read});
        const make = () => new Proxy(function () {}, {
          get: read,
          apply: () => make(),
          construct: () => make(),
          getPrototypeOf: () => names,
        });
        module.exports = make();`,
      loader: 'js',
    }));
  },
};

/** Imports a TypeScript file of the app as an ES module. */
export const loadTs = async entry => {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
    logLevel: 'silent',
    plugins: [stub],
  });
  const dir = mkdtempSync(join(tmpdir(), 'ds-rules-'));
  const file = join(dir, 'bundle.mjs');
  writeFileSync(file, result.outputFiles[0].text);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
};
