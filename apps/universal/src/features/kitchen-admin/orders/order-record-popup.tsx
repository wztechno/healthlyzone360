import type { KitchenOrder } from '@healthy360/api-client/contracts';
import type { OrderId } from '@healthy360/domain-types';
import { Badge, Callout, ErrorState, Inline, Skeleton, Text } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useKitchenOrderQuery } from '../../../data/kitchen-orders-hooks.ts';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';
import { dishOptionsLine } from '../../../ui/dish-choices.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import {
    CompactField,
    CompactRecordPopup,
    CompactSection,
} from '../catalogue/compact-record-popup.tsx';
import type { CompactFact } from '../catalogue/compact-record-popup.tsx';
import {
    ORDER_CREATE_ON_BEHALF_PERMISSION,
    ORDER_MANAGE_PERMISSION,
    ORDER_SUPERVISE_PERMISSION,
} from '../entity-registry.ts';
import {
    allergenLabel,
    allergyBanner,
    canAssignDeliveryJob,
    canCancelKitchenOrder,
    deliveryFailureReasonKey,
    kitchenOrderCancellationDispositionKey,
    kitchenOrderCancellationReasonKey,
    kitchenOrderPaymentMethodKey,
} from '../ops-format.ts';
import { DeskButton, DeskChip } from '../desk-kit/index.ts';
import { OrderComplaintAction } from '../order-complaint-action.tsx';
import { OrderRefundsSection } from '../order-refunds-section.tsx';
import { PlanDayMeals, isPlanDayLine, visibleOrderLines } from '../plan-day-meals.tsx';
import {
    driverCell,
    isLateOrder,
    isOpenOrder,
    nextStep,
    orderDay,
    owedMinor,
    windowHours,
    windowOf,
    withCourier,
} from './order-book.ts';
import type { BookRow } from './order-book.ts';
import {
    NEXT_STEP_KEYS,
    driverText,
    longDay,
    orderStatusLabel,
    orderStatusTone,
    relativeDay,
    shortDay,
} from './order-columns.tsx';
import { useDayOrders, useDeliveryWindows } from './use-order-book.ts';
import type { OrderSteps } from './use-order-steps.tsx';

/**
 * One order, from any tab — the order desk's pop-up and the order book's, merged into one, on the
 * compact pop-up (`CompactRecordPopup`, the design the user picked on 2026-11-10).
 *
 * The header is the order at a glance: its number, status and total, then one line with the day
 * and slot, the customer, the phone, where it goes and the money — and the next step beside them.
 * The body has the items on one side and the delivery, the payment and the history on the other.
 * Every other action is pinned at the foot, Cancel order at the far end. ‹ › step through the list
 * it was opened from.
 *
 * Two reads, as before: the **order** on its own, for the version a write sends; and its **row in
 * the book** for that day, which carries what has been paid, the driver's run and the customer.
 */

const EM_DASH = '—';

const STEP_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

type Formatter = ReturnType<typeof useFormatter>;

