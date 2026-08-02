import { isPlanDurationConsistent } from '@healthy360/api-client/contracts';
import type {
    LocalisedText,
    PlanCombination,
    PlanDurationAdmin,
    PlanDurationKind,
    PlanVariantAdmin,
    PlanVariantInput,
} from '@healthy360/api-client/contracts';
import type { PlanVariantId } from '@healthy360/domain-types';

import { combinationKey, energyBandKey } from './format.ts';

/**
 * The model behind the plan editor's variant matrix and its duration rows (K1.6).
 *
 * Pure, and in its own module for the reason every `format.ts` in this codebase exists: the
 * interesting decisions here — what a cell *is*, what toggling one does, what a duration row may
 * hold — are the ones a test should be able to make assertions about without rendering a tree.
 *
 * ## What the matrix actually is, in this contract
 *
 * The source material describes a plan as a matrix: meal combinations down one axis, energy bands
 * across the other, and a cell that either is sold or is not. The contract expresses that with **two
 * entities and no third**:
 *
 * * {@link PlanCombination} — a kitchen-set `code`, a label, and the `mealsPerDay`/`snacksPerDay`
 *   pair it stands for. Replaced wholesale by `setPlanCombinations`.
 * * {@link PlanVariantAdmin} — an identifier, a name, an `energyBand`, and its own
 *   `mealsPerDay`/`snacksPerDay`. Replaced wholesale by `setPlanVariants`.
 *
 * There is **no `tier` field and no energy-band entity**, so this editor invents neither. A variant
 * does not point at a combination; it carries the same meals/snacks pair, and that pair — nothing
 * else — is what puts it in a row (see {@link combinationKey}). The columns are the distinct
 * `energyBand` values the variants themselves carry, plus any the person has added while editing.
 * "Standard / Premium" in the source is a *combination code*, which is why it is a row here and not
 * a third axis: adding one would mean writing a field the server has never published.
 *
 * **Variant existence is the availability matrix.** A cell a kitchen does not sell is not a flag on
 * a row, it is a variant that is not in the array — which is precisely why `setPlanVariants` being a
 * whole-set replacement is what makes a toggle expressible at all.
 *
 * ## The vocabulary is the union of what is declared and what exists
 *
 * Rows come from the declared combinations *and* from any shape a variant already carries; columns
 * come from the added bands *and* from any band a variant already carries. So the grid can never
 * hide a variant, which is the failure mode a matrix editor has to be built to avoid: a
 * configuration that exists, is priced and is sold, and is invisible in the screen that governs it
 * because nobody declared its row.
 */

/* ------------------------------------------------------------------------------------------------
 * Working copies
 * ---------------------------------------------------------------------------------------------- */

/**
 * A variant as the editor holds it.
 *
 * Numbers rather than the string drafts the recipe and price editors use, because every numeric
 * field here is edited through `NumberStepper`, which hands back `number | null` and has no
 * half-typed state to preserve. `null` is "not answered", which the contract does not allow on the
 * wire — so a `null` blocks the save rather than being sent as a zero.
 */
export interface VariantDraft {
    /** Stable across moves, removals and undo. Never the array index. */
    readonly key: string;
    /** `null` for a variant this session created; the server mints the identifier. */
    readonly id: PlanVariantId | null;
    readonly name: LocalisedText;
    readonly mealsPerDay: number | null;
    readonly snacksPerDay: number | null;
    readonly energyMin: number | null;
    readonly energyMax: number | null;
    readonly isActive: boolean;
}

/** A combination as the editor holds it — one row of the matrix. */
export interface CombinationDraft {
    readonly key: string;
    readonly code: string;
    readonly label: LocalisedText;
    readonly mealsPerDay: number | null;
    readonly snacksPerDay: number | null;
    readonly isAvailable: boolean;
}

