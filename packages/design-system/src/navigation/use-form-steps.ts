import { useCallback, useMemo, useState } from 'react';

export interface FormStepsOptions<Key extends string> {
    /** The step the form opens on. The first key by default. */
    readonly initial?: Key | undefined;
}

export interface FormSteps<Key extends string> {
    /** The step being shown. Always one of the keys passed this render. */
    readonly current: Key;
    /** Zero-based position of {@link current} — what `StepProgress` takes as `current`. */
    readonly index: number;
    readonly total: number;
    readonly isFirst: boolean;
    readonly isLast: boolean;
    /** Positions of the steps that have been left at least once — `StepProgress`'s `completed`. */
    readonly completed: ReadonlySet<number>;
    /**
     * Move to a step, marking the one being left as complete. A key not in the list is ignored.
     *
     * Method syntax on purpose: it keeps a `FormSteps<'identity' | 'packs'>` assignable where a
     * shared frame takes `FormSteps<string>`, which a function-typed property would refuse.
     */
    goTo(key: Key): void;
    /** {@link goTo} by position — `StepProgress`'s `onSelect`. Out of range is ignored. */
    readonly goToIndex: (index: number) => void;
    readonly next: () => void;
    readonly previous: () => void;
    /** Back to the opening step with nothing complete — a form started again. */
    readonly reset: () => void;
}

/**
 * The state of a multi-step form: which step is open, and which have been left.
 *
 * The third part of the multi-step form, with {@link StepProgress} (how a reader *jumps*) and
 * `FormNavigation` (how they *work through*). Every "New …" form in the kitchen admin is built from
 * the three; the recipe editor and the order desk's New sale are the references.
 *
 * ```ts
 * const form = useFormSteps(['description', 'production', 'costing'] as const);
 *
 * <StepProgress steps={…} current={form.index} completed={form.completed} onSelect={form.goToIndex} divided />
 * {form.current === 'description' ? <DescriptionStep /> : null}
 * <FormNavigation previousDisabled={form.isFirst} onPrevious={form.previous} … />
 * ```
 *
 * ## Keyed, not indexed
 *
 * The step list may change under the form — the New sale drops Customer and Address for a counter
 * sale, and a recipe on a sauce route has no Packaging. State held as an index would then point at a
 * different step than the one somebody was on, and a completed set of indices would tick the wrong
 * dots. So both are held by key, and positions are derived from whatever list this render passed.
 *
 * A current key that has left the list falls back to the nearest step at or before where it was,
 * which is where a form whose shape changed should land — not back at the start. A form with its own
 * rule for that (the sale's `clampStep`) calls {@link goTo} with the answer instead.
 *
 * ## Complete means left, not valid
 *
 * A step is complete once the reader has moved off it. Whether the form may be *submitted* is the
 * form's own check on its last step; the dots only say where somebody has been.
 */
export function useFormSteps<Key extends string>(
    keys: readonly Key[],
    options: FormStepsOptions<Key> = {},
): FormSteps<Key> {
    const opening = options.initial ?? keys[0];
    const [held, setHeld] = useState<{ readonly key: Key | undefined; readonly index: number }>(
        () => ({
            key: opening,
            index: Math.max(0, opening === undefined ? 0 : keys.indexOf(opening)),
        }),
    );
    const [visited, setVisited] = useState<ReadonlySet<Key>>(() => new Set());

    const last = Math.max(keys.length - 1, 0);
    const found = held.key === undefined ? -1 : keys.indexOf(held.key);
    const index = found >= 0 ? found : Math.min(held.index, last);
    const current = keys[index] as Key;

    const goToIndex = useCallback(
        (target: number) => {
            if (target < 0 || target > last || target === index) return;
            const key = keys[target];
            if (key === undefined) return;
            setVisited((previous) => new Set(previous).add(current));
            setHeld({ key, index: target });
        },
        [keys, last, index, current],
    );

    const goTo = useCallback(
        (key: Key) => {
            goToIndex(keys.indexOf(key));
        },
        [keys, goToIndex],
    );

    const reset = useCallback(() => {
        setVisited(new Set());
        setHeld({ key: opening, index: 0 });
    }, [opening]);

    const completed = useMemo<ReadonlySet<number>>(
        () => new Set(keys.flatMap((key, position) => (visited.has(key) ? [position] : []))),
        [keys, visited],
    );

    return {
        current,
        index,
        total: keys.length,
        isFirst: index === 0,
        isLast: index === last,
        completed,
        goTo,
        goToIndex,
        next: () => {
            goToIndex(index + 1);
        },
        previous: () => {
            goToIndex(index - 1);
        },
        reset,
    };
}
