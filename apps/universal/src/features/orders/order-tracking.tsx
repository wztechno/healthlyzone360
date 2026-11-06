import type {
    DeliveryAddress,
    GuestOrderState,
    OrderStepTimes,
} from '@healthy360/api-client/contracts';
import { Icon, cx, useBreakpoint, useMotion, useToast } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { Money } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    Animated,
    Easing,
    Platform,
    Pressable,
    Text as RNText,
    View,
} from 'react-native';

import { usePrototypeAction } from '../../prototype/index.ts';
import { formatAddress } from '../commerce/address.ts';
import { formatMoney } from '../marketplace/format.ts';
import { OrderLineThumb } from './order-line-thumb.tsx';
import { ORDER_PROGRESS_STEPS, currentStepIndex } from './order-progress.ts';
import type { OrderProgressStep } from './order-progress.ts';
import { CancelledTimeline, OrderTimeline } from './order-timeline.tsx';

/**
 * The accepted Track board's body, shared by the guest page (`/orders/{reference}`) and the
 * signed-in one (`/customer/orders/{order}`): the eyebrow and the status as the headline, the canopy
 * "journey" with the road from the kitchen to the door and the rider on it, then "Order progress"
 * beside "In this order" and "Courier".
 *
 * ## One presentation over two contracts
 *
 * `GuestOrder` and `PlacedOrder` were drawn to the same shape on purpose — the same person may
 * order once as a guest and once with an account — so this takes the fields they share
 * ({@link TrackableOrder}) and nothing else. What differs between the two pages is *around* the
 * order, not in it: the guest page adds a reminder to keep the reference (there is no account to
 * find it from) through `footer`, and the conversion prompt in its own layout.
 *
 * ## The design, top to bottom, and what each slot is bound to
 *
 * * **The eyebrow** — "ORDER #… · PLACED …": the reference (selectable — a guest's only bookmark)
 *   and `placedAt`.
 * * **The headline and lede** — the state, in words. The headline *is* the status; there is no
 *   badge beside it.
 * * **The canopy panel** — "ARRIVING" over the delivery date and the chosen window, or "To be
 *   confirmed" when the kitchen has not been given one. Never a countdown: there is no ETA. Once
 *   delivered it says "DELIVERED" over when, if the order says.
 * * **The timeline card** — six steps (see `order-progress.ts`), each with the time it was reached
 *   when the order carries one (`stepTimes`) and "—" otherwise, the first step's detail carrying the
 *   payment and the total owed. Under a hairline, the design's buttons: on the guest page the
 *   primary refreshes the state from the server (the design's "simulate next status" is the canvas
 *   driving itself, and the honest version of "show me where it is now" is to ask again) — the
 *   signed-in page keeps itself current and passes no `onRefresh`, so it has none; "Get help" and — only while the
 *   food is on the road — "Message the courier" have no endpoint, so they are the prototype
 *   mechanism's controls.
 * * **IN THIS ORDER** — a thumbnail, "qty × name" and the line total per line.
 * * **COURIER** — the contract names no courier, so the avatar is the generic one, the name slot
 *   says so, and the paragraph under the hairline is the real part: where it is going and the note
 *   on file for the driver.
 */

/** The fields a guest order and an account order share — everything this view reads. */
export interface TrackableOrder {
    readonly reference: string;
    /** `OrderState` is a subset of this, so a `PlacedOrder` passes as it is. */
    readonly state: GuestOrderState;
    readonly lines: readonly {
        readonly id: string;
        readonly name: string;
        readonly quantity: number;
        readonly lineTotal: Money;
    }[];
    readonly total: Money;
    readonly address: DeliveryAddress;
    /** Empty when the person expressed no window choice. */
    readonly slotCode: string;
    /** The kitchen's own name for the window, when the order carries it (HA-22). */
    readonly slotNames?: { readonly en: string | null; readonly ar: string | null } | undefined;
    /** `YYYY-MM-DD`, or empty when the kitchen has not been given one. */
    readonly deliveryDate: string;
    readonly placedAt: string;
    /** When it reached each later step. A guest order carries none. */
    readonly stepTimes?: OrderStepTimes | undefined;
}

