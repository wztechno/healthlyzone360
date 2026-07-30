/**
 * `@healthy360/nutrition` — the nutrition domain, with no React and no transport in it.
 *
 * Three concerns, deliberately separate:
 *
 * - `./facts` — the thirteen nutrition-facts contracts, the scaling and roll-up arithmetic
 *   (ingredient → recipe → meal → day → week) and the five-stop level mapping the design tokens
 *   render.
 * - `./targets` — the `NutritionTargetEngine` seam and `MockNutritionTargetEngine`, a deterministic
 *   prototype built from published, cited equations. Every result is marked `prototype: true`.
 * - `./planner` — the hard constraints and soft preferences an internal planner must respect, as
 *   declarative data, plus a *proposed* scoring explanation. No solver.
 *
 * The package is pure: given the same inputs it returns the same outputs, on every platform. That
 * is what lets the prototype's figures be asserted in tests rather than eyeballed on a screen.
 */
export * from './facts/index.ts';
export * from './targets/index.ts';
export * from './planner/index.ts';
