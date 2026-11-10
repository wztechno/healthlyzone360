import type { OrderDeskDeliveryWindow } from '@healthy360/api-client/contracts';
import { Text } from '@healthy360/design-system';
import type { BadgeTone } from '@healthy360/design-system';
import type { useFormatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { Text as RNText, View } from 'react-native';

import { formatMoney } from '../../marketplace/format.ts';
import { dateInstant } from '../../planner/format.ts';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { DeskButton, DeskChip } from '../desk-kit/index.ts';
import {
    kitchenOrderPaymentMethodKey,
    kitchenOrderRowTestId,
    kitchenOrderStatusTone,
} from '../ops-format.ts';
import {
    daysBetween,
    driverCell,
    isLateOrder,
    nextStep,
    orderDay,
    owedMinor,
    windowHours,
    windowOf,
} from './order-book.ts';
import type { BookRow, NextStep } from './order-book.ts';

/**
 * The Orders page's table, one spec for all three places it is drawn — Today, All orders and the
 * late group — so an order reads the same wherever it is found.
 *
 * ```
 * ORDER            CUSTOMER         DAY AND SLOT            STATUS           DRIVER         PAYMENT             TOTAL   NEXT STEP
 * ORD-K7M2Q9XW4P   Rania Haddad     Today · Lunch           (To confirm)     Needs a driver To collect $16.00   $16.00  [Confirm]
 * (Allergy)        +961 70 214 380  Tue 10 Nov, 12:00–14:00 (Late)                          Cash on delivery
 * ```
 */

const EM_DASH = '—';

type Formatter = ReturnType<typeof useFormatter>;

/** "To confirm", "Confirmed", "Delivered" / "Picked up" / "Sold", "Cancelled". */
export function orderStatusLabel(order: BookRow, t: TFunction): string {
    switch (order.status) {
        case 'placed':
            return t('kitchen:orders.status.toConfirm');
        case 'confirmed':
            return t('kitchen:orders.status.confirmed');
        case 'fulfilled':
            return t(
                order.fulfilmentType === 'delivery'
                    ? 'kitchen:orders.status.delivered'
                    : order.fulfilmentType === 'pickup'
                      ? 'kitchen:orders.status.pickedUp'
                      : 'kitchen:orders.status.sold',
            );
        case 'cancelled':
            return t('kitchen:orders.status.cancelled');
    }
}

export function orderStatusTone(order: BookRow): BadgeTone {
    return kitchenOrderStatusTone(order.status);
}

export const NEXT_STEP_KEYS: Readonly<Record<NextStep, string>> = {
    confirm: 'kitchen:orders.step.confirm',
    driver: 'kitchen:orders.step.driver',
    deliver: 'kitchen:orders.step.deliver',
    pickup: 'kitchen:orders.step.pickup',
    payment: 'kitchen:orders.step.payment',
};

/** "Today", "Tomorrow", "Yesterday" — or the date, short. */
export function relativeDay(
    day: string,
    today: string,
    t: TFunction,
    formatter: Formatter,
): string {
    const offset = daysBetween(today, day);
    if (offset === 0) return t('kitchen:orders.day.today');
    if (offset === 1) return t('kitchen:orders.day.tomorrow');
    if (offset === -1) return t('kitchen:orders.day.yesterday');
    return shortDay(day, formatter);
}

/** "Tue 10 Nov". */
export function shortDay(day: string, formatter: Formatter): string {
    return formatter.formatDate(dateInstant(day), {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
    });
}

/** "Tuesday 10 November". */
export function longDay(day: string, formatter: Formatter): string {
    return formatter.formatDate(dateInstant(day), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
    });
}

export interface OrderColumnContext {
    readonly t: TFunction;
    readonly formatter: Formatter;
    readonly today: string;
    readonly now: Date;
    readonly windows: readonly OrderDeskDeliveryWindow[];
    /** The slot's name as the kitchen named it. */
    readonly windowName: (code: string) => string;
    /** A driver's name from their member id, when the read named only the id. */
    readonly driverName: (userId: string) => string | null;
    /** `null` hides the Next step column: somebody who may only read sees no buttons. */
    readonly onStep: ((order: BookRow, step: NextStep) => void) | null;
    /** The order whose step is on its way. */
    readonly pendingId: string | null;
}