/** The board's white card: 26px corners on a soft hairline, with its shadow. */
const CARD =
    'flex-col rounded-[26px] border border-stroke-subtle bg-surface-raised shadow-elevation-2';

export interface OrderTrackingProps {
    readonly order: TrackableOrder;
    /** The payment line, already translated — both pages are cash on delivery today. */
    readonly paymentLabel: string;
    /**
     * Asks the server for the order again — the timeline card's primary action. Omitted by a page
     * that keeps the order current on its own, which then draws no Refresh button.
     */
    readonly onRefresh?: (() => void) | undefined;
    readonly refreshing?: boolean | undefined;
    /** Drawn at the foot of the timeline card, under the buttons. */
    readonly footer?: ReactNode;
    /**
     * Shop · Orders, pin 3: the reference as a bold, copyable chip under the lede, with the line
     * on keeping it — the guest page's, which has no account to find the order from later.
     */
    readonly showReference?: boolean | undefined;
    /** Prefix for every test ID — `guest-order`, `customer-order`. */
    readonly testID: string;
}

export function OrderTracking({
    order,
    paymentLabel,
    onRefresh,
    refreshing,
    footer,
    showReference = false,
    testID,
}: OrderTrackingProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const { atLeast } = useBreakpoint();
    const prototype = usePrototypeAction();
    const wide = atLeast('md');
    const router = useRouter();
    // No endpoint yet: the prototype mechanism's "not available yet" toast (Shop · Orders, pin 5).
    const askForHelp = () => {
        prototype({ contract: 'POST /api/v1/orders/{order}/support-requests' });
    };

    const current = currentStepIndex(order.state);
    const placedAt = formatter.formatDate(order.placedAt, { timeStyle: 'short' });
    // The kitchen's own name, as checkout showed it ("Lunch"), before the platform's generic one.
    const kitchenSlot =
        (locale.toLowerCase().startsWith('ar') ? order.slotNames?.ar : order.slotNames?.en) ??
        order.slotNames?.en ??
        null;
    const slot =
        order.slotCode === ''
            ? null
            : (kitchenSlot ??
              t(`commerce:slots.${order.slotCode}`, { defaultValue: order.slotCode }));
    const arriving =
        order.deliveryDate === ''
            ? t('guest:order.windowPending')
            : [
                  formatter.formatDate(order.deliveryDate, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                  }),
                  slot,
              ]
                  .filter((part): part is string => part !== null)
                  .join(t('guest:order.separator'));
    const note = order.address.instructions?.trim() ?? '';

    const times: Partial<Record<OrderProgressStep, string>> = {};
    if (order.stepTimes !== undefined) {
        for (const [step, at] of Object.entries(order.stepTimes) as [
            keyof OrderStepTimes,
            string | null,
        ][]) {
            if (at !== null) times[step] = formatter.formatDate(at, { timeStyle: 'short' });
        }
    }
    const deliveredAt = order.state === 'delivered' ? (order.stepTimes?.delivered ?? null) : null;
    const steps = ORDER_PROGRESS_STEPS.length - 1;
    const progress = current === null ? 0 : current / steps;
    const currentStep = current === null ? null : ORDER_PROGRESS_STEPS[current];

    return (
        <View className="flex-col">
            {/* ── opening: eyebrow, the status as the headline, its lede ── */}
            <View className="mt-3.5 flex-col">
                <RNText
                    testID={`${testID}-eyebrow`}
                    selectable
                    className="text-xs font-semibold uppercase tracking-wider tabular-nums text-content-secondary text-start"
                >
                    {t('guest:order.number')}
                    <RNText testID={`${testID}-reference`} className="text-content-primary">
                        {order.reference}
                    </RNText>
                    {t('guest:order.separator')}
                    <RNText testID={`${testID}-placed`}>
                        {t('guest:order.placedAt', { time: placedAt })}
                    </RNText>
                </RNText>
                <RNText
                    testID={`${testID}-title`}
                    accessibilityRole="header"
                    aria-level={1}
                    className="mt-1.5 font-display text-4xl font-bold leading-[46px] tracking-display text-content-primary text-start"
                >
                    {t(`guest:order.headline.${order.state}`)}
                </RNText>
                <RNText
                    testID={`${testID}-lead`}
                    className="mt-1.5 text-base font-medium text-content-secondary text-start"
                >
                    {t(`guest:order.lead.${order.state}`)}
                </RNText>
            </View>

            {showReference ? (
                <ReferenceChip testID={testID} reference={order.reference} />
            ) : null}

            {/* ── the journey: when it arrives, and the road from the kitchen to the door ── */}
            {current === null ? (
                // Shop · Orders, pin 1: a cancelled order has no arrival — a red card with what
                // that means and two ways on, in place of the canopy band.
                <View
                    testID={`${testID}-cancelled`}
                    role="status"
                    className="mt-[22px] flex-row flex-wrap items-center gap-[18px] rounded-[26px] border border-danger-border bg-danger-subtle px-6 py-[22px]"
                >
                    <View className="h-14 w-14 items-center justify-center rounded-[18px] bg-danger-strong">
                        <Icon name="close" size="lg" className="text-danger-on-strong" />
                    </View>
                    <View className="min-w-[200px] flex-1 flex-col gap-0.5">
                        <RNText className="font-display text-xl font-bold text-danger-on-subtle text-start">
                            {t('guest:order.cancelledTitle')}
                        </RNText>
                        <RNText className="text-sm font-medium text-danger-on-subtle text-start">
                            {t('guest:order.cancelledBody')}
                        </RNText>
                    </View>
                    <View className="flex-row flex-wrap gap-2">
                        <PillButton
                            testID={`${testID}-cancelled-help`}
                            label={t('guest:order.getHelp')}
                            hint={t('marketplace:prototype.hint')}
                            onPress={askForHelp}
                        />
                        <PillButton
                            testID={`${testID}-cancelled-browse`}
                            label={t('account:orders.browse')}
                            ink
                            onPress={() => {
                                router.push('/meals');
                            }}
                        />
                    </View>
                </View>
            ) : (
            <View
                testID={`${testID}-window`}
                className="relative mt-[22px] overflow-hidden rounded-[26px] bg-surface-canopy px-7 pb-[22px] pt-6"
            >
                <View
                    aria-hidden
                    className="absolute -end-[100px] -top-[160px] h-[420px] w-[420px] rounded-full bg-stage-green opacity-15"
                />
                <View className="flex-row flex-wrap items-end justify-between gap-4">
                    <View className="min-w-0">
                        <RNText className="text-xs font-bold uppercase tracking-wider text-stage-green text-start">
                            {deliveredAt === null
                                ? t('guest:order.arriving')
                                : t('guest:order.delivered')}
                        </RNText>
                        <RNText
                            testID={`${testID}-slot`}
                            className="mt-1 font-display text-2xl font-bold tracking-display text-content-on-canopy text-start"
                        >
                            {deliveredAt === null
                                ? arriving
                                : formatter.formatDate(deliveredAt, {
                                      weekday: 'short',
                                      hour: 'numeric',
                                      minute: '2-digit',
                                  })}
                        </RNText>
                    </View>
                    {currentStep === null || currentStep === undefined ? null : (
                        <RNText className="text-sm font-medium text-content-on-canopy-muted">
                            {t(`guest:order.steps.${currentStep}.title`)}
                        </RNText>
                    )}
                </View>
                {current === null ? null : (
                    <Road progress={progress} moving={order.state === 'out_for_delivery'} />
                )}
            </View>
            )}

            {/* ── the timeline beside what is in it and who is bringing it ── */}
            <View
                className={
                    wide ? 'mt-[22px] flex-row items-start gap-6' : 'mt-[22px] flex-col gap-4'
                }
            >
                <View
                    testID={`${testID}-progress`}
                    className={`${CARD} px-[22px] py-5 ${wide ? 'min-w-0 flex-1' : ''}`}
                >
                    <CardTitle>{t('guest:order.progressTitle')}</CardTitle>
                    {current === null ? (
                        <CancelledTimeline
                            testID={`${testID}-timeline`}
                            placedAt={placedAt}
                            times={times}
                            placedDetail={t('guest:order.steps.placed.detail', {
                                payment: paymentLabel,
                                total: formatMoney(formatter, order.total),
                            })}
                        />
                    ) : (
                        <OrderTimeline
                            testID={`${testID}-timeline`}
                            current={current}
                            placedAt={placedAt}
                            times={times}
                            placedDetail={t('guest:order.steps.placed.detail', {
                                payment: paymentLabel,
                                total: formatMoney(formatter, order.total),
                            })}
                        />
                    )}
                    {/* A cancelled order's ways on are in its red card; nothing to refresh or ask. */}
                    {current === null ? null : (
                    <View className="flex-row flex-wrap gap-2 border-t border-stroke-subtle pt-3.5">
                        {onRefresh === undefined ? null : (
                            <SoftButton
                                testID={`${testID}-refresh`}
                                label={t('guest:order.refresh')}
                                icon="refresh"
                                primary
                                busy={refreshing ?? false}
                                onPress={onRefresh}
                            />
                        )}
                        <SoftButton
                            testID={`${testID}-help`}
                            label={t('guest:order.getHelp')}
                            icon="circleHelp"
                            hint={t('marketplace:prototype.hint')}
                            onPress={askForHelp}
                        />
                        {order.state === 'out_for_delivery' ? (
                            <SoftButton
                                testID={`${testID}-message`}
                                label={t('guest:order.messageCourier')}
                                icon="send"
                                hint={t('marketplace:prototype.hint')}
                                onPress={() => {
                                    prototype({
                                        contract: 'POST /api/v1/orders/{order}/courier-messages',
                                    });
                                }}
                            />
                        ) : null}
                    </View>
                    )}
                    {footer === undefined ? null : <View className="pt-4">{footer}</View>}
                </View>

                <View className={wide ? 'w-[380px] flex-col gap-4' : 'flex-col gap-4'}>
                    <View testID={`${testID}-items`} className={`${CARD} px-5 py-[18px]`}>
                        <CardTitle>{t('guest:order.itemsTitle')}</CardTitle>
                        <View className="flex-col" testID={`${testID}-lines`}>
                            {order.lines.map((line) => (
                                <View
                                    key={line.id}
                                    testID={`${testID}-line-${line.id}`}
                                    className="flex-row items-center gap-3 py-2"
                                >
                                    <OrderLineThumb
                                        name={line.name}
                                        className="h-12 w-12 rounded-xl"
                                    />
                                    <RNText className="min-w-0 flex-1 text-sm font-semibold text-content-primary text-start">
                                        {t('guest:order.lineLabel', {
                                            qty: formatter.formatNumber(line.quantity),
                                            name: line.name,
                                        })}
                                    </RNText>
                                    <RNText className="text-sm font-bold tabular-nums text-content-primary text-end">
                                        {formatMoney(formatter, line.lineTotal)}
                                    </RNText>
                                </View>
                            ))}
                        </View>
                        <View className="mt-2 flex-row items-baseline justify-between border-t border-dashed border-stroke pt-3">
                            <RNText className="text-sm font-medium text-content-secondary">
                                {t('guest:order.totalToPay', { payment: paymentLabel })}
                            </RNText>
                            <RNText className="font-display text-2xl font-bold tabular-nums text-content-primary">
                                {formatMoney(formatter, order.total)}
                            </RNText>
                        </View>
                    </View>

                    <View testID={`${testID}-detail`} className={`${CARD} px-5 py-[18px]`}>
                        <CardTitle>{t('guest:order.courierTitle')}</CardTitle>
                        <View className="flex-row items-center gap-3">
                            <View
                                aria-hidden
                                accessibilityElementsHidden
                                importantForAccessibility="no-hide-descendants"
                                className="h-12 w-12 items-center justify-center rounded-full bg-surface-brand-subtle"
                            >
                                <Icon
                                    name="bike"
                                    size="md"
                                    className="text-content-on-brand-subtle"
                                />
                            </View>
                            <View className="min-w-0 flex-1 flex-col">
                                <RNText className="text-base font-bold text-content-primary text-start">
                                    {t('guest:order.courierName')}
                                </RNText>
                                <RNText className="text-sm font-medium text-content-secondary text-start">
                                    {t('guest:order.courierDetail')}
                                </RNText>
                            </View>
                        </View>
                        <RNText
                            testID={`${testID}-address`}
                            className="mt-3 border-t border-stroke-subtle pt-3 text-sm font-medium leading-relaxed text-content-secondary text-start"
                        >
                            {t('guest:order.droppingAt', { address: formatAddress(order.address) })}
                            {note === '' ? null : (
                                <>
                                    {' '}
                                    {t('guest:order.noteOnFile')}{' '}
                                    <RNText className="italic">{note}</RNText>
                                </>
                            )}
                        </RNText>
                    </View>
                </View>
            </View>
        </View>
    );
}

