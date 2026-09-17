import { Button, FormNavigation, Icon, StepProgress } from '@healthy360/design-system';
import type { FormSteps } from '@healthy360/design-system';
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
