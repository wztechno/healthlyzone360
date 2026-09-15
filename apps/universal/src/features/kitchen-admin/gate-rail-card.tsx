import { Callout, Icon, Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The publication gate as a rail card (KITCHEN.md 7b): one row per check with a pass/fail dot, an
 * amber explainer while anything fails, and the publish control underneath — disabled by the
 * caller for exactly the same predicates that fail the rows, so the button and the dots cannot
 * disagree.
 *
 * The checks arrive derived; this card invents none. The dot is a shape as well as a colour
 * (✓ / ✕) and the row text carries the meaning, so nothing here is colour-only.
 */
export interface GateCheck {
    readonly key: string;
    readonly label: string;
    readonly passed: boolean;
    /** Shown under a failing check: what to fix and where. */
    readonly note?: string | undefined;
}

export interface GateRailCardProps {
    readonly testID: string;
    readonly title: string;
    readonly checks: readonly GateCheck[];
    /** Amber panel shown while any check fails. */
    readonly explainer?: string | undefined;
    /** The publish control. */
    readonly action?: ReactNode | undefined;
    /** A second rail card — the review-queue cross-link. */
    readonly crossLink?: ReactNode | undefined;
}

export function GateRailCard({
    testID,
    title,
    checks,
    explainer,
    action,
    crossLink,
}: GateRailCardProps) {
    const anyFailing = checks.some((check) => !check.passed);

    return (
        <View className="gap-4">
            <View
                testID={testID}
                className="gap-3 rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-card"
            >
                <Text variant="micro" tone="secondary">
                    {title}
                </Text>

                {checks.map((check) => (
                    <View
                        key={check.key}
                        testID={`${testID}-check-${check.key}`}
                        className="flex-row items-start gap-2"
                    >
                        {/*
                         * An unmet check is a dot, not a red cross.
                         *
                         * Nothing here has gone *wrong*: a record being unfinished is its ordinary
                         * state for most of the time somebody is filling it in, and four red crosses
                         * on an empty form reads as four errors rather than four things still to do.
                         * The pair is still a shape as well as a colour - a filled tick against a
                         * small hollow dot - so the standing rule that meaning is never carried by
                         * colour alone holds. Danger ink is kept for the things that are actually
                         * wrong, which on this page are the field errors.
                         */}
                        <View
                            aria-hidden
                            className={
                                check.passed
                                    ? 'h-5 w-5 items-center justify-center rounded-full bg-surface-brand-subtle'
                                    : 'h-5 w-5 items-center justify-center rounded-full bg-surface-sunken'
                            }
                        >
                            <Icon
                                name={check.passed ? 'check' : 'dot'}
                                size="sm"
                                className={
                                    check.passed
                                        ? 'text-content-on-brand-subtle'
                                        : 'text-content-secondary'
                                }
                            />
                        </View>
                        <View className="min-w-0 flex-1">
                            <Text testID={`${testID}-check-${check.key}-label`}>{check.label}</Text>
                            {check.passed || check.note === undefined ? null : (
                                <Text
                                    testID={`${testID}-check-${check.key}-note`}
                                    variant="caption"
                                    tone="secondary"
                                >
                                    {check.note}
                                </Text>
                            )}
                        </View>
                    </View>
                ))}

                {anyFailing && explainer !== undefined ? (
                    <Callout testID={`${testID}-explainer`} tone="warning" title={explainer} />
                ) : null}

                {action}
            </View>

            {crossLink}
        </View>
    );
}
