import type { DeliveryAddress, GuestOrderState } from '@healthy360/api-client/contracts';
import { Button, Callout, Icon, useBreakpoint } from '@healthy360/design-system';
import type { Money } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { usePrototypeAction } from '../../prototype/index.ts';
import { Eyebrow } from '../../ui/eyebrow.tsx';
import { formatAddress } from '../commerce/address.ts';
import { formatMoney } from '../marketplace/format.ts';
import { OrderLineThumb } from './order-line-thumb.tsx';
import { currentStepIndex } from './order-progress.ts';
import { OrderTimeline } from './order-timeline.tsx';

/**
 * The HealthZone `track` screen's body, shared by the guest page (`/orders/{reference}`) and the
 * signed-in one (`/customer/orders/{order}`).
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
 *   confirmed" when the kitchen has not been given one. Never a countdown: there is no ETA.
 * * **The timeline card** — six steps (see `order-progress.ts`), the placement time against the
 *   first and "—" against the rest, the first step's detail carrying the payment and the total
 *   owed. Under a hairline, the design's three buttons: the primary refreshes the state from the
 *   server (the design's "simulate next status" is the canvas driving itself, and the honest version
 *   of "show me where it is now" is to ask again); "Message the courier" and "Get help" have no
 *   endpoint, so they are the prototype mechanism's controls.
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
    /** `YYYY-MM-DD`, or empty when the kitchen has not been given one. */
    readonly deliveryDate: string;
    readonly placedAt: string;
}

/** The design's white card: `--card` on a `--line` hairline, 16px corners. */
const CARD = 'flex-col rounded-xl border border-stroke bg-surface-raised';

export interface OrderTrackingProps {
    readonly order: TrackableOrder;
    /** The payment line, already translated — both pages are cash on delivery today. */
    readonly paymentLabel: string;
    /** Asks the server for the order again — the timeline card's primary action. */
    readonly onRefresh: () => void;
    readonly refreshing: boolean;
    /** Drawn at the foot of the timeline card, under the buttons. */
    readonly footer?: ReactNode;
    /** Prefix for every test ID — `guest-order`, `customer-order`. */
    readonly testID: string;
}

