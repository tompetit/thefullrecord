import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/** Transpile a server .ts file and run it with stubbed dependencies (keyed by import specifier). */
export function loadTs(relativeToTests, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(relativeToTests, new URL("../", import.meta.url)), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require: (key) => {
      if (!(key in dependencies)) throw new Error(`unstubbed import ${key}`);
      return dependencies[key];
    },
    AbortSignal,
    URLSearchParams,
    Map, Set, Promise, Number, String, Array, Object, Error, Date,
    ...globals,
  });
  return exports;
}
