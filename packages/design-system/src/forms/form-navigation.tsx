import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { Button } from '../actions/button.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { ShellDock, useShellDockAvailable } from '../shell/shell-dock.tsx';

export interface FormNavigationProps {
    readonly previousLabel: string;
    readonly onPrevious: () => void;
    /** On the first step. The control stays drawn, so the row never changes width as it is walked. */
    readonly previousDisabled?: boolean | undefined;
    /** "Step 2 of 5 · Production" — the caller's translation, centred. */
    readonly counter: string;
    /**
     * The end of the row: `Save draft` and `Next`, or `Save draft` and the form's final commit on
     * the last step. The caller swaps them — this component does not know which step is last.
     */
    readonly actions: ReactNode;
    /**
     * Dock the row to the bottom edge of the page, where it stays put: drawn by the shell below its
     * scroll port (`ShellDock`), so nothing scrolls under it and it never rides up with the end of a
     * form. With no shell around — a screen in a unit test — it falls back to `web:sticky` in place,
     * on its own `z-sticky` layer so a line table passes under it rather than over it.
     */
    readonly sticky?: boolean | undefined;
    readonly previousTestID?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * The footer of a multi-step form: Previous at the start, the step counter centred, the step's
 * actions at the end.
 *
 * ```
 * [‹ Previous]            Step 2 of 5 · Production            [Save draft] [Next ›]
 * ```
 *
 * Paired with {@link StepProgress}, which is how a reader *jumps*; this row is how they *work
 * through*. The three slots are a `flex-row` with a flexible centre, so in Arabic Previous sits on the
 * right and the actions on the left with nothing mirrored by hand.
 */
export function FormNavigation({
    previousLabel,
    onPrevious,
    previousDisabled = false,
    counter,
    actions,
    sticky = false,
    previousTestID,
    className,
    testID,
}: FormNavigationProps) {
    const docked = useShellDockAvailable();

    const bar = (
        <View
            testID={testID}
            className={cx(
                'flex-row items-center gap-snug border-t border-stroke-subtle bg-surface-raised px-base py-tight',
                sticky && !docked ? 'z-sticky mt-auto web:sticky web:bottom-0' : null,
                className,
            )}
        >
            <Button
                testID={previousTestID}
                variant="secondary"
                iconStart={<Icon name="chevronStart" size="sm" />}
                label={previousLabel}
                disabled={previousDisabled}
                onPress={onPrevious}
            />
            <RNText
                testID={testID === undefined ? undefined : `${testID}-counter`}
                numberOfLines={1}
                className="min-w-0 flex-1 text-center text-role-caption text-content-secondary"
            >
                {counter}
            </RNText>
            <View className="flex-row items-center gap-tight">{actions}</View>
        </View>
    );

    return sticky ? <ShellDock>{bar}</ShellDock> : bar;
}