/** A duration as the editor holds it. */
export interface DurationDraft {
    readonly key: string;
    readonly kind: PlanDurationKind;
    /** Whole days for `fixed_days`; always `null` for `one_off` — see {@link withDurationKind}. */
    readonly days: number | null;
    /** Whole percent off, or `null` for "nobody has decided yet". **Never `0` as a stand-in.** */
    readonly discountPercent: number | null;
}

export function variantDraft(variant: PlanVariantAdmin, index: number): VariantDraft {
    return {
        key: `seed-variant-${String(index)}-${String(variant.id)}`,
        id: variant.id,
        name: variant.name,
        mealsPerDay: variant.mealsPerDay,
        snacksPerDay: variant.snacksPerDay,
        energyMin: variant.energyBand.min,
        energyMax: variant.energyBand.max,
        isActive: variant.isActive,
    };
}

export function combinationDraft(combination: PlanCombination, index: number): CombinationDraft {
    return {
        key: `seed-combination-${String(index)}-${combination.code}`,
        code: combination.code,
        label: combination.label,
        mealsPerDay: combination.mealsPerDay,
        snacksPerDay: combination.snacksPerDay,
        isAvailable: combination.isAvailable,
    };
}

export function durationDraft(duration: PlanDurationAdmin, index: number): DurationDraft {
    return {
        key: `seed-duration-${String(index)}-${duration.kind}-${String(duration.days ?? 'x')}`,
        kind: duration.kind,
        days: duration.days,
        discountPercent: duration.discountPercent,
    };
}

/** A blank combination row. Meals default to one because a combination of nothing is not one. */
export function emptyCombination(key: string): CombinationDraft {
    return {
        key,
        code: '',
        label: { en: '', ar: '' },
        mealsPerDay: 1,
        snacksPerDay: 0,
        isAvailable: true,
    };
}

/**
 * A blank duration row.
 *
 * `fixed_days` with no day count, and a `null` discount. Neither is a placeholder value pretending
 * to be an answer: the row is incomplete and says so until a positive count is typed, and the
 * discount stays "not set" until somebody sets it (appendix D — discount NULL when unknown).
 */
export function emptyDuration(key: string): DurationDraft {
    return { key, kind: 'fixed_days', days: null, discountPercent: null };
}

/* ------------------------------------------------------------------------------------------------
 * The grid
 * ---------------------------------------------------------------------------------------------- */

/** One column of the matrix — an advertised energy band, kcal per day. */
export interface MatrixBand {
    /** {@link energyBandKey} of the band. */
    readonly key: string;
    readonly min: number;
    readonly max: number;
    /** True for a band this session added that no variant occupies yet. */
    readonly isDeclaredOnly: boolean;
}

/** One row of the matrix — a meals/snacks shape, named by its combination when one declares it. */
export interface MatrixRow {
    /** {@link combinationKey} of the shape. */
    readonly key: string;
    readonly mealsPerDay: number;
    readonly snacksPerDay: number;
    /**
     * The combination that declares this shape, or `null` for a shape only a variant carries.
     *
     * A row with no combination is not an error — it is a plan whose variants got ahead of its
     * declared matrix, which is exactly what an import produces — and it is drawn rather than
     * hidden, because a hidden row is a configuration nobody can find.
     */
    readonly combination: CombinationDraft | null;
}

/**
 * The columns: every band a variant carries, plus every band the person has declared.
 *
 * Sorted by lower bound then upper, so the grid reads light-to-generous the way the source
 * material's own tables do. A band with `null` on either side is not a band yet and is left out
 * rather than sorted as a zero.
 */
export function matrixBands(
    variants: readonly VariantDraft[],
    declared: readonly { readonly min: number; readonly max: number }[],
): readonly MatrixBand[] {
    const bands = new Map<string, MatrixBand>();

    for (const band of declared) {
        const key = energyBandKey(band);
        bands.set(key, { key, min: band.min, max: band.max, isDeclaredOnly: true });
    }

    for (const variant of variants) {
        if (variant.energyMin === null || variant.energyMax === null) continue;
        const band = { min: variant.energyMin, max: variant.energyMax };
        bands.set(energyBandKey(band), {
            key: energyBandKey(band),
            ...band,
            isDeclaredOnly: false,
        });
    }

    return [...bands.values()].sort((left, right) =>
        left.min === right.min ? left.max - right.max : left.min - right.min,
    );
}

