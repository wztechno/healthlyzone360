import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { cx } from '../internal/class-names.ts';

export interface StepperProps {
    /** Accessible name for the progress indicator, e.g. "Onboarding progress". */
    readonly label: string;
    /** One-based. Clamped to `[1, total]` so a caller cannot render "step 0 of 22". */
    readonly current: number;
    readonly total: number;
    /** Title of the step the user is on, shown beside the counter when supplied. */
    readonly stepLabel?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Wizard progress.
 *
 * A twenty-two step onboarding flow cannot draw twenty-two labelled dots on a 360 px screen without
 * either overflowing or shrinking each target below the touch minimum, so this is deliberately a
 * *counter plus a bar* rather than a node diagram: "Step 7 of 22" is exact, translatable, reads
 * identically to a screen reader, and costs one line at every viewport.
 *
 * The bar fills from the leading edge because the fill is simply the first child of a `flex-row` —
 * in Arabic the row is laid out right-to-left and the fill grows from the right with no mirrored
 * style anywhere.
 */
export function Stepper({ label, current, total, stepLabel, className, testID }: StepperProps) {
    const { t } = useTranslation();

    const safeTotal = Math.max(1, Math.trunc(total));
    const safeCurrent = Math.min(Math.max(1, Math.trunc(current)), safeTotal);
    const percent = (safeCurrent / safeTotal) * 100;
    const counter = t('designSystem:stepper.progress', { current: safeCurrent, total: safeTotal });

    return (
        <View
            testID={testID}
            role="progressbar"
            accessibilityRole="progressbar"
            aria-label={label}
            accessibilityLabel={label}
            aria-valuemin={1}
            aria-valuemax={safeTotal}
            aria-valuenow={safeCurrent}
            aria-valuetext={counter}
            accessibilityValue={{ min: 1, max: safeTotal, now: safeCurrent, text: counter }}
            className={cx('flex-col gap-1.5', className)}
        >
            <View className="flex-row items-baseline gap-2">
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-counter`}
                    className="text-xs font-medium text-content-secondary text-start"
                >
                    {counter}
                </RNText>
                {stepLabel === undefined ? null : (
                    <RNText
                        testID={testID === undefined ? undefined : `${testID}-step-label`}
                        numberOfLines={1}
                        className="flex-1 text-sm font-semibold text-content-primary text-start"
                    >
                        {stepLabel}
                    </RNText>
                )}
            </View>

            <View
                testID={testID === undefined ? undefined : `${testID}-track`}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                aria-hidden
                className="h-1.5 flex-row overflow-hidden rounded-full bg-surface-sunken"
            >
                <View
                    testID={testID === undefined ? undefined : `${testID}-fill`}
                    className="h-full rounded-full bg-surface-brand"
                    style={{ width: `${percent}%` }}
                />
            </View>
        </View>
    );
}