function CardTitle({ children }: { readonly children: string }) {
    return (
        <RNText
            accessibilityRole="header"
            aria-level={2}
            className="mb-3 text-base font-bold text-content-primary text-start"
        >
            {children}
        </RNText>
    );
}

/** The cancelled card's two ways on: a white pill, and the ink one. */
function PillButton({
    testID,
    label,
    ink = false,
    hint,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly ink?: boolean;
    readonly hint?: string | undefined;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityHint={hint}
            onPress={onPress}
            className={cx(
                'h-11 flex-row items-center rounded-full px-[18px]',
                ink
                    ? 'bg-content-primary hover:opacity-90'
                    : 'border border-stroke bg-surface-raised hover:bg-surface-sunken',
            )}
        >
            <RNText
                className={cx(
                    'text-sm font-bold',
                    ink ? 'text-surface-base' : 'text-content-primary',
                )}
            >
                {label}
            </RNText>
        </Pressable>
    );
}

/** What the web can copy to: the async clipboard, where the page is allowed it. */
function webClipboard(): { writeText: (text: string) => Promise<void> } | null {
    if (Platform.OS !== 'web') return null;
    const nav = (globalThis as { navigator?: { clipboard?: { writeText: (text: string) => Promise<void> } } })
        .navigator;
    return nav?.clipboard ?? null;
}

