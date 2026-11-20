import { registerHooks } from 'node:module';

// Existing source uses bundler-style extensionless imports. Resolve those for
// Node's native TypeScript test runner, without another runtime dependency.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (!specifier.startsWith('.') || !['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error.code)) throw error;
      for (const suffix of ['.ts', '/index.ts']) {
        try { return nextResolve(specifier + suffix, context); } catch { /* try next source form */ }
      }
      throw error;
    }
  },
});