export function OrderRecordPopup({
    orderId,
    steps,
    now,
    today,
    windowName,
    driverName,
    returnTo,
    seed,
    siblings = [],
    onOpen,
    onClose,
}: {
    readonly orderId: OrderId;
    readonly steps: OrderSteps;
    readonly now: Date;
    readonly today: string;
    readonly windowName: (code: string) => string;
    readonly driverName: (userId: string) => string | null;
    /** The page as it is, without the pop-up — where Edit order comes back to. */
    readonly returnTo: string;
    /** The row the order was opened from, so its facts show at once while the order is re-read. */
    readonly seed?: BookRow | null | undefined;
    /** The list it was opened from, in its order — what ‹ › step through. */
    readonly siblings?: readonly BookRow[] | undefined;
    readonly onOpen?: ((order: BookRow) => void) | undefined;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const router = useRouter();
    const windows = useDeliveryWindows();
    const canManage = useCan(ORDER_MANAGE_PERMISSION);
    const canSell = useCan(ORDER_CREATE_ON_BEHALF_PERMISSION);
    const canSupervise = useCan(ORDER_SUPERVISE_PERMISSION);

    const detail = useKitchenOrderQuery(orderId);
    const order = detail.data ?? null;
    const day = order === null ? null : orderDay(order);
    const dayRead = useDayOrders(day ?? '', day !== null);
    const bookRow =
        dayRead.rows.find((row) => row.id === orderId) ??
        (seed != null && seed.id === orderId ? seed : null);
    // The order's latest version over the row's extras: the detail moves first after a write.
    const shown: BookRow | null = order === null ? bookRow : { ...(bookRow ?? {}), ...order };
    const failure = toFailure(detail.error);

    const index = siblings.findIndex((row) => row.id === orderId);
    const previous = index > 0 ? siblings[index - 1] : undefined;
    const next = index >= 0 ? siblings[index + 1] : undefined;
    const nav =
        index < 0 || siblings.length < 2 || onOpen === undefined
            ? undefined
            : {
                  position: t('kitchen:compactPopup.position', {
                      index: index + 1,
                      count: siblings.length,
                  }),
                  ...(previous === undefined
                      ? {}
                      : {
                            onPrevious: () => {
                                onOpen(previous);
                            },
                        }),
                  ...(next === undefined
                      ? {}
                      : {
                            onNext: () => {
                                onOpen(next);
                            },
                        }),
              };

    if (shown === null) {
        return (
            <CompactRecordPopup
                testID="kitchen-orders-record"
                label={t('kitchen:orders.record.loading')}
                kind={t('kitchen:recordView.eyebrowOrders')}
                title={t('kitchen:orders.record.loading')}
                nav={nav}
                onClose={onClose}
                main={
                    failure === null ? (
                        <Skeleton testID="kitchen-orders-record-loading" heightClassName="h-40" />
                    ) : (
                        <ErrorState
                            testID="kitchen-orders-record-error"
                            title={t('kitchen:ops.orders.detailLoadErrorTitle')}
                            failure={failure}
                            onRetry={() => {
                                void detail.refetch();
                            }}
                            retrying={detail.isFetching}
                        />
                    )
                }
            />
        );
    }

    const number = shown.orderNumber;
    const isDelivery = shown.fulfilmentType === 'delivery';
    const late = isLateOrder(shown, now, windows);
    const step = canManage ? nextStep(shown) : null;
    const owed = owedMinor(shown);
    const run = shown.deliveryRun ?? null;
    const job = shown.deliveryJob ?? null;
    const failed = run?.status === 'failed';
    const started = (shown.preparingAt ?? shown.readyAt ?? null) !== null;
    const pickedUp = (shown.delivery.pickedUpAt ?? null) !== null;
    const remakeOf = shown.remakeOf ?? null;
    const hours = windowHours(windowOf(shown, windows));
    const slotName =
        shown.delivery.windowCode === null
            ? t('kitchen:orders.slot.none')
            : windowName(shown.delivery.windowCode);
    const theDay = orderDay(shown);
    const relative = relativeDay(theDay, today, t, formatter);
    const isRelative = relative !== shortDay(theDay, formatter);
    const money = (amount: number) =>
        formatMoney(formatter, { amount, currency: shown.currencyCode });

    const cancelAllowed =
        canManage && canCancelKitchenOrder(shown.status) && !pickedUp && (!started || canSupervise);
    const stepReady =
        step !== null &&
        !(step === 'payment' && shown.payment === undefined) &&
        !(step === 'driver' && job === null);
    const canPay =
        canManage &&
        shown.status !== 'cancelled' &&
        owed !== null &&
        owed > 0 &&
        shown.payment !== undefined;
    const canDriver =
        canManage &&
        isDelivery &&
        isOpenOrder(shown) &&
        job !== null &&
        canAssignDeliveryJob(job.status) &&
        !withCourier(shown);
    const canCourier =
        canManage &&
        isDelivery &&
        job !== null &&
        (shown.readyAt ?? null) !== null &&
        (job.status === 'pending' || job.status === 'assigned');
    const driver = driverCell(shown, driverName);

    const facts: CompactFact[] = [
        {
            key: 'when',
            icon: 'calendarDays',
            text: [
                isRelative
                    ? `${relative}, ${shortDay(theDay, formatter)}`
                    : shortDay(theDay, formatter),
                [slotName, hours].filter((part): part is string => part !== null).join(' '),
            ].join(' · '),
            testID: 'kitchen-orders-record-when',
        },
        {
            key: 'customer',
            icon: 'person',
            text: shown.customer?.displayName ?? EM_DASH,
            testID: 'kitchen-orders-record-customer',
        },
        ...(shown.customer?.phone == null
            ? []
            : [
                  {
                      key: 'phone',
                      icon: 'smartphone' as const,
                      text: shown.customer.phone,
                      testID: 'kitchen-orders-record-phone',
                  },
              ]),
        {
            key: 'where',
            icon: 'mapPin',
            text: isDelivery
                ? (shown.delivery.areaNameEn ??
                  shown.delivery.city ??
                  t('kitchen:common.notRecorded'))
                : t('kitchen:orders.record.atCounter'),
        },
        {
            key: 'money',
            icon: 'banknote',
            testID: 'kitchen-orders-record-money',
            ...(shown.status === 'cancelled'
                ? { text: t('kitchen:orders.status.cancelled') }
                : owed === null
                  ? { text: t(kitchenOrderPaymentMethodKey(shown.paymentMethod)) }
                  : owed > 0
                    ? {
                          text: t('kitchen:orders.payment.toCollect', { amount: money(owed) }),
                          tone: 'warning' as const,
                      }
                    : {
                          text: t('kitchen:orders.record.paidBy', {
                              method: t(
                                  kitchenOrderPaymentMethodKey(
                                      shown.payment?.method ?? shown.paymentMethod,
                                  ),
                              ),
                          }),
                          tone: 'success' as const,
                      }),
        },
    ];

    const footer = (
        <>
            <DeskButton
                testID="kitchen-orders-record-print"
                variant="secondary"
                label={t('kitchen:kds.print')}
                onPress={() => {
                    router.push(
                        withReturnTo(
                            withQuery('/kitchen/orders/ticket', { order: String(shown.id) }),
                            withQuery(returnTo, { view: String(shown.id) }),
                        ) as never,
                    );
                }}
            />
            {!shown.amendable || !canSell ? null : (
                <DeskButton
                    testID="kitchen-orders-record-edit"
                    variant="secondary"
                    label={t('kitchen:desk.edit.open')}
                    onPress={() => {
                        router.push(
                            withReturnTo(
                                withQuery('/kitchen/order-desk/sale', { order: String(shown.id) }),
                                returnTo,
                            ) as never,
                        );
                    }}
                />
            )}
            {!failed || !canSupervise ? null : (
                <>
                    <DeskButton
                        testID="kitchen-orders-record-redeliver"
                        variant="secondary"
                        label={t('kitchen:ops.orders.redeliver')}
                        onPress={() => {
                            steps.openDelivery('redeliver', shown);
                        }}
                    />
                    <DeskButton
                        testID="kitchen-orders-record-close-failed"
                        variant="secondary"
                        label={t('kitchen:ops.orders.closeFailed')}
                        onPress={() => {
                            steps.openDelivery('close', shown);
                        }}
                    />
                </>
            )}
            {!canCourier ? null : (
                <DeskButton
                    testID="kitchen-orders-record-courier-open"
                    variant="secondary"
                    label={t('kitchen:desk.courier.open')}
                    onPress={() => {
                        steps.open('courier', shown);
                    }}
                />
            )}
            {!canManage || run?.status !== 'in_transit' || !withCourier(shown) ? null : (
                <DeskButton
                    testID="kitchen-orders-record-fail-delivery"
                    variant="secondary"
                    label={t('kitchen:ops.orders.failDelivery')}
                    onPress={() => {
                        steps.openDelivery('fail', shown);
                    }}
                />
            )}
            {remakeOf === null ? null : (
                <DeskButton
                    testID="kitchen-orders-record-remake-of"
                    variant="quiet"
                    label={t('kitchen:ops.orders.remakeOf', { number: remakeOf.number })}
                    onPress={() => {
                        router.setParams({ view: String(remakeOf.id) } as never);
                    }}
                />
            )}
        </>
    );

    return (
        <CompactRecordPopup
            testID="kitchen-orders-record"
            label={t('kitchen:ops.orders.detailTitle', { number })}
            kind={t(
                isDelivery
                    ? 'kitchen:orders.record.deliveryOrder'
                    : 'kitchen:orders.record.pickupOrder',
            )}
            title={number}
            nav={nav}
            chips={
                <>
                    <DeskChip
                        testID="kitchen-orders-record-status"
                        tone={orderStatusTone(shown)}
                        label={orderStatusLabel(shown, t)}
                    />
                    {late ? (
                        <DeskChip
                            testID="kitchen-orders-record-late"
                            tone="danger"
                            label={t('kitchen:orders.late')}
                        />
                    ) : null}
                    {shown.allergy === null ? null : (
                        <DeskChip
                            tone={shown.allergy.severe ? 'danger' : 'warning'}
                            label={t(
                                shown.allergy.severe
                                    ? 'kitchen:allergy.badgeSevere'
                                    : 'kitchen:allergy.badge',
                            )}
                        />
                    )}
                </>
            }
            figure={{ label: t('kitchen:ops.orders.total'), value: money(shown.totalMinor) }}
            facts={facts}
            primary={
                !stepReady || step === null ? undefined : (
                    <DeskButton
                        testID={`kitchen-orders-record-${step}`}
                        variant="primary"
                        label={t(NEXT_STEP_KEYS[step])}
                        loading={steps.pendingId === String(shown.id)}
                        disabled={steps.pendingId === String(shown.id)}
                        onPress={() => {
                            steps.run(shown, step);
                        }}
                    />
                )
            }
            banner={
                <>
                    {failure === null ? null : (
                        <ErrorState
                            testID="kitchen-orders-record-error"
                            title={t('kitchen:ops.orders.detailLoadErrorTitle')}
                            failure={failure}
                            onRetry={() => {
                                void detail.refetch();
                            }}
                            retrying={detail.isFetching}
                        />
                    )}
                    {shown.allergy === null ? null : (
                        <Callout
                            {...allergyBanner(shown.allergy, shown.lines, locale, t)}
                            testID="kitchen-orders-record-allergy"
                        />
                    )}
                </>
            }
            main={
                <CompactSection
                    title={t('kitchen:ops.orders.linesHeading')}
                    testID="kitchen-orders-record-items"
                >
                    <OrderLines order={shown} formatter={formatter} t={t} />
                    <Sum
                        label={t('kitchen:ops.orders.subtotal')}
                        value={money(shown.subtotalMinor)}
                    />
                    {shown.deliveryFeeMinor === null ? null : (
                        <Sum
                            label={t('kitchen:ops.orders.deliveryFee')}
                            value={money(shown.deliveryFeeMinor)}
                        />
                    )}
                    <Sum
                        label={t('kitchen:ops.orders.total')}
                        value={money(shown.totalMinor)}
                        total
                        testID="kitchen-orders-record-total"
                    />
                </CompactSection>
            }
            side={
                <>
                    <CompactSection
                        title={t(
                            isDelivery
                                ? 'kitchen:orders.record.delivery'
                                : 'kitchen:orders.record.pickup',
                        )}
                        testID="kitchen-orders-record-delivery"
                    >
                        <CompactField label={t('kitchen:orders.record.day')}>
                            <Text variant="strong">
                                {isRelative
                                    ? t('kitchen:orders.record.dayWithRelative', {
                                          day: longDay(theDay, formatter),
                                          relative,
                                      })
                                    : longDay(theDay, formatter)}
                            </Text>
                        </CompactField>
                        <CompactField label={t('kitchen:orders.record.slot')}>
                            <Text variant="strong">
                                {[slotName, hours]
                                    .filter((part): part is string => part !== null)
                                    .join(', ')}
                            </Text>
                        </CompactField>
                        <CompactField label={t('kitchen:orders.record.ordered')}>
                            <Text variant="strong">
                                {formatter.formatDate(shown.placedAt, STEP_TIME)}
                            </Text>
                        </CompactField>
                        {isDelivery ? (
                            <>
                                <CompactField label={t('kitchen:ops.orders.deliveryAddress')}>
                                    <Text variant="strong">{addressText(shown, t)}</Text>
                                </CompactField>
                                <CompactField
                                    label={t('kitchen:orders.column.driver')}
                                    testID="kitchen-orders-record-driver"
                                    action={
                                        !canDriver ? undefined : (
                                            <DeskButton
                                                testID="kitchen-orders-record-driver-open"
                                                variant="quiet"
                                                label={t(
                                                    job?.driverUserId == null
                                                        ? 'kitchen:orders.step.driver'
                                                        : 'kitchen:orders.record.change',
                                                )}
                                                onPress={() => {
                                                    steps.open('driver', shown);
                                                }}
                                            />
                                        )
                                    }
                                >
                                    <Text
                                        variant="strong"
                                        {...(driver.kind === 'needed'
                                            ? { tone: 'warning' as const }
                                            : {})}
                                    >
                                        {driverText(shown, t, driverName)}
                                    </Text>
                                    {run === null ? null : (
                                        <Text variant="caption" tone="secondary">
                                            {runState(shown, t)}
                                        </Text>
                                    )}
                                </CompactField>
                            </>
                        ) : (
                            <CompactField label={t('kitchen:orders.record.whereItIs')}>
                                <Text variant="strong">
                                    {t(
                                        shown.status === 'fulfilled'
                                            ? 'kitchen:orders.status.pickedUp'
                                            : shown.status === 'cancelled'
                                              ? 'kitchen:orders.status.cancelled'
                                              : 'kitchen:orders.record.waitingAtCounter',
                                    )}
                                </Text>
                            </CompactField>
                        )}
                    </CompactSection>

                    <CompactSection
                        title={t('kitchen:orders.record.payment')}
                        testID="kitchen-orders-record-payment"
                    >
                        <CompactField label={t('kitchen:orders.record.payingBy')}>
                            <Text variant="strong">
                                {t(
                                    kitchenOrderPaymentMethodKey(
                                        shown.payment?.method ?? shown.paymentMethod,
                                    ),
                                )}
                            </Text>
                        </CompactField>
                        <CompactField label={t('kitchen:orders.record.received')}>
                            <Text variant="strong" testID="kitchen-orders-record-received">
                                {shown.payment === undefined
                                    ? EM_DASH
                                    : money(shown.payment.receivedMinor)}
                            </Text>
                        </CompactField>
                        <CompactField
                            label={t('kitchen:orders.record.toCollect')}
                            action={
                                !canPay ? undefined : (
                                    <DeskButton
                                        testID="kitchen-orders-record-payment-open"
                                        variant="quiet"
                                        label={t('kitchen:desk.recordPayment.open')}
                                        onPress={() => {
                                            steps.open('payment', shown);
                                        }}
                                    />
                                )
                            }
                        >
                            <Text
                                variant="strong"
                                testID="kitchen-orders-record-owed"
                                {...(owed !== null && owed > 0 ? { tone: 'warning' as const } : {})}
                            >
                                {owed === null || owed === 0 ? EM_DASH : money(owed)}
                            </Text>
                        </CompactField>
                    </CompactSection>

                    <CompactSection title={t('kitchen:orders.record.history')}>
                        <OrderHistory order={shown} formatter={formatter} t={t} />
                    </CompactSection>

                    {order === null || !canSupervise ? null : (
                        <>
                            <CompactSection title={t('kitchen:ops.orders.refunds.heading')}>
                                <OrderRefundsSection order={order} />
                            </CompactSection>
                            <CompactSection title={t('kitchen:complaints.sectionTitle')}>
                                <OrderComplaintAction order={order} />
                            </CompactSection>
                        </>
                    )}
                </>
            }
            footer={footer}
            footerEnd={
                !cancelAllowed ? undefined : (
                    <DeskButton
                        testID="kitchen-orders-record-cancel"
                        variant="dangerOutline"
                        label={t('kitchen:ops.orders.cancel')}
                        onPress={() => {
                            steps.open('cancel', shown);
                        }}
                    />
                )
            }
            onClose={onClose}
        />
    );
}

/* ── parts ───────────────────────────────────────────────────────────────────────────────────── */

/** Where a delivery's run stands, in the kitchen display's words. */
function runState(order: BookRow, t: TFunction): string {
    const run = order.deliveryRun ?? null;
    if (run === null) return EM_DASH;
    if (run.status === 'failed') {
        return [
            t('kitchen:ops.orders.deliveryFailedNote', {
                reason: t(deliveryFailureReasonKey(run.failureReason ?? 'other')),
            }),
            run.failureNote,
        ]
            .filter((part) => part != null && part !== '')
            .join(t('kitchen:common.listSeparator'));
    }
    if (withCourier(order))
        return t('kitchen:ops.orders.withCourier', { name: run.courierName ?? '' });
    if (order.status === 'fulfilled') return t('kitchen:orders.status.delivered');
    if ((order.readyAt ?? null) === null) return t('kitchen:ops.orders.notReadyYet');
    return run.pickedUpAt === null
        ? t('kitchen:kds.waitingForDriver')
        : t('kitchen:kds.withDriver');
}

/** A sum under the items: a label, and its amount at the end. */
function Sum({
    label,
    value,
    total = false,
    testID,
}: {
    readonly label: string;
    readonly value: string;
    readonly total?: boolean | undefined;
    readonly testID?: string | undefined;
}) {
    return (
        <View
            className={`min-h-8 flex-row items-center justify-between ${
                total ? 'mt-0.5 border-t border-stroke-subtle pt-1.5' : ''
            }`}
        >
            <Text variant={total ? 'strong' : 'label'} tone={total ? 'primary' : 'secondary'}>
                {label}
            </Text>
            <Text
                testID={testID}
                variant={total ? 'title' : 'strong'}
                className={`tabular-nums ${total ? 'font-display' : ''}`}
                {...(total ? { tone: 'brand' as const } : {})}
            >
                {value}
            </Text>
        </View>
    );
}

/** The items: name (with its choices, note and allergens), quantity, line total. */
function OrderLines({
    order,
    formatter,
    t,
}: {
    readonly order: KitchenOrder;
    readonly formatter: Formatter;
    readonly t: TFunction;
}) {
    return (
        <View testID="kitchen-orders-record-lines" className="flex-col">
            {visibleOrderLines(order).map((line) => (
                <View
                    key={line.id}
                    className="min-h-8 flex-row items-start gap-2.5 border-b border-stroke-subtle py-2"
                >
                    {}
                    <View className="min-w-0 flex-1 flex-col gap-0.5">
                        <Text variant="strong">{line.nameEn}</Text>
                        {line.variantLabel === null ? null : (
                            <Text variant="caption" tone="secondary">
                                {line.variantLabel}
                            </Text>
                        )}
                        {dishOptionsLine(line.options, 'en', t) === null ? null : (
                            <Text variant="caption">{dishOptionsLine(line.options, 'en', t)}</Text>
                        )}
                        {line.note == null ? null : (
                            <Text variant="caption">
                                {t('kitchen:dishOptions.lineNote', { note: line.note })}
                            </Text>
                        )}
                        {isPlanDayLine(order, line) ? (
                            <PlanDayMeals order={order} testID="kitchen-orders-record-plan-day" />
                        ) : null}
                        {line.allergens.length === 0 ? null : (
                            <Inline space="xs" wrap>
                                {line.allergens.map((allergen) => (
                                    <Badge
                                        icon={null}
                                        key={allergen.allergenCode}
                                        tone={
                                            allergen.containment === 'contains'
                                                ? 'danger'
                                                : 'warning'
                                        }
                                        label={allergenLabel(allergen.allergenCode, t)}
                                    />
                                ))}
                            </Inline>
                        )}
                    </View>
                    <Text tone="secondary" className="w-12 text-end tabular-nums">
                        {t('kitchen:desk.lineQuantity', {
                            quantity: formatter.formatNumber(Number(line.quantity)),
                        })}
                    </Text>
                    <Text variant="strong" className="w-20 text-end tabular-nums">
                        {formatMoney(formatter, {
                            amount: line.lineTotalMinor,
                            currency: line.currencyCode,
                        })}
                    </Text>
                </View>
            ))}
        </View>
    );
}

/** What has happened to the order, in order — only the steps that did. */
function OrderHistory({
    order,
    formatter,
    t,
}: {
    readonly order: BookRow;
    readonly formatter: Formatter;
    readonly t: TFunction;
}) {
    const at = (instant: string) => formatter.formatDate(instant, STEP_TIME);
    const run = order.deliveryRun ?? null;
    const steps: {
        readonly key: string;
        readonly label: string;
        readonly when: string | null;
        readonly danger?: boolean;
    }[] = [
        { key: 'placed', label: t('kitchen:orders.history.placed'), when: order.placedAt },
        { key: 'confirmed', label: t('kitchen:orders.history.confirmed'), when: order.confirmedAt },
        {
            key: 'preparing',
            label: t('kitchen:orders.history.preparing'),
            when: order.preparingAt ?? null,
        },
        { key: 'ready', label: t('kitchen:orders.history.ready'), when: order.readyAt ?? null },
        ...(run === null
            ? []
            : [
                  {
                      key: 'given',
                      label: t('kitchen:orders.history.given', {
                          name: run.courierName ?? run.driverName ?? EM_DASH,
                      }),
                      when: run.assignedAt,
                  },
                  {
                      key: 'picked-up',
                      label: t('kitchen:orders.history.onTheWay'),
                      when: run.pickedUpAt,
                  },
                  {
                      key: 'run-failed',
                      label: t('kitchen:orders.history.failed'),
                      when: run.failedAt ?? null,
                      danger: true,
                  },
              ]),
        {
            key: 'fulfilled',
            label: t(
                order.fulfilmentType === 'delivery'
                    ? 'kitchen:orders.status.delivered'
                    : order.fulfilmentType === 'pickup'
                      ? 'kitchen:orders.status.pickedUp'
                      : 'kitchen:orders.status.sold',
            ),
            when: order.fulfilledAt,
        },
        {
            key: 'cancelled',
            label: [
                t('kitchen:orders.status.cancelled'),
                order.cancellationReason === null
                    ? null
                    : t(kitchenOrderCancellationReasonKey(order.cancellationReason)),
                (order.cancellationDisposition ?? null) === null
                    ? null
                    : t(
                          kitchenOrderCancellationDispositionKey(
                              order.cancellationDisposition ?? 'returned',
                          ),
                      ),
                order.cancelledByName ?? null,
            ]
                .filter((part): part is string => part !== null && part !== '')
                .join(' · '),
            when: order.cancelledAt,
            danger: true,
        },
    ];

    return (
        <View testID="kitchen-orders-record-history" className="flex-col">
            {steps
                .filter((step) => step.when !== null)
                .map((step) => (
                    <View
                        key={step.key}
                        testID={`kitchen-orders-record-history-${step.key}`}
                        className="min-h-8 flex-row items-center gap-2"
                    >
                        <View
                            aria-hidden
                            className={`h-2 w-2 rounded-full ${step.danger === true ? 'bg-danger' : 'bg-surface-brand'}`}
                        />
                        {}
                        <Text
                            variant="label"
                            className="min-w-0 flex-1"
                            tone={step.danger === true ? 'danger' : 'primary'}
                        >
                            {step.label}
                        </Text>
                        <Text variant="caption" tone="secondary" className="tabular-nums">
                            {step.when === null ? '' : at(step.when)}
                        </Text>
                    </View>
                ))}
        </View>
    );
}

function addressText(order: KitchenOrder, t: TFunction): string {
    const parts = [order.delivery.lineOne, order.delivery.lineTwo].filter(
        (part): part is string => part !== null && part !== '',
    );
    return parts.length === 0
        ? t('kitchen:common.notRecorded')
        : parts.join(t('kitchen:common.listSeparator'));
}