/**
 * The rows: every declared combination, plus every shape a variant carries that none declares.
 *
 * Declared combinations keep their authored order — the matrix is a hand-written table and its order
 * is a decision — and undeclared shapes follow, sorted, so a new one always appears in the same
 * place rather than wherever the variant array happens to put it.
 */
export function matrixRows(
    combinations: readonly CombinationDraft[],
    variants: readonly VariantDraft[],
): readonly MatrixRow[] {
    const rows = new Map<string, MatrixRow>();

    for (const combination of combinations) {
        if (combination.mealsPerDay === null || combination.snacksPerDay === null) continue;
        const shape = {
            mealsPerDay: combination.mealsPerDay,
            snacksPerDay: combination.snacksPerDay,
        };
        const key = combinationKey(shape);
        // Two combinations may legitimately share a shape (a rename in progress, or a "Standard"
        // and a "Premium" of the same size). The first one names the row; both stay in the list.
        if (!rows.has(key)) rows.set(key, { key, ...shape, combination });
    }

    const undeclared: MatrixRow[] = [];
    for (const variant of variants) {
        if (variant.mealsPerDay === null || variant.snacksPerDay === null) continue;
        const shape = { mealsPerDay: variant.mealsPerDay, snacksPerDay: variant.snacksPerDay };
        const key = combinationKey(shape);
        if (rows.has(key) || undeclared.some((row) => row.key === key)) continue;
        undeclared.push({ key, ...shape, combination: null });
    }

    undeclared.sort((left, right) =>
        left.mealsPerDay === right.mealsPerDay
            ? left.snacksPerDay - right.snacksPerDay
            : left.mealsPerDay - right.mealsPerDay,
    );

    return [...rows.values(), ...undeclared];
}

/** The variants sitting in one cell. More than one is legitimate — see {@link toggleCell}. */
export function cellVariants(
    variants: readonly VariantDraft[],
    row: MatrixRow,
    band: MatrixBand,
): readonly VariantDraft[] {
    return variants.filter(
        (variant) =>
            variant.mealsPerDay === row.mealsPerDay &&
            variant.snacksPerDay === row.snacksPerDay &&
            variant.energyMin === band.min &&
            variant.energyMax === band.max,
    );
}

/**
 * Toggles a cell's existence, returning the new variant array.
 *
 * An empty cell gains one variant, carrying the row's meals/snacks and the column's band; a filled
 * cell loses **every** variant in it. The second half is why the removal is undoable at the call
 * site: a cell can hold more than one configuration — the seeded family plan sells one meal a day
 * at one band in three household sizes — and a toggle that silently discarded three rows without an
 * undo would be a trap.
 *
 * Pure, and exported so the round trip can be asserted without rendering anything: it is the single
 * most important line of behaviour in this slice.
 */
export function toggleCell(
    variants: readonly VariantDraft[],
    row: MatrixRow,
    band: MatrixBand,
    added: { readonly key: string; readonly name: LocalisedText },
): readonly VariantDraft[] {
    const occupants = cellVariants(variants, row, band);
    if (occupants.length > 0) {
        const removed = new Set(occupants.map((variant) => variant.key));
        return variants.filter((variant) => !removed.has(variant.key));
    }

    return [
        ...variants,
        {
            key: added.key,
            id: null,
            name: added.name,
            mealsPerDay: row.mealsPerDay,
            snacksPerDay: row.snacksPerDay,
            energyMin: band.min,
            energyMax: band.max,
            isActive: true,
        },
    ];
}

