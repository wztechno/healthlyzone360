import { cx } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { ORDER_PROGRESS_STEPS, stepPosition } from './order-progress.ts';
import type { OrderProgressStep, OrderStepPosition } from './order-progress.ts';

/**
 * The order's progress as a vertical timeline — the HealthZone `track` card's dot-and-rail list.
 *
 * The design's three columns per row: a 26px column holding the dot with the rail running down to
 * the next one, the step's title over one line of detail, and the step's time on the end edge. Done
 * steps fill the dot and the rail below it in the success ink; the current step gets the brand fill
 * with a soft success ring and a larger display-face title; upcoming steps stay on the hairline
 * colour with disabled ink. Colour is never the only signal: each row's accessible label names its
 * position ("done", "in progress", "still to come").
 *
 * A step carries a time when the order says when it got there (`times`); any other row reads "—" —
 * the design's own mark for a step without one — rather than a time it was never told.
 */

export interface OrderTimelineProps {
    /** Index into {@link ORDER_PROGRESS_STEPS} of the step the order is on. */
    readonly current: number;
    /** Already formatted by the caller — when it was placed. */
    readonly placedAt: string;
    /** When it reached each later step, already formatted. A step left out shows "—". */
    readonly times?: Readonly<Partial<Record<OrderProgressStep, string>>> | undefined;
    /** The first step's detail line — the payment and the total, composed by the caller. */
    readonly placedDetail: string;
    readonly testID: string;
}

const DOT: Readonly<Record<OrderStepPosition, string>> = {
    // The border is the card's own fill on the two quiet states, which leaves a 12px dot inside
    // the 20px box; on the current step it becomes the soft ring the design draws.
    done: 'border-surface-raised bg-success-strong',
    current: 'border-success-subtle bg-surface-brand',
    upcoming: 'border-surface-raised bg-stroke',
};

export function OrderTimeline({
    current,
    placedAt,
    placedDetail,
    times,
    testID,
}: OrderTimelineProps) {
    const { t } = useTranslation();
    const last = ORDER_PROGRESS_STEPS.length - 1;

    return (
        <View
            testID={testID}
            role="list"
            accessibilityLabel={t('guest:order.timeline')}
            className="flex-col"
        >
            {ORDER_PROGRESS_STEPS.map((step, index) => {
                const position = stepPosition(index, current);
                const title = t(`guest:order.steps.${step}.title`);
                const time = index === 0 ? placedAt : times?.[step];
                return (
                    <View
                        key={step}
                        role="listitem"
                        testID={`${testID}-${step}`}
                        accessibilityLabel={`${title}, ${t(`guest:order.position.${position}`)}`}
                        className="flex-row items-stretch gap-4"
                    >
                        <View className="w-[26px] flex-col items-center pt-0.5">
                            {/*
                             * The same 20px box on every step, so the rail below lines up whatever
                             * the state.
                             */}
                            <View
                                testID={`${testID}-${step}-dot`}
                                className={cx('h-5 w-5 rounded-full border-4', DOT[position])}
                            />
                            {index === last ? null : (
                                <View
                                    className={cx(
                                        'min-h-[26px] w-0.5 flex-1',
                                        index < current ? 'bg-success-strong' : 'bg-stroke',
                                    )}
                                />
                            )}
                        </View>

                        <View
                            className={cx(
                                'min-w-0 flex-1 flex-col gap-0.5',
                                index === last ? null : 'pb-5',
                            )}
                        >
                            <RNText
                                className={cx(
                                    'text-start',
                                    position === 'current'
                                        ? 'font-display text-lg font-bold tracking-display text-content-primary'
                                        : 'text-base font-medium',
                                    position === 'upcoming'
                                        ? 'text-content-disabled'
                                        : position === 'done'
                                          ? 'text-content-primary'
                                          : null,
                                )}
                            >
                                {title}
                            </RNText>
                            <RNText
                                testID={index === 0 ? `${testID}-placed-detail` : undefined}
                                className="text-sm text-content-secondary text-start"
                            >
                                {index === 0 ? placedDetail : t(`guest:order.steps.${step}.detail`)}
                            </RNText>
                        </View>

                        <View className="min-w-[56px] items-end pt-1">
                            {time !== undefined ? (
                                <RNText
                                    testID={index === 0 ? `${testID}-time` : `${testID}-${step}-time`}
                                    className="text-xs font-medium tabular-nums text-content-secondary text-end"
                                >
                                    {time}
                                </RNText>
                            ) : (
                                <RNText
                                    aria-hidden
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                    className="text-xs font-medium tabular-nums text-content-secondary text-end"
                                >
                                    {t('guest:order.noTime')}
                                </RNText>
                            )}
                        </View>
                    </View>
                );
            })}
        </View>
    );
}
