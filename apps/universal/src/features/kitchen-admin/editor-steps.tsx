import { Button, FormNavigation, Icon, StepProgress } from '@healthy360/design-system';
import type { FormSteps, TabItem } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The kitchen admin's multi-step form, as one pair: the progress row that opens the form and the
 * footer that walks it.
 *
 * ```
 *  (✓)━━━━━━━(2)───────(3)───────(4)
 * Identity  Measurement  Sale  Nutrition
 * ───────────────────────────────────────  <- `divided`
 *   …the open step's fields…
 * [‹ Previous]     Step 2 of 4 · Measurement     [Next ›]   <- `Save` on the last step
 * ```
 *
 * Built on `useFormSteps`, `StepProgress` and `FormNavigation` so a "New …" form states only its
 * steps and its save. `EditorFrame` takes the same props as `steps` and draws both for the editors
 * inside it; a screen that owns its own chrome (the ingredient editor) draws the two parts itself.
 *
 * Every step stays reachable from the row — a step is complete once left, and the save's own checks
 * are the gate — so a form that has to stop a reader moving on disables the steps ahead of it.
 *
 * A form of one step draws neither part: a single dot is not a sequence, and the form's own Save
 * already finishes it. The new supplier is the case — Details alone until the first save.
 */

export interface EditorStep<Key extends string> {
    readonly key: Key;
    /** Translated. */
    readonly label: string;
    /** Not reachable from the row yet. */
    readonly disabled?: boolean | undefined;
}

export interface EditorStepsProps<Key extends string> {
    readonly form: FormSteps<Key>;
    readonly steps: readonly EditorStep<Key>[];
    /**
     * The last step's commit — the form's Save or Create. Drawn in place of Next, so the reader who
     * walked the whole form finishes it where they are rather than scrolling back to the header.
     */
    readonly finalAction?: ReactNode | undefined;
    /** Row: `{testID}`, steps `{testID}-{key}`. Footer: `{testID}-nav`, `-previous`, `-next`. */
    readonly testID: string;
}

export function EditorStepProgress<Key extends string>({
    form,
    steps,
    testID,
}: Omit<EditorStepsProps<Key>, 'finalAction'>) {
    const { t } = useTranslation();

    if (steps.length <= 1) return null;

    return (
        <StepProgress
            testID={testID}
            label={t('kitchen:editor.stepsLabel')}
            steps={steps.map((step) => ({
                key: step.key,
                label: step.label,
                disabled: step.disabled,
                testID: `${testID}-${step.key}`,
            }))}
            current={form.index}
            completed={form.completed}
            onSelect={form.goToIndex}
            divided
        />
    );
}

export function EditorStepNavigation<Key extends string>({
    form,
    steps,
    finalAction,
    testID,
}: EditorStepsProps<Key>) {
    const { t } = useTranslation();
    const nextDisabled = steps[form.index + 1]?.disabled === true;

    if (steps.length <= 1) return null;

    return (
        <FormNavigation
            testID={`${testID}-nav`}
            previousTestID={`${testID}-previous`}
            previousLabel={t('kitchen:editor.previous')}
            previousDisabled={form.isFirst}
            onPrevious={form.previous}
            counter={t('kitchen:editor.stepCounter', {
                current: form.index + 1,
                total: form.total,
                label: steps[form.index]?.label ?? '',
            })}
            sticky
            actions={
                form.isLast ? (
                    finalAction
                ) : (
                    <Button
                        testID={`${testID}-next`}
                        label={t('kitchen:editor.next')}
                        iconEnd={<Icon name="chevronEnd" size="sm" />}
                        disabled={nextDisabled}
                        onPress={form.next}
                    />
                )
            }
        />
    );
}

/**
 * The same footer for a form whose steps are a `Tabs variant="steps"` row rather than
 * `useFormSteps` — the recipe, plan, delivery zone, supplier and supply order pages. The numbered
 * row is how a reader jumps; this is how they walk it, one step at a time, without scrolling back
 * up to the row. A disabled step is skipped, the way the row itself will not open it.
 *
 * On the last step Next stays drawn and disabled unless the caller hands a `finalAction`, so the
 * row keeps its width; the page's own commit is in its header.
 */
export interface TabStepNavigationProps<Key extends string> {
    readonly items: readonly TabItem<Key>[];
    readonly value: Key;
    readonly onChange: (value: Key) => void;
    readonly finalAction?: ReactNode | undefined;
    /** The row. Its buttons are `{testID}-previous` and `{testID}-next`. */
    readonly testID: string;
}

export function TabStepNavigation<Key extends string>({
    items,
    value,
    onChange,
    finalAction,
    testID,
}: TabStepNavigationProps<Key>) {
    const { t } = useTranslation();
    const index = items.findIndex((item) => item.value === value);

    if (items.length <= 1 || index < 0) return null;

    const previous = items
        .slice(0, index)
        .reverse()
        .find((item) => item.disabled !== true);
    const next = items.slice(index + 1).find((item) => item.disabled !== true);

    return (
        <FormNavigation
            testID={testID}
            previousTestID={`${testID}-previous`}
            previousLabel={t('kitchen:editor.previous')}
            previousDisabled={previous === undefined}
            onPrevious={() => {
                if (previous !== undefined) onChange(previous.value);
            }}
            counter={t('kitchen:editor.stepCounter', {
                current: index + 1,
                total: items.length,
                label: items[index]?.label ?? '',
            })}
            sticky
            actions={
                next === undefined && finalAction !== undefined ? (
                    finalAction
                ) : (
                    <Button
                        testID={`${testID}-next`}
                        label={t('kitchen:editor.next')}
                        iconEnd={<Icon name="chevronEnd" size="sm" />}
                        disabled={next === undefined}
                        onPress={() => {
                            if (next !== undefined) onChange(next.value);
                        }}
                    />
                )
            }
        />
    );
}
