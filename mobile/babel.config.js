// Jest executes modules as CommonJS, but Babel's module transform leaves
// dynamic `import()` calls in place (Metro handles them natively), so any test
// that hits one crashes with:
//   "A dynamic import callback was invoked without --experimental-vm-modules"
// In test env only, mark dynamic imports so @babel/plugin-transform-modules-commonjs
// (inside babel-preset-expo) rewrites them to lazy require() calls. This is a
// no-op for Metro/dev/prod bundles — NODE_ENV is never "test" there.
const markDynamicImportForCommonJS = () => ({
  name: 'mark-dynamic-import-for-commonjs',
  pre() {
    this.file.set('@babel/plugin-proposal-dynamic-import', '7.8.0');
  },
});

module.exports = function (api) {
  api.cache.using(() => process.env.NODE_ENV);
  const isTest = api.env('test');
  return {
    // unstable_transformImportMeta: some deps ship `import.meta`, which breaks
    // the classic-script web bundle ("Cannot use 'import.meta' outside a module").
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
    plugins: isTest ? [markDynamicImportForCommonJS] : [],
  };
};
