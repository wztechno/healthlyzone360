/**
 * Explicit web platform entry. `direction.ts` holds the implementation so TypeScript, Vitest and
 * Node all see the DOM adapter; Metro resolves this file for `platform: 'web'`.
 */
export * from './direction.ts';
