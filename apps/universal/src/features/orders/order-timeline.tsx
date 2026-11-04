import { Icon, cx, useMotion } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Platform, Text as RNText, View } from 'react-native';

import { ORDER_PROGRESS_STEPS, stepPosition } from './order-progress.ts';
import type { OrderProgressStep, OrderStepPosition } from './order-progress.ts';

/**
 * The order's progress as a vertical timeline — the accepted Track board's "Order progress" list.
 *
 * Three columns per row: a 36px dot carrying the step's own glyph (a bag, a tick, the chef's hat, a
 * parcel, the bike, the house) with the rail running down to the next, the step's title over one
 * line of detail, and its time on the end edge. Done steps fill the dot and the rail in the brand;
 * the step in hand has the soft tint with a brand ring pulsing out of it; steps to come stay on the
 * hairline. Colour is never the only signal: each row's accessible label names its position ("done",
 * "in progress", "still to come").
 *
 * A step carries a time when the order says when it got there (`times`); any other row reads "—" —
 * the board's own mark for a step without one — rather than a time it was never told.
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

const STEP_ICON: Readonly<Record<OrderProgressStep, IconName>> = {
    placed: 'shoppingBag',
    confirmed: 'check',
    preparing: 'chefHat',
    ready_for_pickup: 'package',
    out_for_delivery: 'bike',
    delivered: 'home',
};

const DOT: Readonly<Record<OrderStepPosition, string>> = {
    done: 'border-surface-brand bg-surface-brand',
    current: 'border-surface-brand bg-surface-brand-subtle',
    upcoming: 'border-stroke bg-surface-base',
};

const GLYPH: Readonly<Record<OrderStepPosition, string>> = {
    done: 'text-content-on-brand',
    current: 'text-content-on-brand-subtle',
    upcoming: 'text-content-secondary',
};

/** The ring that pulses out of the step in hand — still when the reader asked for less motion. */
function Pulse() {
    const { enabled } = useMotion();
    const [wave] = useState(() => new Animated.Value(0));
    useEffect(() => {
        if (!enabled) return undefined;
        const loop = Animated.loop(
            Animated.timing(wave, {
                toValue: 1,
                duration: 2000,
                easing: Easing.out(Easing.quad),
                useNativeDriver: Platform.OS !== 'web',
            }),
        );
        loop.start();
        return () => {
            loop.stop();
        };
    }, [enabled, wave]);
    if (!enabled) return null;
    return (
        <Animated.View
            aria-hidden
            className="absolute h-9 w-9 rounded-full bg-surface-brand"
            style={{
                opacity: wave.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.35, 0, 0] }),
                transform: [
                    { scale: wave.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) },
                ],
            }}
        />
    );
}

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
                        className="flex-row items-stretch gap-3"
                    >
                        <View className="w-9 flex-col items-center">
                            <View className="h-9 w-9 items-center justify-center">
                                {position === 'current' ? <Pulse /> : null}
                                <View
                                    testID={`${testID}-${step}-dot`}
                                    className={cx(
                                        'h-9 w-9 items-center justify-center rounded-full border-2',
                                        DOT[position],
                                    )}
                                >
                                    <Icon
                                        name={STEP_ICON[step]}
                                        size="sm"
                                        className={GLYPH[position]}
                                    />
                                </View>
                            </View>
                            {index === last ? null : (
                                <View
                                    className={cx(
                                        'min-h-[18px] w-0.5 flex-1',
                                        index < current ? 'bg-surface-brand' : 'bg-stroke-subtle',
                                    )}
                                />
                            )}
                        </View>

                        <View
                            className={cx(
                                'min-w-0 flex-1 flex-col pt-[7px]',
                                index === last ? null : 'pb-[18px]',
                            )}
                        >
                            <RNText
                                className={cx(
                                    'text-base text-start',
                                    position === 'upcoming'
                                        ? 'font-semibold text-content-secondary'
                                        : 'font-bold text-content-primary',
                                )}
                            >
                                {title}
                            </RNText>
                            <RNText
                                testID={index === 0 ? `${testID}-placed-detail` : undefined}
                                className="mt-px text-sm font-medium text-content-secondary text-start"
                            >
                                {index === 0 ? placedDetail : t(`guest:order.steps.${step}.detail`)}
                            </RNText>
                        </View>

                        <View className="min-w-[56px] items-end pt-2">
                            {time !== undefined ? (
                                <RNText
                                    testID={
                                        index === 0 ? `${testID}-time` : `${testID}-${step}-time`
                                    }
                                    className={cx(
                                        'text-sm font-semibold tabular-nums text-end',
                                        position === 'upcoming'
                                            ? 'text-content-secondary'
                                            : 'text-content-primary',
                                    )}
                                >
                                    {time}
                                </RNText>
                            ) : (
                                <RNText
                                    aria-hidden
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                    className="text-sm font-semibold tabular-nums text-content-secondary text-end"
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