/* ------------------------------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------------------------------- */

export interface VariantMessages {
    readonly nameRequired: string;
    readonly servingsRequired: string;
    readonly energyRequired: string;
    readonly energyReversed: string;
}

/**
 * What is wrong with each variant, keyed by row.
 *
 * Four rules, each of which the contract's own shape states:
 *
 * 1. **A variant needs an English name.** `LocalisedText` requires both languages, and the readiness
 *    evaluator refuses to publish a record whose translations are incomplete — but a *draft* with no
 *    Arabic is legitimate and common (an import arrives in one language). So English blocks the save
 *    and Arabic only blocks publication, exactly as every other bilingual field here behaves.
 * 2. **Meals and snacks per day are numbers, and at least one meal or snack has to be served.** A
 *    configuration of nothing per day is not a configuration.
 * 3. **An energy band needs both bounds**, because `energyBand` has no nullable side.
 * 4. **The band may not run backwards.** A 1,900–1,600 kcal band is a typo, and a filter comparing
 *    against it would silently match nothing.
 */
export function variantErrors(
    rows: readonly VariantDraft[],
    messages: VariantMessages,
): ReadonlyMap<string, string> {
    const errors = new Map<string, string>();

    for (const row of rows) {
        if (row.name.en.trim() === '') {
            errors.set(row.key, messages.nameRequired);
            continue;
        }
        if (
            row.mealsPerDay === null ||
            row.snacksPerDay === null ||
            row.mealsPerDay < 0 ||
            row.snacksPerDay < 0 ||
            row.mealsPerDay + row.snacksPerDay < 1
        ) {
            errors.set(row.key, messages.servingsRequired);
            continue;
        }
        if (row.energyMin === null || row.energyMax === null || row.energyMin <= 0) {
            errors.set(row.key, messages.energyRequired);
            continue;
        }
        if (row.energyMax < row.energyMin) errors.set(row.key, messages.energyReversed);
    }

    return errors;
}

export interface CombinationMessages {
    readonly codeRequired: string;
    readonly codeDuplicate: string;
    readonly labelRequired: string;
    readonly servingsRequired: string;
}

/**
 * What is wrong with each combination, keyed by row.
 *
 * The code is the identity — `PlanCombination` is "keyed by a kitchen-set `code` rather than an
 * identifier" — so two rows sharing one is not untidy, it is ambiguous, and the set-replace would
 * make one of them disappear on the next read.
 */
export function combinationErrors(
    rows: readonly CombinationDraft[],
    messages: CombinationMessages,
): ReadonlyMap<string, string> {
    const errors = new Map<string, string>();
    const seen = new Set<string>();

    for (const row of rows) {
        const code = row.code.trim();
        if (code === '') {
            errors.set(row.key, messages.codeRequired);
            continue;
        }
        if (seen.has(code.toLocaleUpperCase())) {
            errors.set(row.key, messages.codeDuplicate);
            continue;
        }
        seen.add(code.toLocaleUpperCase());

        if (row.label.en.trim() === '') {
            errors.set(row.key, messages.labelRequired);
            continue;
        }
        if (
            row.mealsPerDay === null ||
            row.snacksPerDay === null ||
            row.mealsPerDay < 0 ||
            row.snacksPerDay < 0 ||
            row.mealsPerDay + row.snacksPerDay < 1
        ) {
            errors.set(row.key, messages.servingsRequired);
        }
    }

    return errors;
}

export interface DurationMessages {
    readonly daysRequired: string;
    readonly duplicate: string;
    readonly discountInvalid: string;
}

/**
 * What is wrong with each duration, keyed by row.
 *
 * Rule one is the migration's `CHECK`, stated by the contract as {@link isPlanDurationConsistent}
 * and re-checked here rather than assumed: {@link withDurationKind} makes an inconsistent row
 * unreachable through the controls, but a draft can also arrive from the server.
 *
 * Rule two is the duplicate: two `one_off` rows, or two 20-day rows, are one option offered twice,
 * and the set-replace would keep both.
 */
