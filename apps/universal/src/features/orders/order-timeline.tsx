import { Icon, cx, useMotion } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { ReactNode } from 'react';
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
    delivered: 'house',
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

export interface CancelledTimelineProps {
    /** Already formatted by the caller — when it was placed. */
    readonly placedAt: string;
    /** When it reached each later step, already formatted. A step left out was never reached. */
    readonly times?: Readonly<Partial<Record<OrderProgressStep, string>>> | undefined;
    readonly placedDetail: string;
    readonly testID: string;
}

/**
 * Shop · Orders, pin 2: a cancelled order keeps its timeline, and it stops. The steps it reached
 * stay done, a red "Cancelled" row follows them, and the steps that will not happen now are faded,
 * struck through and drawn on a dashed dot — in place of a box that replaced the whole list.
 */
export function CancelledTimeline({
    placedAt,
    placedDetail,
    times,
    testID,
}: CancelledTimelineProps) {
    const { t } = useTranslation();
    // How far it got: the last step the order carries a time for. A guest order carries none.
    let reached = 0;
    ORDER_PROGRESS_STEPS.forEach((step, index) => {
        if (index > 0 && times?.[step] !== undefined) reached = index;
    });
    const done = ORDER_PROGRESS_STEPS.slice(0, reached + 1);
    const skipped = ORDER_PROGRESS_STEPS.slice(reached + 1);
    const cancelled = t('guest:order.cancelledStep');

    return (
        <View
            testID={testID}
            role="list"
            accessibilityLabel={t('guest:order.timeline')}
            className="flex-col"
        >
            {done.map((step, index) => {
                const title = t(`guest:order.steps.${step}.title`);
                return (
                    <StoppedRow
                        key={step}
                        testID={`${testID}-${step}`}
                        label={`${title}, ${t('guest:order.position.done')}`}
                        dot="border-surface-brand bg-surface-brand"
                        icon={
                            <Icon
                                name={STEP_ICON[step]}
                                size="sm"
                                className="text-content-on-brand"
                            />
                        }
                        title={title}
                        detail={index === 0 ? placedDetail : t(`guest:order.steps.${step}.detail`)}
                        time={index === 0 ? placedAt : times?.[step]}
                    />
                );
            })}
            <StoppedRow
                testID={`${testID}-cancelled`}
                label={cancelled}
                dot="border-danger-strong bg-danger-strong"
                icon={<Icon name="close" size="sm" className="text-danger-on-strong" />}
                title={cancelled}
                detail={t('guest:order.cancelledStepDetail')}
            />
            {skipped.map((step) => {
                const title = t(`guest:order.steps.${step}.title`);
                return (
                    <StoppedRow
                        key={step}
                        testID={`${testID}-${step}`}
                        label={`${title}, ${t('guest:order.position.skipped')}`}
                        dot="border-dashed border-stroke bg-surface-base"
                        title={title}
                        skipped
                    />
                );
            })}
        </View>
    );
}

function StoppedRow({
    testID,
    label,
    dot,
    icon,
    title,
    detail,
    time,
    skipped = false,
}: {
    readonly testID: string;
    readonly label: string;
    readonly dot: string;
    readonly icon?: ReactNode;
    readonly title: string;
    readonly detail?: string | undefined;
    readonly time?: string | undefined;
    readonly skipped?: boolean;
}) {
    return (
        <View
            role="listitem"
            testID={testID}
            accessibilityLabel={label}
            className={cx('flex-row items-center gap-3 py-2.5', skipped ? 'opacity-45' : null)}
        >
            <View
                testID={`${testID}-dot`}
                className={cx('h-8 w-8 items-center justify-center rounded-full border-2', dot)}
            >
                {icon}
            </View>
            <View className="min-w-0 flex-1 flex-col">
                <RNText
                    className={cx(
                        'text-sm font-bold text-start',
                        skipped ? 'text-content-secondary line-through' : 'text-content-primary',
                    )}
                >
                    {title}
                </RNText>
                {detail === undefined ? null : (
                    <RNText className="text-xs font-medium text-content-secondary text-start">
                        {detail}
                    </RNText>
                )}
            </View>
            {time === undefined ? null : (
                <RNText className="text-xs font-semibold tabular-nums text-content-secondary text-end">
                    {time}
                </RNText>
            )}
        </View>
    );
}
