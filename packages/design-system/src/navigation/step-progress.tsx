import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export interface StepProgressItem {
    readonly key: string;
    readonly label: string;
    readonly testID?: string | undefined;
}

export interface StepProgressProps {
    /** Accessible name for the sequence, e.g. "Recipe steps". */
    readonly label: string;
    readonly steps: readonly StepProgressItem[];
    /** Zero-based. Clamped to the step list. */
    readonly current: number;
    /**
     * The steps that have been left at least once. A step is complete once left, not once valid —
     * the publish checks on a form's last step are the gate, not this indicator.
     */
    readonly completed: ReadonlySet<number>;
    /** Every step stays reachable. Omit for a read-only indicator. */
    readonly onSelect?: ((index: number) => void) | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * A multi-step form's progress — numbered dots on a line, the line filled to the current step.
 *
 * ```
 *  (✓)━━━━━━━(2)───────(3)───────(4)───────(5)
 * Description Production Packaging Costing Technical sheet
 * ```
 *
 * The admin handoff's geometry: a 20px dot with a 2px ring, a 2px track, the label on `caption` and
 * never taller than 34px in total. Distinct from {@link Stepper}, which is a counter over a bar for a
 * twenty-two step phone flow where labelled dots cannot fit; a desk form of four or five steps can
 * name every one, and naming them is what makes a completed step worth clicking back to.
 *
 * ## The track runs dot-centre to dot-centre, in either direction
 *
 * Each step takes an equal share of the row, so the first and last centres sit half a share in from
 * the edges. The track is a flex row with a half-share spacer at each end, and the fill is the first
 * child of the track — so in Arabic it grows from the right with nothing mirrored by hand, exactly
 * as `Stepper`'s bar does.
 *
 * Below `sm` the labels drop and the numbers carry the sequence; the counter in the form's footer
 * still names the step.
 */
export function StepProgress({
    label,
    steps,
    current,
    completed,
    onSelect,
    className,
    testID,
}: StepProgressProps) {
    const { t } = useTranslation();

    const total = steps.length;
    const at = Math.min(Math.max(0, Math.trunc(current)), Math.max(total - 1, 0));
    const halfShare = total === 0 ? 0 : 50 / total;
    const filled = total <= 1 ? 0 : (at / (total - 1)) * 100;

    return (
        <View
            testID={testID}
            role="list"
            aria-label={label}
            accessibilityLabel={label}
            className={cx('relative flex-row items-start', className)}
        >
            <View
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                className="absolute start-0 end-0 top-2 h-1 flex-row items-center"
            >
                <View style={{ width: `${halfShare}%` }} />
                <View
                    testID={testID === undefined ? undefined : `${testID}-track`}
                    className="h-0.5 flex-1 flex-row overflow-hidden rounded-full bg-stroke-subtle"
                >
                    <View
                        testID={testID === undefined ? undefined : `${testID}-fill`}
                        className="h-full rounded-full bg-surface-brand transition-all duration-normal ease-standard"
                        style={{ width: `${filled}%` }}
                    />
                </View>
                <View style={{ width: `${halfShare}%` }} />
            </View>

            {steps.map((step, index) => {
                const isCurrent = index === at;
                const isDone = !isCurrent && completed.has(index);
                const number = String(index + 1);
                const accessibilityLabel = t(
                    isDone
                        ? 'designSystem:stepProgress.stepDone'
                        : 'designSystem:stepProgress.step',
                    { current: index + 1, total, label: step.label },
                );

                return (
                    <Pressable
                        key={step.key}
                        testID={step.testID}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={accessibilityLabel}
                        aria-current={isCurrent ? 'step' : undefined}
                        accessibilityState={{
                            selected: isCurrent,
                            disabled: onSelect === undefined,
                        }}
                        disabled={onSelect === undefined}
                        onPress={() => {
                            onSelect?.(index);
                        }}
                        className="min-w-0 flex-1 flex-col items-center gap-hair"
                    >
                        <View
                            className={cx(
                                'h-5 w-5 items-center justify-center rounded-full border-2',
                                isDone
                                    ? 'border-transparent bg-surface-brand'
                                    : isCurrent
                                      ? 'border-surface-brand bg-surface-raised'
                                      : 'border-stroke bg-surface-raised',
                            )}
                        >
                            {isDone ? (
                                <Icon name="check" size="sm" className="text-content-on-brand" />
                            ) : (
                                <RNText
                                    aria-hidden
                                    className={cx(
                                        'text-role-micro tabular-nums',
                                        isCurrent
                                            ? 'text-content-on-brand-subtle'
                                            : 'text-content-secondary',
                                    )}
                                >
                                    {number}
                                </RNText>
                            )}
                        </View>
                        <RNText
                            aria-hidden
                            numberOfLines={1}
                            className={cx(
                                'hidden max-w-full text-center text-role-caption sm:flex',
                                isCurrent
                                    ? 'font-semibold text-content-primary'
                                    : isDone
                                      ? 'text-content-primary'
                                      : 'text-content-secondary',
                            )}
                        >
                            {step.label}
                        </RNText>
                    </Pressable>
                );
            })}
        </View>
    );
}