/**
 * The reference as a chip: its label, the number in the display face, and Copy where the page
 * can copy (on native the number is selectable instead). The keep-it line sits under it.
 */
function ReferenceChip({ testID, reference }: { readonly testID: string; readonly reference: string }) {
    const { t } = useTranslation();
    const toast = useToast();
    const clipboard = webClipboard();
    return (
        <View className="mt-3 flex-col items-start">
            <View
                testID={`${testID}-reference-chip`}
                className="flex-row items-center gap-2.5 rounded-2xl border border-stroke-subtle bg-surface-raised py-1.5 pe-1.5 ps-3.5 shadow-elevation-1"
            >
                <RNText className="text-xs font-semibold text-content-secondary">
                    {t('guest:order.reference')}
                </RNText>
                <RNText
                    testID={`${testID}-reference-keep`}
                    selectable
                    className="font-display text-base font-bold tracking-wide tabular-nums text-content-primary"
                >
                    {reference}
                </RNText>
                {clipboard === null ? null : (
                    <Pressable
                        testID={`${testID}-reference-copy`}
                        role="button"
                        accessibilityRole="button"
                        onPress={() => {
                            void clipboard.writeText(reference).then(() => {
                                toast.show({
                                    testID: `${testID}-reference-copied`,
                                    tone: 'success',
                                    message: t('guest:order.copied'),
                                });
                            });
                        }}
                        className="h-[34px] flex-row items-center gap-1.5 rounded-[11px] bg-surface-brand-subtle px-3 hover:opacity-90"
                    >
                        <Icon name="copy" size="sm" className="text-content-on-brand-subtle" />
                        <RNText className="text-xs font-bold text-content-on-brand-subtle">
                            {t('guest:order.copy')}
                        </RNText>
                    </Pressable>
                )}
            </View>
            <RNText className="mt-1.5 text-sm font-medium text-content-secondary text-start">
                {t('guest:order.keepReference')}
            </RNText>
        </View>
    );
}

