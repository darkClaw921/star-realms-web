/**
 * Guardrail #2: the engine imports nothing outward.
 *
 * ESLint catches the imports it knows to look for; this asserts the structural
 * property -- packages/engine never reaches into protocol, the web app, or Node.
 */
module.exports = {
  forbidden: [
    {
      name: 'engine-stays-pure',
      severity: 'error',
      comment: 'packages/engine must not import the app, the protocol, or any Node builtin.',
      from: { path: '^packages/engine/src' },
      to: {
        pathNot: '^(packages/engine/src|node_modules/immer)',
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
  },
}
