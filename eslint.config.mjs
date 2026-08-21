// @ts-check
import tseslint from 'typescript-eslint'

/**
 * Guardrail #1 from the plan: the engine must stay pure.
 *
 * One Date.now(), Math.random() or crypto call inside packages/engine and hot-seat,
 * AI and online silently diverge, replays stop reproducing, and nobody notices for
 * weeks. These rules are the cheapest possible way to make that impossible, and they
 * exist from the first commit rather than being retrofitted.
 */
const ENGINE_BANNED_GLOBALS = [
  { name: 'Date', message: 'Engine must be deterministic. Time enters only as an explicit TIMEOUT action.' },
  { name: 'performance', message: 'Engine must be deterministic. No wall-clock reads.' },
  { name: 'crypto', message: 'Engine must be deterministic. Seed the RNG from outside and thread RngState through state.' },
  { name: 'fetch', message: 'Engine must be pure. No I/O.' },
  { name: 'console', message: 'Engine must be pure. Return events instead of logging.' },
  { name: 'process', message: 'Engine must be platform-agnostic. No process access.' },
  { name: 'window', message: 'Engine must be platform-agnostic. No DOM.' },
  { name: 'document', message: 'Engine must be platform-agnostic. No DOM.' },
  { name: 'localStorage', message: 'Engine must be pure. No storage.' },
  { name: 'setTimeout', message: 'Engine must be synchronous and pure.' },
  { name: 'setInterval', message: 'Engine must be synchronous and pure.' },
]

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/*.gen.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...ENGINE_BANNED_GLOBALS],
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'react', message: 'Engine must not depend on the UI framework.' },
          { name: 'next', message: 'Engine must not depend on the web framework.' },
          { name: 'socket.io', message: 'Engine must not know about transport.' },
          { name: 'socket.io-client', message: 'Engine must not know about transport.' },
        ],
        patterns: [
          { group: ['node:*', 'fs', 'path', 'crypto', 'http'], message: 'Engine must be platform-agnostic.' },
          { group: ['@sr/protocol', '@sr/web'], message: 'Engine must not import outward.' },
        ],
      }],
      // Math.random() is a property access, not a global reference, so no-restricted-globals
      // cannot catch it. This does.
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in rng.ts. Math.random breaks replays.' },
        { object: 'Date', property: 'now', message: 'Engine must be deterministic.' },
      ],
      'no-restricted-syntax': ['error',
        { selector: 'NewExpression[callee.name="Date"]', message: 'Engine must be deterministic.' },
      ],
    },
  },
)