/** "Today · Lunch", and under it "Tue 10 Nov, 12:00–14:00". */
export function whenLines(
    order: BookRow,
    context: Pick<OrderColumnContext, 't' | 'formatter' | 'today' | 'windows' | 'windowName'>,
): { readonly main: string; readonly sub: string } {
    const { t, formatter, today, windows, windowName } = context;
    const day = orderDay(order);
    const relative = relativeDay(day, today, t, formatter);
    const code = order.delivery.windowCode;
    const slot = code === null ? t('kitchen:orders.slot.none') : windowName(code);
    const hours = windowHours(windowOf(order, windows));
    const dated = relative === shortDay(day, formatter) ? null : shortDay(day, formatter);
    const sub = [dated, hours].filter((part): part is string => part !== null).join(', ');
    return { main: `${relative} · ${slot}`, sub };
}

export function orderColumns(context: OrderColumnContext): readonly CatalogueColumn<BookRow>[] {
    const { t, formatter, now, windows, driverName, onStep, pendingId } = context;
    const id = (order: BookRow) => kitchenOrderRowTestId(String(order.id));

    const columns: CatalogueColumn<BookRow>[] = [
        {
            key: 'number',
            role: 'title',
            label: t('kitchen:orders.column.order'),
            width: 148,
            min: 148,
            grow: false,
            priority: 100,
            value: (order) => order.orderNumber,
            render: (order) => (
                <View className="flex-col items-start gap-hair">
                    <RNText
                        numberOfLines={1}
                        className="text-xs font-semibold tabular-nums text-content-secondary"
                        testID={`${id(order)}-number`}
                    >
                        {order.orderNumber}
                    </RNText>
                    {order.allergy === null ? null : (
                        <DeskChip
                            testID={`${id(order)}-allergy`}
                            tone={order.allergy.severe ? 'danger' : 'warning'}
                            label={t(
                                order.allergy.severe
                                    ? 'kitchen:allergy.badgeSevere'
                                    : 'kitchen:allergy.badge',
                            )}
                        />
                    )}
                </View>
            ),
        },
        {
            key: 'customer',
            role: 'meta',
            label: t('kitchen:orders.column.customer'),
            width: 160,
            min: 120,
            priority: 90,
            value: (order) => order.customer?.displayName ?? EM_DASH,
            render: (order) => (
                <View className="flex-col">
                    <Text
                        variant="strong"
                        numberOfLines={1}
                        className="font-bold"
                        testID={`${id(order)}-customer`}
                    >
                        {order.customer?.displayName ?? EM_DASH}
                    </Text>
                    {order.customer?.phone == null ? null : (
                        <SubLine testID={`${id(order)}-phone`}>{order.customer.phone}</SubLine>
                    )}
                </View>
            ),
        },
        {
            key: 'when',
            role: 'meta',
            label: t('kitchen:orders.column.when'),
            width: 170,
            min: 130,
            priority: 95,
            value: (order) => whenLines(order, context).main,
            render: (order) => {
                const lines = whenLines(order, context);
                return (
                    <View className="flex-col">
                        <Text
                            variant="strong"
                            numberOfLines={1}
                            className="font-bold"
                            testID={`${id(order)}-when`}
                        >
                            {lines.main}
                        </Text>
                        {lines.sub === '' ? null : <SubLine>{lines.sub}</SubLine>}
                    </View>
                );
            },
        },
        {
            key: 'status',
            role: 'status',
            label: t('kitchen:orders.column.status'),
            width: 120,
            priority: 92,
            value: (order) => orderStatusLabel(order, t),
            render: (order) => (
                <View className="flex-row flex-wrap items-center gap-1">
                    <DeskChip
                        testID={`${id(order)}-status`}
                        tone={orderStatusTone(order)}
                        label={orderStatusLabel(order, t)}
                    />
                    {isLateOrder(order, now, windows) ? (
                        <DeskChip
                            testID={`${id(order)}-late`}
                            tone="danger"
                            label={t('kitchen:orders.late')}
                        />
                    ) : null}
                </View>
            ),
        },
        {
            key: 'driver',
            label: t('kitchen:orders.column.driver'),
            width: 130,
            min: 100,
            priority: 70,
            value: (order) => driverText(order, t, driverName),
            render: (order) => {
                const cell = driverCell(order, driverName);
                if (cell.kind === 'needed') {
                    return (
                        <DeskChip
                            testID={`${id(order)}-driver`}
                            tone="warning"
                            label={t('kitchen:orders.driver.needed')}
                        />
                    );
                }
                return (
                    <RNText
                        numberOfLines={1}
                        className={`text-role-strong ${
                            cell.kind === 'named'
                                ? 'text-content-primary'
                                : 'font-medium text-content-secondary'
                        }`}
                        testID={`${id(order)}-driver`}
                    >
                        {driverText(order, t, driverName)}
                    </RNText>
                );
            },
        },
        {
            key: 'payment',
            label: t('kitchen:orders.column.payment'),
            width: 150,
            min: 120,
            priority: 80,
            value: (order) => paymentText(order, t, formatter).main,
            render: (order) => {
                const text = paymentText(order, t, formatter);
                return (
                    <View className="flex-col">
                        <Text
                            variant="strong"
                            tone={text.tone}
                            numberOfLines={1}
                            className={PAYMENT_INK[text.tone]}
                            testID={`${id(order)}-payment`}
                        >
                            {text.main}
                        </Text>
                        {text.sub === null ? null : <SubLine>{text.sub}</SubLine>}
                    </View>
                );
            },
        },
        {
            key: 'total',
            role: 'metric',
            label: t('kitchen:orders.column.total'),
            width: 84,
            priority: 85,
            value: (order) =>
                formatMoney(formatter, { amount: order.totalMinor, currency: order.currencyCode }),
            render: (order) => (
                <Text variant="strong" className="tabular-nums" testID={`${id(order)}-total`}>
                    {formatMoney(formatter, {
                        amount: order.totalMinor,
                        currency: order.currencyCode,
                    })}
                </Text>
            ),
        },
    ];

    if (onStep === null) return columns;

    return [
        ...columns,
        {
            key: 'next',
            label: t('kitchen:orders.column.next'),
            width: 148,
            priority: 98,
            align: 'end',
            grow: false,
            value: (order) => {
                const step = nextStep(order);
                return step === null ? '' : t(NEXT_STEP_KEYS[step]);
            },
            render: (order) => {
                const step = nextStep(order);
                // A payment needs to know what arrived; a driver needs the run. Without them the
                // step is the pop-up's, where the order is read whole.
                if (
                    step === null ||
                    (step === 'payment' && order.payment === undefined) ||
                    (step === 'driver' && order.deliveryJob == null)
                ) {
                    return null;
                }
                const pending = pendingId === String(order.id);
                return (
                    <DeskButton
                        testID={`${id(order)}-next`}
                        variant="next"
                        label={t(NEXT_STEP_KEYS[step])}
                        loading={pending}
                        disabled={pending}
                        onPress={() => {
                            onStep(order, step);
                        }}
                    />
                );
            },
        },
    ];
}

