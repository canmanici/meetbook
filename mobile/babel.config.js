module.exports = function (api) {
  api.cache(true);
  return {
    // unstable_transformImportMeta: some deps ship `import.meta`, which breaks
    // the classic-script web bundle ("Cannot use 'import.meta' outside a module").
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
  };
};
