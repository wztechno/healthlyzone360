import { Icon, Text, cx } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

/**
 * The step track a posting form opens on — Receive a delivery and Post a goods receipt (the
 * Procurement boards of 2026-11-24). The recipe editor's `Tabs variant="pills"` row, grown a
 * second line: each step names itself and says, under its name, what it holds right now — the
 * order picked, "4 to post, 1 left out" — so the row reads as the form's summary as well as its
 * navigation.
 *
 * Every step is open from the row in any order; there is no Next or Back. A step already walked
 * with nothing left on it takes a check in place of its number, and a step holding a problem
 * carries the count in an amber pill, so the reader sees from the row which step to open.
 */
export interface ProcessStep<Key extends string> {
    readonly key: Key;
    /** Translated. */
    readonly label: string;
    /** Translated — the line under the name. */
    readonly caption: string;
    /** The caption is itself something to act on. */
    readonly captionTone?: 'warning' | undefined;
    /** Walked, with nothing left on it: a check in place of the number. */
    readonly done?: boolean | undefined;
    /** Problems on this step. `0` draws nothing. */
    readonly issues?: number | undefined;
    /** Spoken after the name when `issues` is above zero — "1 to fix". */
    readonly issuesLabel?: string | undefined;
}

export interface ProcessStepsProps<Key extends string> {
    /** Accessible name for the row. */
    readonly label: string;
    readonly steps: readonly ProcessStep<Key>[];
    readonly value: Key;
    readonly onChange: (key: Key) => void;
    /** Row; each step `{testID}-{key}`, its pill `{testID}-{key}-issues`. */
    readonly testID: string;
    readonly className?: string | undefined;
}

export function ProcessSteps<Key extends string>({
    label,
    steps,
    value,
    onChange,
    testID,
    className,
}: ProcessStepsProps<Key>) {
    return (
        <View
            testID={testID}
            role="navigation"
            aria-label={label}
            accessibilityLabel={label}
            className={cx(
                'flex-row items-stretch gap-1 rounded-2xl border border-stroke-subtle bg-surface-raised p-1',
                className,
            )}
        >
            {steps.map((step, index) => {
                const selected = step.key === value;
                const done = step.done === true;
                const issues = step.issues ?? 0;
                const spoken =
                    issues > 0 && step.issuesLabel !== undefined
                        ? `${step.label}, ${step.caption}, ${step.issuesLabel}`
                        : `${step.label}, ${step.caption}`;
                return (
                    <Pressable
                        key={step.key}
                        testID={`${testID}-${step.key}`}
                        accessibilityRole="button"
                        accessibilityLabel={spoken}
                        aria-current={selected ? 'step' : undefined}
                        accessibilityState={{ selected }}
                        onPress={() => {
                            onChange(step.key);
                        }}
                        className={cx(
                            'h-[46px] min-w-0 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-transparent px-3',
                            selected ? 'bg-surface-brand-subtle' : 'web:hover:bg-surface-sunken',
                        )}
                    >
                        <StepDot selected={selected || done}>
                            {done ? (
                                <Icon name="check" size="sm" className="text-content-on-brand" />
                            ) : (
                                <Text
                                    className={cx(
                                        'text-[11px] font-bold tabular-nums',
                                        selected
                                            ? 'text-content-on-brand'
                                            : 'text-content-secondary',
                                    )}
                                >
                                    {String(index + 1)}
                                </Text>
                            )}
                        </StepDot>
                        <View className="min-w-0 shrink items-start">
                            <Text
                                numberOfLines={1}
                                className={cx(
                                    'text-sm font-semibold leading-4',
                                    selected
                                        ? 'text-content-on-brand-subtle'
                                        : 'text-content-secondary',
                                )}
                            >
                                {step.label}
                            </Text>
                            <Text
                                numberOfLines={1}
                                testID={`${testID}-${step.key}-caption`}
                                className={cx(
                                    'mt-px text-[11px] leading-4 tabular-nums',
                                    step.captionTone === 'warning'
                                        ? 'font-bold text-warning-on-subtle'
                                        : selected
                                          ? 'font-medium text-content-on-brand-subtle'
                                          : 'font-medium text-content-secondary',
                                )}
                            >
                                {step.caption}
                            </Text>
                        </View>
                        {issues > 0 ? (
                            <View
                                aria-hidden
                                testID={`${testID}-${step.key}-issues`}
                                className="h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning-subtle px-[5px]"
                            >
                                <Text className="text-[11px] font-bold tabular-nums text-warning-on-subtle">
                                    {String(issues)}
                                </Text>
                            </View>
                        ) : null}
                    </Pressable>
                );
            })}
        </View>
    );
}

function StepDot({
    selected,
    children,
}: {
    readonly selected: boolean;
    readonly children: ReactNode;
}) {
    return (
        <View
            aria-hidden
            className={cx(
                'h-5 w-5 shrink-0 items-center justify-center rounded-full',
                selected ? 'bg-surface-brand' : 'bg-surface-sunken',
            )}
        >
            {children}
        </View>
    );
}