/**
 * A cell's second line — the phone, the slot's hours, how it is paid: 11px in the quiet ink. Drawn
 * with React Native's own `Text`, because a table cell's `Text` is held to the cell's one size and
 * ink (`TableCellTextContext`), and the canvas sets these lines apart.
 */
function SubLine({
    children,
    testID,
}: {
    readonly children: string;
    readonly testID?: string | undefined;
}) {
    return (
        <RNText
            numberOfLines={1}
            testID={testID}
            className="text-role-caption text-content-secondary"
        >
            {children}
        </RNText>
    );
}

/**
 * The canvas's payment inks: what is owed in the amber's own ink, paid in the brand's, and a
 * cancelled or account order quiet at body weight.
 */
const PAYMENT_INK: Readonly<Record<'primary' | 'secondary' | 'success' | 'warning', string>> = {
    primary: '',
    secondary: '!font-medium',
    success: '!text-content-on-brand-subtle',
    warning: '!text-warning-on-subtle',
};

/** Who carries it, in words. */
export function driverText(
    order: BookRow,
    t: TFunction,
    driverName: (userId: string) => string | null,
): string {
    const cell = driverCell(order, driverName);
    switch (cell.kind) {
        case 'pickup':
            return t('kitchen:orders.driver.pickup');
        case 'counter':
            return t('kitchen:orders.driver.counter');
        case 'named':
            return cell.name;
        case 'needed':
            return t('kitchen:orders.driver.needed');
        case 'none':
            return EM_DASH;
    }
}

/** "Paid" / "To collect $16.00", with how it is paid under it. */
export function paymentText(
    order: BookRow,
    t: TFunction,
    formatter: Formatter,
): {
    readonly main: string;
    readonly sub: string | null;
    readonly tone: 'primary' | 'secondary' | 'success' | 'warning';
} {
    const method = t(kitchenOrderPaymentMethodKey(order.payment?.method ?? order.paymentMethod));
    if (order.status === 'cancelled') return { main: EM_DASH, sub: null, tone: 'secondary' };
    const owed = owedMinor(order);
    if (owed === null) return { main: method, sub: null, tone: 'secondary' };
    if (owed === 0) return { main: t('kitchen:orders.payment.paid'), sub: method, tone: 'success' };
    return {
        main: t('kitchen:orders.payment.toCollect', {
            amount: formatMoney(formatter, { amount: owed, currency: order.currencyCode }),
        }),
        sub: method,
        tone: 'warning',
    };
}
