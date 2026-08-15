import { describe, expect, it } from 'vitest';

import { asApiFailure } from '../contracts/failure.ts';
import { REPOSITORY_SURFACE } from '../contracts/repository-surface.ts';
import type { Repositories } from '../contracts/index.ts';

/**
 * The shared contract harness for the prototype repository families.
 *
 * Rehomed from `mock/prototype/repository-contract.ts` so the api-side guarantees — the surface
 * drift check and "every prototype stub rejects with `prototype.not_implemented`" — do not live in
 * the tree they are guarding against. The mock wrapper adds its behavioural half on top while it
 * exists; this file owns everything both callers share.
 */

/**
 * The nine keys this harness covers — and why `platformAdmin` (PA1) is not among them.
 *
 * Membership of this list means "the API implementation is (or began as) a stub that must reject
 * with `prototype.not_implemented`", which is what {@link describeApiRejections} asserts for every
 * method. `platformAdmin` was born real: its seven routes shipped in the same phase as its
 * contract, and its API repository issues genuine requests. Listing it here would assert that it
 * fails, which is the opposite of true.
 *
 * That is the same reason `guest`, `account`, `verification`, `b2bApplication` and `kitchenOps` are
 * absent. Their drift protection is `repository-surface.ts`, whose table covers every repository in
 * the bundle and is checked against the real api bundle in `repository-surface.test.ts`.
 */
export const REPOSITORY_KEYS = [
    'marketplace',
    'nutrition',
    'planner',
    'foods',
    'virtualDietitian',
    'commerce',
    'business',
    'professional',
    'kitchenAdmin',
] as const;

export type RepositoryKey = (typeof REPOSITORY_KEYS)[number];

/**
 * Every method each prototype-family contract declares — a nine-key view over the full
 * {@link REPOSITORY_SURFACE} table, which is the single hand-maintained copy.
 */
export const CONTRACT_METHODS: Readonly<Record<RepositoryKey, readonly string[]>> = {
    marketplace: REPOSITORY_SURFACE.marketplace,
    nutrition: REPOSITORY_SURFACE.nutrition,
    planner: REPOSITORY_SURFACE.planner,
    foods: REPOSITORY_SURFACE.foods,
    virtualDietitian: REPOSITORY_SURFACE.virtualDietitian,
    commerce: REPOSITORY_SURFACE.commerce,
    business: REPOSITORY_SURFACE.business,
    professional: REPOSITORY_SURFACE.professional,
    kitchenAdmin: REPOSITORY_SURFACE.kitchenAdmin,
};

export const CONTRACT_METHOD_COUNT = REPOSITORY_KEYS.reduce(
    (total, key) => total + CONTRACT_METHODS[key].length,
    0,
);

/**
 * The bundle shape the harness runs against — structural, so any object satisfying the nine
 * contracts qualifies, with no dependency on either implementation.
 */
export type PrototypeRepositoryBundle = Pick<Repositories, RepositoryKey>;

export type RepositoryContractMode = 'mock' | 'api';

export interface RepositoryContractOptions {
    /** Appears in the test names, e.g. `mock bundle` or `api bundle`. */
    readonly name: string;
    readonly mode: RepositoryContractMode;
    /** A fresh bundle. Called per test, so no test can be affected by another's mutations. */
    readonly create: () => PrototypeRepositoryBundle;
}

export function methodsOf(repository: object): readonly [string, (...args: never[]) => unknown][] {
    return Object.entries(repository).filter(
        (entry): entry is [string, (...args: never[]) => unknown] => typeof entry[1] === 'function',
    );
}

/** The surface half: catches drift between a contract and a bundle, in either direction. */
export function describeContractSurface(options: RepositoryContractOptions): void {
    const { name, create } = options;

    describe(`${name} — contract surface`, () => {
        it.each(REPOSITORY_KEYS)('%s declares exactly the methods the contract promises', (key) => {
            const repository = create()[key];
            const names = methodsOf(repository)
                .map(([method]) => method)
                .sort();
            expect(names).toEqual([...CONTRACT_METHODS[key]].sort());
        });

        it('covers every repository in the bundle', () => {
            const bundle = create();
            for (const key of REPOSITORY_KEYS) expect(bundle[key]).toBeDefined();
        });
    });
}

/** The api half: every method on every prototype family rejects, nameably, without a network. */
export function describeApiRejections(options: RepositoryContractOptions): void {
    const { name, create } = options;

    describe(`${name} — every method rejects prototype.not_implemented`, () => {
        for (const key of REPOSITORY_KEYS) {
            const methods = CONTRACT_METHODS[key];
            it.each(methods)(`${key}.%s`, async (method) => {
                const repository = create()[key] as unknown as Record<
                    string,
                    (...args: never[]) => unknown
                >;
                const call = repository[method];
                expect(typeof call).toBe('function');

                // Called with no arguments on purpose: a stub that reached for one would be
                // doing something, and these are meant to do nothing but reject.
                const outcome = await Promise.resolve(call?.call(repository)).then(
                    () => null,
                    (error: unknown) => asApiFailure(error),
                );

                expect(outcome, `${key}.${method} resolved instead of rejecting`).not.toBeNull();
                expect(outcome?.code).toBe('prototype.not_implemented');
                expect(outcome?.retryable).toBe(false);
                expect(outcome?.message).toContain('/api/v1/');
            });
        }
    });
}

/**
 * The shared entry point: surface check always, rejection check in api mode. The mock bundle's
 * behavioural half lives with the mock (`mock/prototype/repository-contract.ts`) and runs on top.
 */
export function describeRepositoryContract(options: RepositoryContractOptions): void {
    describeContractSurface(options);
    if (options.mode === 'api') describeApiRejections(options);
}
