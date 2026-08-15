import { REPOSITORY_SURFACE, REPOSITORY_SURFACE_KEYS } from '@healthy360/api-client';
import type { CursorPage, Repositories, RepositorySurfaceKey } from '@healthy360/api-client';

/**
 * Typed stub repositories for screen tests.
 *
 * The replacement for the deleted mock world: a fully-shaped `Repositories` bundle built from the
 * contract surface table, where every method a test did not explicitly stub rejects loudly with
 * {@link StubNotConfiguredError}. A screen that reaches for data its test never declared fails on
 * the first render with the repository and method named, instead of silently rendering an empty
 * state over a hole in the test.
 *
 * Every method — stubbed or not — is a `jest.fn()`, so mutation assertions read directly off the
 * bundle: `expect(harness.repositories.commerce.addCartItem).toHaveBeenCalledWith(...)`. That is
 * the replacement for the mock stores' reach-ins.
 *
 * `kind` is `'api'`, not `'mock'`: screens gate mock-only surfaces on `repositories.kind`, and a
 * test must see exactly what production sees.
 */

export class StubNotConfiguredError extends Error {
    constructor(surface: string) {
        super(
            `${surface} is not stubbed in this test. Pass an implementation via ` +
                `createStubRepositories({ ... }) if the screen under test is supposed to call it.`,
        );
        this.name = 'StubNotConfiguredError';
    }
}

/** Per-repository, per-method overrides. Anything omitted rejects with StubNotConfiguredError. */
export type RepositoryOverrides = {
    readonly [K in RepositorySurfaceKey]?: Partial<Repositories[K]>;
};

export interface CreateStubRepositoriesOptions {
    /**
     * Round-trip applied to every *stubbed* method, in ms. Defaults to 0 here; the screen harness
     * passes 25 so loading frames stay deterministically observable (see `stub-screen.tsx`).
     * Unstubbed methods always reject immediately — a hole in a test should fail fast.
     */
    readonly latencyMs?: number | undefined;
}

type AnyFn = (...args: never[]) => unknown;

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export function createStubRepositories(
    overrides: RepositoryOverrides = {},
    options: CreateStubRepositoriesOptions = {},
): Repositories {
    const latencyMs = options.latencyMs ?? 0;
    const bundle: Record<string, unknown> = { kind: 'api' };

    for (const key of REPOSITORY_SURFACE_KEYS) {
        const surface: readonly string[] = REPOSITORY_SURFACE[key];
        const provided = (overrides[key] ?? {}) as Readonly<Record<string, unknown>>;

        for (const method of Object.keys(provided)) {
            if (!surface.includes(method)) {
                throw new Error(
                    `createStubRepositories: ${key}.${method} is not a contract method — ` +
                        `check the override for a typo (known: ${surface.join(', ')}).`,
                );
            }
        }

        const repository: Record<string, jest.Mock> = {};
        for (const method of surface) {
            const implementation = provided[method];
            repository[method] =
                typeof implementation === 'function'
                    ? jest.fn(async (...args: never[]) => {
                          if (latencyMs > 0) await wait(latencyMs);
                          return (implementation as AnyFn)(...args);
                      })
                    : jest.fn(() => Promise.reject(new StubNotConfiguredError(`${key}.${method}`)));
        }
        bundle[key] = repository;
    }

    return bundle as unknown as Repositories;
}

/**
 * A stepped implementation: the first call answers with the first step, the second with the
 * second, and so on — for flows where the same call must answer differently per attempt (login →
 * challenge → success, retry-after-rate-limit). A step that is an `Error` (or a function that
 * throws/rejects) rejects that call. Calls past the last step reject with
 * {@link StubNotConfiguredError}, because a flow that calls more often than its test scripted is a
 * finding, not a loop.
 */
export function sequence<T>(
    ...steps: readonly (T | Error | (() => T | Promise<T>))[]
): () => Promise<T> {
    let index = 0;
    return async () => {
        const step = steps[index];
        index += 1;
        if (index > steps.length)
            throw new StubNotConfiguredError(`sequence step ${String(index)}`);
        if (step instanceof Error) throw step;
        if (typeof step === 'function') return (step as () => T | Promise<T>)();
        return step as T;
    };
}

/** A one-page `CursorPage` over authored items — the envelope every listing answers with. */
export function page<T>(
    items: readonly T[],
    options: { readonly nextCursor?: string | null; readonly totalCount?: number | null } = {},
): CursorPage<T> {
    const nextCursor = options.nextCursor ?? null;
    return {
        items,
        nextCursor,
        hasMore: nextCursor !== null,
        totalCount: options.totalCount === undefined ? items.length : options.totalCount,
    };
}