export function durationErrors(
    rows: readonly DurationDraft[],
    messages: DurationMessages,
): ReadonlyMap<string, string> {
    const errors = new Map<string, string>();
    const seen = new Set<string>();

    for (const row of rows) {
        const consistent = isPlanDurationConsistent({
            kind: row.kind,
            days: row.days,
            discountPercent: row.discountPercent,
        });
        if (!consistent) {
            errors.set(row.key, messages.daysRequired);
            continue;
        }

        const identity = `${row.kind}:${String(row.days ?? '')}`;
        if (seen.has(identity)) {
            errors.set(row.key, messages.duplicate);
            continue;
        }
        seen.add(identity);

        if (
            row.discountPercent !== null &&
            (row.discountPercent < 0 || row.discountPercent > 100)
        ) {
            errors.set(row.key, messages.discountInvalid);
        }
    }

    return errors;
}

/**
 * Applies a kind change to a duration row, clearing the day count the way the `CHECK` requires.
 *
 * Pure and exported so the rule can be asserted without rendering anything — it is the duration
 * half's equivalent of the price editor's `withPriceStatus`. Moving to `one_off` empties the day
 * count, because a single delivery has none; moving to `fixed_days` leaves it empty for the person
 * to fill in, so the row is *incomplete* rather than quietly seven days long.
 *
 * The discount is untouched in both directions: what a commitment earns is a commercial decision
 * that has nothing to do with how it is measured.
 */
export function withDurationKind(row: DurationDraft, kind: PlanDurationKind): DurationDraft {
    return { ...row, kind, days: kind === 'one_off' ? null : row.days };
}

/* ------------------------------------------------------------------------------------------------
 * Requests
 * ---------------------------------------------------------------------------------------------- */

/**
 * The matrix as `setPlanVariants` takes it.
 *
 * Called only once {@link variantErrors} is empty, so the narrowing cannot fail — but it is not
 * asserted away: a row that somehow arrives here without a number is dropped rather than sent with
 * a fabricated zero, which is the same rule the price editor applies to a missing amount.
 */
export function variantRequest(rows: readonly VariantDraft[]): readonly PlanVariantInput[] {
    return rows.flatMap((row) => {
        if (
            row.mealsPerDay === null ||
            row.snacksPerDay === null ||
            row.energyMin === null ||
            row.energyMax === null
        ) {
            return [];
        }
        return [
            {
                id: row.id,
                name: row.name,
                energyBand: { min: row.energyMin, max: row.energyMax },
                mealsPerDay: row.mealsPerDay,
                snacksPerDay: row.snacksPerDay,
                isActive: row.isActive,
            },
        ];
    });
}

export function combinationRequest(rows: readonly CombinationDraft[]): readonly PlanCombination[] {
    return rows.flatMap((row) => {
        if (row.mealsPerDay === null || row.snacksPerDay === null) return [];
        return [
            {
                code: row.code.trim(),
                label: row.label,
                mealsPerDay: row.mealsPerDay,
                snacksPerDay: row.snacksPerDay,
                isAvailable: row.isAvailable,
            },
        ];
    });
}

/**
 * The duration rows as `setPlanDurations` takes them.
 *
 * `discountPercent` passes through **unchanged**, `null` included. That is the whole point: a
 * request that turned an undecided discount into `0` would record a commercial decision nobody made
 * (appendix D — `plan_variant_durations`, discount NULL when unknown).
 */
export function durationRequest(rows: readonly DurationDraft[]): readonly PlanDurationAdmin[] {
    return rows.flatMap((row) => {
        if (row.kind === 'fixed_days' && row.days === null) return [];
        return [
            {
                kind: row.kind,
                days: row.kind === 'one_off' ? null : row.days,
                discountPercent: row.discountPercent,
            },
        ];
    });
}