/** The board's 44px soft buttons under the timeline — Refresh, Get help, Message the courier. */
function SoftButton({
    testID,
    label,
    icon,
    primary = false,
    busy = false,
    hint,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly icon: IconName;
    readonly primary?: boolean;
    readonly busy?: boolean;
    readonly hint?: string | undefined;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityHint={hint}
            disabled={busy}
            aria-busy={busy}
            accessibilityState={{ disabled: busy, busy }}
            onPress={onPress}
            className={cx(
                'h-11 flex-row items-center gap-2 rounded-[14px] border px-4',
                primary
                    ? 'border-surface-brand bg-surface-brand hover:opacity-90'
                    : 'border-stroke bg-surface-raised hover:bg-surface-brand-subtle',
            )}
        >
            {busy ? (
                <ActivityIndicator size="small" />
            ) : (
                <Icon
                    name={icon}
                    size="sm"
                    className={primary ? 'text-content-on-brand' : 'text-content-primary'}
                />
            )}
            <RNText
                className={cx(
                    'text-sm font-semibold',
                    primary ? 'text-content-on-brand' : 'text-content-primary',
                )}
            >
                {label}
            </RNText>
        </Pressable>
    );
}

/**
 * The board's road: a dashed line from the kitchen to the door, filled as far as the order has
 * come, with the rider on it — bobbing while the food is on the road. Drawn with flex parts, not an
 * inline `start`, so it runs the right way in Arabic.
 */