export function OrderTracking({
    order,
    paymentLabel,
    onRefresh,
    refreshing,
    footer,
    testID,
}: OrderTrackingProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();
    const prototype = usePrototypeAction();
    const wide = atLeast('md');

    const current = currentStepIndex(order.state);
    const placedAt = formatter.formatDate(order.placedAt, { timeStyle: 'short' });
    const slot = order.slotCode === '' ? null : t(`commerce:slots.${order.slotCode}`);
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

    return (
        <View className="flex-col">
            {/* ── opening: eyebrow, the status as the headline, the window on the canopy ── */}
            <View className="flex-row flex-wrap items-end justify-between gap-4">
                <View className="min-w-[260px] flex-1 flex-col">
                    <RNText
                        testID={`${testID}-eyebrow`}
                        selectable
                        className="text-xs font-medium uppercase tracking-widest text-content-secondary text-start"
                    >
                        {t('guest:order.number')}
                        <RNText testID={`${testID}-reference`}>{order.reference}</RNText>
                        {t('guest:order.separator')}
                        <RNText testID={`${testID}-placed`}>
                            {t('guest:order.placedAt', { time: placedAt })}
                        </RNText>
                    </RNText>
                    <RNText
                        testID={`${testID}-title`}
                        accessibilityRole="header"
                        aria-level={1}
                        // `text-4xl` (36px), the nearest step to the design's 38.
                        className="mt-2.5 font-display text-4xl font-bold leading-[1.05] tracking-display text-content-primary text-start"
                    >
                        {t(`guest:order.headline.${order.state}`)}
                    </RNText>
                    <RNText
                        testID={`${testID}-lead`}
                        className="mt-1.5 text-base text-content-secondary text-start"
                    >
                        {t(`guest:order.lead.${order.state}`)}
                    </RNText>
                </View>

                <View
                    testID={`${testID}-window`}
                    className="min-w-[190px] flex-col gap-1 rounded-panel bg-surface-canopy px-5 py-4"
                >
                    <Eyebrow tone="canopy">{t('guest:order.arriving')}</Eyebrow>
                    <RNText
                        testID={`${testID}-slot`}
                        className="font-display text-2xl font-bold tracking-display text-content-on-canopy text-start"
                    >
                        {arriving}
                    </RNText>
                </View>
            </View>

            {/* ── the timeline, and the three actions under it ── */}
            <View testID={`${testID}-progress`} className={`${CARD} mt-6 p-6`}>
                {current === null ? (
                    <Callout
                        testID={`${testID}-cancelled`}
                        role="status"
                        tone="info"
                        title={t('guest:order.cancelledTitle')}
                        body={t('guest:order.cancelledBody')}
                    />
                ) : (
                    <OrderTimeline
                        testID={`${testID}-timeline`}
                        current={current}
                        placedAt={placedAt}
                        placedDetail={t('guest:order.steps.placed.detail', {
                            payment: paymentLabel,
                            total: formatMoney(formatter, order.total),
                        })}
                    />
                )}
                <View className="mt-0.5 flex-row flex-wrap gap-2.5 border-t border-stroke-subtle pt-4">
                    <Button
                        testID={`${testID}-refresh`}
                        label={t('guest:order.refresh')}
                        loading={refreshing}
                        onPress={onRefresh}
                    />
                    <Button
                        testID={`${testID}-message`}
                        variant="secondary"
                        label={t('guest:order.messageCourier')}
                        accessibilityHint={t('marketplace:prototype.hint')}
                        onPress={() => {
                            prototype({ contract: 'POST /api/v1/orders/{order}/courier-messages' });
                        }}
                    />
                    <Button
                        testID={`${testID}-help`}
                        variant="quiet"
                        label={t('guest:order.getHelp')}
                        accessibilityHint={t('marketplace:prototype.hint')}
                        onPress={() => {
                            prototype({ contract: 'POST /api/v1/orders/{order}/support-requests' });
                        }}
                    />
                </View>
                {footer === undefined ? null : <View className="pt-4">{footer}</View>}
            </View>

            {/* ── what is in it, and who is bringing it where ── */}
            <View className={wide ? 'mt-4 flex-row items-stretch gap-4' : 'mt-4 flex-col gap-4'}>
                <View testID={`${testID}-items`} className={`${CARD} p-5 ${wide ? 'flex-1' : ''}`}>
                    <Eyebrow>{t('guest:order.itemsTitle')}</Eyebrow>
                    <View className="mt-3 flex-col gap-3" testID={`${testID}-lines`}>
                        {order.lines.map((line) => (
                            <View
                                key={line.id}
                                testID={`${testID}-line-${line.id}`}
                                className="flex-row items-center gap-3"
                            >
                                <OrderLineThumb
                                    name={line.name}
                                    className="h-[46px] w-[46px] rounded"
                                />
                                <RNText className="min-w-0 flex-1 text-sm text-content-primary text-start">
                                    {t('guest:order.lineLabel', {
                                        qty: formatter.formatNumber(line.quantity),
                                        name: line.name,
                                    })}
                                </RNText>
                                <RNText className="text-sm font-semibold tabular-nums text-content-primary text-end">
                                    {formatMoney(formatter, line.lineTotal)}
                                </RNText>
                            </View>
                        ))}
                    </View>
                </View>

                <View testID={`${testID}-detail`} className={`${CARD} p-5 ${wide ? 'flex-1' : ''}`}>
                    <Eyebrow>{t('guest:order.courierTitle')}</Eyebrow>
                    <View className="mt-3 flex-row items-center gap-3">
                        <View
                            aria-hidden
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            className="h-[52px] w-[52px] items-center justify-center rounded-full border border-stroke-subtle bg-surface-sunken"
                        >
                            <Icon name="bike" size="md" className="text-content-secondary" />
                        </View>
                        <View className="min-w-0 flex-1 flex-col">
                            <RNText className="font-display text-lg font-bold tracking-display text-content-primary text-start">
                                {t('guest:order.courierName')}
                            </RNText>
                            <RNText className="text-sm text-content-secondary text-start">
                                {t('guest:order.courierDetail')}
                            </RNText>
                        </View>
                    </View>
                    <RNText
                        testID={`${testID}-address`}
                        className="mt-4 border-t border-stroke-subtle pt-3 text-sm leading-relaxed text-content-primary text-start"
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
    );
}
