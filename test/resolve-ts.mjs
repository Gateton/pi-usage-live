// Resolve hook for running the TypeScript sources on plain Node.
//
// TypeScript's ESM convention is to write relative imports with a ".js" extension
// even though the file on disk is ".ts". Node does not do that rewrite, and jiti
// (which pi uses at runtime) does. Without this hook, `npm test` would need a
// dependency just to resolve imports — so we map the specifier ourselves.
//
// Usage is wired up in package.json's test script; see test/setup.mjs.
export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  if (!isRelative || !specifier.endsWith(".js")) {
    return nextResolve(specifier, context);
  }

  try {
    // If a real .js file exists, prefer it.
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
  }
}