function Road({ progress, moving }: { readonly progress: number; readonly moving: boolean }) {
    const { enabled } = useMotion();
    const [bob] = useState(() => new Animated.Value(0));
    useEffect(() => {
        if (!enabled || !moving) return undefined;
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(bob, {
                    toValue: 1,
                    duration: 600,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: Platform.OS !== 'web',
                }),
                Animated.timing(bob, {
                    toValue: 0,
                    duration: 600,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: Platform.OS !== 'web',
                }),
            ]),
        );
        loop.start();
        return () => {
            loop.stop();
        };
    }, [bob, enabled, moving]);
    const share = Math.max(0, Math.min(1, progress));

    return (
        <View aria-hidden className="relative mt-[22px] h-14">
            {/* The dashes: short bars along the whole run. */}
            <View className="absolute end-[22px] start-[22px] top-[26px] h-1 flex-row justify-between overflow-hidden">
                {Array.from({ length: 48 }, (_, index) => (
                    <View key={index} className="h-1 w-2.5 rounded-full bg-content-on-canopy/30" />
                ))}
            </View>
            {/* How far it has come. */}
            <View className="absolute end-[22px] start-[22px] top-[26px] h-1 flex-row">
                <View className="h-1 rounded-full bg-stage-green" style={{ flex: share }} />
                <View style={{ flex: 1 - share }} />
            </View>
            <View className="absolute start-0 top-1.5 h-11 w-11 items-center justify-center rounded-full bg-content-on-canopy/15">
                <Icon name="store" size="md" className="text-content-on-canopy" />
            </View>
            <View className="absolute end-0 top-1.5 h-11 w-11 items-center justify-center rounded-full bg-content-on-canopy/15">
                <Icon name="home" size="md" className="text-content-on-canopy" />
            </View>
            {/* The rider, where the fill ends. */}
            <View className="absolute end-[22px] start-[22px] top-0.5 h-[52px] flex-row">
                <View style={{ flex: share }} />
                <View className="w-0 items-center">
                    <Animated.View
                        className="h-[52px] w-[52px] items-center justify-center rounded-full border-8 border-stage-green/20 bg-stage-green"
                        style={{
                            transform: [
                                {
                                    translateY: bob.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [0, -3],
                                    }),
                                },
                            ],
                        }}
                    >
                        <Icon name="bike" size="md" className="text-surface-canopy" />
                    </Animated.View>
                </View>
                <View style={{ flex: 1 - share }} />
            </View>
        </View>
    );
}
