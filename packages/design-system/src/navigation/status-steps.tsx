import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { cx } from '../internal/class-names.ts';

/**
 * How far a record has got — one bar a step, its name and its date under it (the record pop-up's
 * strip, 2026-11-17; the admin's one progress track since 2026-11-26).
 *
 * ```
 * ████████████   ████████████   ▓▓▓▓▓▓▓▓▓▓▓▓   ────────────
 * Draft          Issued         Partly received Received
 * Oct 12, 2026   Oct 12, 2026   Oct 14 · 1 of 2  —
 * ```
 *
 * Read-only: it says where a record is, it does not move it. A form's own sections — the steps a
 * reader clicks between — are `Tabs variant="pills"`.
 *
 * - `done` — happened: the brand bar.
 * - `partial` — happened in part (a part delivery): amber.
 * - `current` — the step the record is at now: a green-outlined bar, its name in bold.
 * - `pending` — not yet: a grey bar, its name quiet.
 *
 * `trailing` sits at the strip's end — the order pop-up's next step button.
 */
export type StatusStepState = 'done' | 'partial' | 'current' | 'pending';

export interface StatusStep {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    /** Formatted, or `null` for a step with nothing to say yet: the `noValue` dash. */
    readonly at: string | null;
    readonly state: StatusStepState;
    readonly testID?: string | undefined;
}

const BAR: Readonly<Record<StatusStepState, string>> = {
    done: 'bg-surface-brand',
    partial: 'bg-warning',
    // Outlined, so the step in hand reads apart from the ones still to come on a grey band too.
    current: 'border border-surface-brand bg-surface-raised',
    pending: 'bg-stroke',
};

const INK: Readonly<Record<StatusStepState, string>> = {
    done: 'font-semibold text-content-primary',
    partial: 'font-semibold text-warning-strong',
    current: 'font-bold text-content-primary',
    pending: 'font-semibold text-content-secondary',
};

export interface StatusStepsProps {
    readonly steps: readonly StatusStep[];
    /** Translated. The strip's accessible name. */
    readonly label: string;
    /** What a step with no date says — usually an em dash. */
    readonly noValue: string;
    readonly trailing?: ReactNode;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function StatusSteps({
    steps,
    label,
    noValue,
    trailing,
    className,
    testID,
}: StatusStepsProps) {
    return (
        <View testID={testID} className={cx('flex-row items-center gap-4', className)}>
            <View
                role="list"
                aria-label={label}
                accessibilityLabel={label}
                className="min-w-0 flex-1 flex-row gap-2.5"
            >
                {steps.map((step) => (
                    <View
                        key={step.key}
                        testID={step.testID}
                        role="listitem"
                        aria-current={step.state === 'current' ? 'step' : undefined}
                        className="min-w-0 flex-1 basis-0 flex-col gap-2"
                    >
                        <View aria-hidden className={cx('h-1.5 rounded-full', BAR[step.state])} />
                        <View className="flex-col">
                            <RNText
                                numberOfLines={1}
                                className={cx('text-sm text-start', INK[step.state])}
                            >
                                {step.label}
                            </RNText>
                            <RNText
                                numberOfLines={1}
                                className="text-xs tabular-nums text-content-secondary text-start"
                            >
                                {step.at ?? noValue}
                            </RNText>
                        </View>
                    </View>
                ))}
            </View>
            {trailing === undefined || trailing === null ? null : (
                <View className="shrink-0">{trailing}</View>
            )}
        </View>
    );
}
