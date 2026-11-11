import type {
    DeliveryFailureReason,
    KitchenOrder,
    KitchenOrderCancellationDisposition,
    KitchenOrderPaymentMethod,
    KitchenOrderPickableCancellationReason,
    OrderDeskDeliveryJob,
    OrderDeskPaymentSummary,
} from '@healthy360/api-client/contracts';
import {
    DELIVERY_FAILURE_REASONS,
    KITCHEN_ORDER_CANCELLATION_DISPOSITIONS,
    KITCHEN_ORDER_PAYMENT_METHODS,
    KITCHEN_ORDER_PICKABLE_CANCELLATION_REASONS,
} from '@healthy360/api-client/contracts';
import {
    Callout,
    DatePickerButton,
    Dialog,
    EmptyState,
    ErrorState,
    FilterChip,
    Icon,
    Inline,
    Select,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useCancelOrderMutation,
    useCloseFailedDeliveryMutation,
    useFailDeliveryMutation,
    useHandToCourierMutation,
    useRecordOrderPaymentMutation,
    useRedeliverOrderMutation,
} from '../../../data/kitchen-orders-hooks.ts';
import {
    useAssignDeliveryJobMutation,
    useOrderDeskDeliveryWindowsQuery,
    useOrderDeskDriversQuery,
} from '../../../data/order-desk-hooks.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { ChoiceRow, DeskButton, DeskTabs, initialsOf } from '../desk-kit/index.ts';
import {
    ORDER_CREATE_ON_BEHALF_PERMISSION,
    ORDER_SUPERVISE_PERMISSION,
} from '../entity-registry.ts';
import { minorAmountToInput, parseMinorAmount } from '../format.ts';
import {
    deliveryFailureReasonKey,
    filterDrivers,
    kitchenOrderCancellationDispositionKey,
    kitchenOrderCancellationReasonKey,
    kitchenOrderPaymentMethodKey,
} from '../ops-format.ts';
import { serverFieldErrors } from '../server-field-errors.ts';

/**
 * The Orders page's dialogs — one copy each, opened from a row's next step or from the order's
 * pop-up. They were the order desk's and the order book's; their behaviour is unchanged.
 *
 * Every way out that does nothing says **Back**. "Cancel" is kept for the one thing it means on
 * this page: cancelling an order.
 *
 * Each is mounted only while it is open, which gives every opening a clean sheet. A `409
 * resource.conflict` is told apart by whether a version came back: with one it is a lost race and
 * a Refresh is offered; without one the thing is over and refreshing would not change it.
 */

const EM_DASH = '—';

/* ── choose a driver ─────────────────────────────────────────────────────────────────────────── */

/**
 * Whose run it is. The version it sends is the **job's**, never the order's: assigning a driver
 * does not touch the order, and crossing the two earns a conflict nobody entered.
 */
export function AssignDriverDialog({
    job,
    orderNumber,
    onClose,
    onAssigned,
    onRefresh,
    refreshing,
    onCourier,
}: {
    readonly job: OrderDeskDeliveryJob;
    readonly orderNumber: string;
    readonly onClose: () => void;
    readonly onAssigned: (driverName: string) => void;
    readonly onRefresh: () => void;
    readonly refreshing: boolean;
    /**
     * The other way out of the kitchen: a courier company. Offered only once the food is ready and
     * nobody has set off with it — the rule the pop-up's Hand to courier follows.
     */
    readonly onCourier?: (() => void) | undefined;
}) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [chosen, setChosen] = useState<string | null>(job.driverUserId);

    const drivers = useOrderDeskDriversQuery();
    const assign = useAssignDeliveryJobMutation();

    const rows = useMemo(() => drivers.data?.rows ?? [], [drivers.data]);
    const filtered = useMemo(() => filterDrivers(rows, query), [rows, query]);
    const listFailure = toFailure(drivers.error);
    const assignFailure = toFailure(assign.error);
    const conflict = assignFailure?.code === 'resource.conflict' ? assignFailure : null;
    const lostRace = conflict !== null && conflict.currentLockVersion !== undefined;
    const assignRefusal = serverFieldErrors(assignFailure).unplaced;
    const chosenDriver = rows.find((driver) => driver.userId === chosen) ?? null;

    function confirm() {
        if (chosen === null) return;
        assign.mutate(
            { jobId: job.id, driverUserId: chosen, lockVersion: job.lockVersion },
            {
                onSuccess: () => {
                    onAssigned(chosenDriver?.displayName ?? EM_DASH);
                },
            },
        );
    }

    return (
        <Dialog
            testID="kitchen-orders-assign"
            look="card"
            open
            onClose={onClose}
            title={t('kitchen:desk.assign.title')}
            description={t('kitchen:desk.assign.description', { number: orderNumber })}
            actions={
                <>
                    <DeskButton
                        testID="kitchen-orders-assign-back"
                        variant="secondary"
                        label={t('kitchen:common.back')}
                        onPress={onClose}
                    />
                    <DeskButton
                        testID="kitchen-orders-assign-confirm"
                        label={
                            chosenDriver?.displayName == null
                                ? t('kitchen:desk.assign.confirm')
                                : t('kitchen:orders.driver.giveTo', {
                                      name: chosenDriver.displayName,
                                  })
                        }
                        loading={assign.isPending}
                        disabled={
                            chosen === null || chosen === job.driverUserId || assign.isPending
                        }
                        onPress={confirm}
                    />
                </>
            }
        >
            {assignFailure === null ? null : conflict !== null ? (
                <Callout
                    testID="kitchen-orders-assign-conflict"
                    tone="warning"
                    role="alert"
                    title={t(
                        lostRace
                            ? 'kitchen:desk.assign.raceTitle'
                            : 'kitchen:desk.assign.terminalTitle',
                    )}
                    body={t(
                        lostRace
                            ? 'kitchen:desk.assign.raceBody'
                            : 'kitchen:desk.assign.terminalBody',
                    )}
                    actions={
                        lostRace ? (
                            <DeskButton
                                testID="kitchen-orders-assign-conflict-refresh"
                                variant="secondary"
                                label={t('kitchen:ops.orders.conflictRefresh')}
                                loading={refreshing}
                                onPress={() => {
                                    assign.reset();
                                    onRefresh();
                                }}
                            />
                        ) : undefined
                    }
                />
            ) : (
                <Text testID="kitchen-orders-assign-error" tone="danger" role="alert">
                    {assignRefusal ?? assignFailure.message}
                </Text>
            )}

            <TextInputField
                testID="kitchen-orders-assign-search"
                id="kitchen-orders-assign-search"
                label={t('kitchen:desk.assign.searchLabel')}
                placeholder={t('kitchen:desk.assign.searchPlaceholder')}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                inputMode="search"
                returnKeyType="search"
                trailing={<Icon name="search" />}
            />

            {drivers.isPending ? (
                <Skeleton testID="kitchen-orders-assign-loading" heightClassName="h-24" />
            ) : listFailure !== null ? (
                <ErrorState
                    testID="kitchen-orders-assign-list-error"
                    title={t('kitchen:desk.assign.listErrorTitle')}
                    failure={listFailure}
                    onRetry={() => {
                        void drivers.refetch();
                    }}
                    retrying={drivers.isFetching}
                />
            ) : filtered.length === 0 ? (
                <EmptyState
                    testID="kitchen-orders-assign-empty"
                    title={t(
                        rows.length === 0
                            ? 'kitchen:desk.assign.noneTitle'
                            : 'kitchen:desk.assign.noMatchTitle',
                    )}
                    body={t(
                        rows.length === 0
                            ? 'kitchen:desk.assign.noneBody'
                            : 'kitchen:desk.assign.noMatchBody',
                    )}
                />
            ) : (
                // Choosing is not assigning — the footer button is, so one mis-tap never sends
                // tonight's run to the wrong person.
                <View
                    testID="kitchen-orders-assign-list"
                    role="radiogroup"
                    aria-label={t('kitchen:desk.assign.title')}
                    className="flex-col gap-0.5"
                >
                    {filtered.map((driver) => (
                        <ChoiceRow
                            key={driver.userId}
                            testID={`kitchen-orders-assign-driver-${driver.userId}`}
                            mark="avatar"
                            initials={initialsOf(driver.displayName)}
                            label={driver.displayName ?? EM_DASH}
                            {...(driver.displayName === null
                                ? { accessibilityLabel: t('kitchen:desk.assign.unnamed') }
                                : {})}
                            {...(driver.userId === job.driverUserId
                                ? { meta: t('kitchen:desk.assign.current') }
                                : {})}
                            selected={chosen === driver.userId}
                            onPress={() => {
                                setChosen(driver.userId);
                            }}
                        />
                    ))}
                </View>
            )}

            {onCourier === undefined ? null : (
                <View className="border-t border-stroke-subtle pt-2">
                    <DeskButton
                        testID="kitchen-orders-assign-courier"
                        variant="quiet"
                        label={t('kitchen:desk.assign.courierInstead')}
                        iconEnd={
                            <Icon
                                name="chevronForward"
                                size="sm"
                                className="text-content-on-brand-subtle"
                            />
                        }
                        onPress={onCourier}
                    />
                </View>
            )}
        </Dialog>
    );
}

/* ── hand to a courier ───────────────────────────────────────────────────────────────────────── */

/** A courier company took the food: a run nobody on the kitchen's own sheet will carry. */
export function HandToCourierDialog({
    order,
    onClose,
    onHanded,
}: {
    readonly order: KitchenOrder;
    readonly onClose: () => void;
    readonly onHanded: (courier: string) => void;
}) {
    const { t } = useTranslation();
    const hand = useHandToCourierMutation();
    const [name, setName] = useState('');
    const [reference, setReference] = useState('');
    const [fee, setFee] = useState('');

    const feeMinor = fee.trim() === '' ? undefined : parseMinorAmount(fee, order.currencyCode);
    const failure = toFailure(hand.error);

    function confirm() {
        if (name.trim() === '' || feeMinor === null) return;
        hand.mutate(
            {
                id: order.id,
                name: name.trim(),
                ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
                ...(feeMinor === undefined ? {} : { feeMinor }),
            },
            {
                onSuccess: () => {
                    onHanded(name.trim());
                },
            },
        );
    }

    return (
        <Dialog
            testID="kitchen-orders-courier"
            look="card"
            open
            onClose={onClose}
            title={t('kitchen:desk.courier.title')}
            description={t('kitchen:desk.courier.description', { number: order.orderNumber })}
            actions={
                <>
                    <DeskButton
                        testID="kitchen-orders-courier-back"
                        variant="secondary"
                        label={t('kitchen:common.back')}
                        onPress={onClose}
                    />
                    <DeskButton
                        testID="kitchen-orders-courier-confirm"
                        label={t('kitchen:desk.courier.confirm')}
                        loading={hand.isPending}
                        disabled={name.trim() === '' || feeMinor === null || hand.isPending}
                        onPress={confirm}
                    />
                </>
            }
        >
            {failure === null ? null : (
                <Text testID="kitchen-orders-courier-error" tone="danger" role="alert">
                    {failure.message}
                </Text>
            )}
            <TextInputField
                testID="kitchen-orders-courier-name"
                id="kitchen-orders-courier-name"
                label={t('kitchen:desk.courier.nameLabel')}
                value={name}
                onChangeText={setName}
                maxLength={120}
            />
            <TextInputField
                testID="kitchen-orders-courier-reference"
                id="kitchen-orders-courier-reference"
                label={t('kitchen:desk.courier.referenceLabel')}
                value={reference}
                onChangeText={setReference}
                maxLength={120}
                autoCapitalize="none"
                autoCorrect={false}
            />
            <TextInputField
                testID="kitchen-orders-courier-fee"
                id="kitchen-orders-courier-fee"
                label={t('kitchen:desk.courier.feeLabel', { currency: order.currencyCode })}
                placeholder={t('kitchen:fields.amountPlaceholder')}
                {...(feeMinor === null ? { error: t('kitchen:desk.courier.feeInvalid') } : {})}
                value={fee}
                onChangeText={setFee}
                inputMode="decimal"
                autoCapitalize="none"
                autoCorrect={false}
            />
        </Dialog>
    );
}

/* ── record a payment ────────────────────────────────────────────────────────────────────────── */

/**
 * Write down money that has arrived. Sends the **order's** version; the server does not move it,
 * so a second part payment can follow straight away. Prefilled with what is still owed, and
 * editable, because part payments are ordinary and an over-payment is still money that arrived.
 */
export function RecordPaymentDialog({
    order,
    payment,
    onClose,
    onRecorded,
    onRefresh,
    refreshing,
}: {
    readonly order: KitchenOrder;
    readonly payment: OrderDeskPaymentSummary;
    readonly onClose: () => void;
    readonly onRecorded: (amount: string) => void;
    readonly onRefresh: () => void;
    readonly refreshing: boolean;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const record = useRecordOrderPaymentMutation();

    const outstandingMinor = Math.max(0, order.totalMinor - payment.receivedMinor);
    const [method, setMethod] = useState<KitchenOrderPaymentMethod>(payment.method);
    const [amount, setAmount] = useState(() =>
        minorAmountToInput(outstandingMinor, order.currencyCode),
    );
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');

    const amountMinor = parseMinorAmount(amount, order.currencyCode);
    const amountValid = amountMinor !== null && amountMinor >= 1;

    const failure = toFailure(record.error);
    const conflict = failure?.code === 'resource.conflict' ? failure : null;
    const stale = conflict !== null && conflict.currentLockVersion !== undefined;
    const server = serverFieldErrors(failure, {
        method: {
            label: t('kitchen:desk.recordPayment.methodLabel'),
            fieldId: 'kitchen-orders-payment-method',
        },
        amount_minor: {
            label: t('kitchen:desk.recordPayment.amountLabel', { currency: order.currencyCode }),
            fieldId: 'kitchen-orders-payment-amount',
        },
        reference: {
            label: t('kitchen:desk.sale.referenceLabel'),
            fieldId: 'kitchen-orders-payment-reference',
        },
        notes: {
            label: t('kitchen:desk.sale.notesLabel'),
            fieldId: 'kitchen-orders-payment-notes',
        },
    });

    function submit() {
        if (amountMinor === null || !amountValid) return;
        record.mutate(
            {
                id: order.id,
                lockVersion: order.lockVersion,
                method,
                amountMinor,
                ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
                ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
            },
            {
                onSuccess: () => {
                    onRecorded(
                        formatMoney(formatter, {
                            amount: amountMinor,
                            currency: order.currencyCode,
                        }),
                    );
                },
            },
        );
    }

    return (
        <Dialog
            testID="kitchen-orders-payment"
            look="card"
            open
            onClose={onClose}
            title={t('kitchen:desk.recordPayment.title')}
            description={t('kitchen:orders.payment.dialogDescription', {
                number: order.orderNumber,
                outstanding: formatMoney(formatter, {
                    amount: outstandingMinor,
                    currency: order.currencyCode,
                }),
            })}
            actions={
                <>
                    <DeskButton
                        testID="kitchen-orders-payment-back"
                        variant="secondary"
                        label={t('kitchen:common.back')}
                        onPress={onClose}
                    />
                    <DeskButton
                        testID="kitchen-orders-payment-confirm"
                        label={t('kitchen:desk.recordPayment.confirm')}
                        loading={record.isPending}
                        disabled={!amountValid || record.isPending}
                        onPress={submit}
                    />
                </>
            }
        >
            {failure === null ? null : conflict !== null ? (
                <Callout
                    testID="kitchen-orders-payment-conflict"
                    tone="warning"
                    role="alert"
                    title={t(
                        stale
                            ? 'kitchen:ops.orders.conflictTitle'
                            : 'kitchen:desk.recordPayment.cancelledTitle',
                    )}
                    body={t(
                        stale
                            ? 'kitchen:ops.orders.conflictBody'
                            : 'kitchen:desk.recordPayment.cancelledBody',
                    )}
                    actions={
                        stale ? (
                            <DeskButton
                                testID="kitchen-orders-payment-conflict-refresh"
                                variant="secondary"
                                label={t('kitchen:ops.orders.conflictRefresh')}
                                loading={refreshing}
                                onPress={() => {
                                    record.reset();
                                    onRefresh();
                                }}
                            />
                        ) : undefined
                    }
                />
            ) : (
                <Text testID="kitchen-orders-payment-error" tone="danger" role="alert">
                    {server.unplaced ?? failure.message}
                </Text>
            )}

            <View className="flex-col gap-1.5">
                <Text variant="label" tone="secondary" className="!font-semibold">
                    {t('kitchen:desk.recordPayment.methodLabel')}
                </Text>
                <DeskTabs<KitchenOrderPaymentMethod>
                    testID="kitchen-orders-payment-method"
                    size="sm"
                    radio
                    block
                    label={t('kitchen:desk.recordPayment.methodLabel')}
                    value={method}
                    onChange={setMethod}
                    items={KITCHEN_ORDER_PAYMENT_METHODS.map((candidate) => ({
                        value: candidate,
                        label: t(kitchenOrderPaymentMethodKey(candidate)),
                        testID: `kitchen-orders-payment-method-${candidate}`,
                    }))}
                />
                {server.flag('method').error === undefined ? null : (
                    <Text variant="caption" tone="danger" role="alert">
                        {server.flag('method').error}
                    </Text>
                )}
            </View>

            {method === 'wish' ? (
                <Callout
                    testID="kitchen-orders-payment-wish-note"
                    tone="warning"
                    role="status"
                    title={t('kitchen:desk.sale.wishNoteTitle')}
                    body={t('kitchen:desk.sale.wishNoteBody')}
                />
            ) : null}

            <TextInputField
                testID="kitchen-orders-payment-amount"
                id="kitchen-orders-payment-amount"
                label={t('kitchen:desk.recordPayment.amountLabel', {
                    currency: order.currencyCode,
                })}
                placeholder={t('kitchen:fields.amountPlaceholder')}
                {...(amount.trim() !== '' && !amountValid
                    ? { error: t('kitchen:desk.recordPayment.amountInvalid') }
                    : server.flag('amount_minor'))}
                value={amount}
                onChangeText={setAmount}
                inputMode="decimal"
                autoCapitalize="none"
                autoCorrect={false}
            />

            <TextInputField
                testID="kitchen-orders-payment-reference"
                id="kitchen-orders-payment-reference"
                label={t('kitchen:desk.sale.referenceLabel')}
                hint={t(
                    method === 'wish'
                        ? 'kitchen:desk.recordPayment.referenceHintWish'
                        : 'kitchen:desk.recordPayment.referenceHint',
                )}
                placeholder={t('kitchen:desk.sale.referencePlaceholder')}
                {...server.flag('reference')}
                value={reference}
                onChangeText={setReference}
                autoCapitalize="none"
                autoCorrect={false}
            />

            <TextInputField
                testID="kitchen-orders-payment-notes"
                id="kitchen-orders-payment-notes"
                label={t('kitchen:desk.sale.notesLabel')}
                placeholder={t('kitchen:desk.recordPayment.notesPlaceholder')}
                {...server.flag('notes')}
                value={notes}
                onChangeText={setNotes}
                multiline
            />
        </Dialog>
    );
}

/* ── mark delivered ──────────────────────────────────────────────────────────────────────────── */

/** Closing a delivery by hand also ends the driver's run, so it is asked once (HA-29). */
export function MarkDeliveredDialog({
    orderNumber,
    pending,
    onClose,
    onConfirm,
}: {
    readonly orderNumber: string;
    readonly pending: boolean;
    readonly onClose: () => void;
    readonly onConfirm: () => void;
}) {
    const { t } = useTranslation();
    return (
        <Dialog
            testID="kitchen-orders-mark-delivered-dialog"
            look="card"
            open
            onClose={onClose}
            title={t('kitchen:ops.orders.markDeliveredTitle', { number: orderNumber })}
            description={t('kitchen:ops.orders.markDeliveredBody')}
            actions={
                <>
                    <DeskButton
                        testID="kitchen-orders-mark-delivered-back"
                        variant="secondary"
                        label={t('kitchen:common.back')}
                        onPress={onClose}
                    />
                    <DeskButton
                        testID="kitchen-orders-mark-delivered-confirm"
                        label={t('kitchen:ops.orders.markDelivered')}
                        loading={pending}
                        disabled={pending}
                        onPress={onConfirm}
                    />
                </>
            }
        />
    );
}

/* ── cancel the order ────────────────────────────────────────────────────────────────────────── */

/**
 * Cancelling is final and needs a reason. Once cooking has started it also needs to know what
 * became of the food.
 */
export function CancelOrderDialog({
    order,
    onClose,
    onCancelled,
}: {
    readonly order: KitchenOrder;
    readonly onClose: () => void;
    readonly onCancelled: (next: KitchenOrder) => void;
}) {
    const { t } = useTranslation();
    const cancelOrder = useCancelOrderMutation();
    const [reason, setReason] = useState<KitchenOrderPickableCancellationReason | null>(null);
    const [disposition, setDisposition] = useState<KitchenOrderCancellationDisposition | null>(
        null,
    );
    const started = (order.preparingAt ?? order.readyAt ?? null) !== null;
    const failure = toFailure(cancelOrder.error);

    function submit() {
        if (reason === null) return;
        cancelOrder.mutate(
            {
                id: order.id,
                lockVersion: order.lockVersion,
                reason,
                ...(disposition === null ? {} : { disposition }),
            },
            { onSuccess: onCancelled },
        );
    }

    return (
        <Dialog
            testID="kitchen-orders-cancel-dialog"
            look="card"
            open
            onClose={onClose}
            title={t('kitchen:ops.orders.cancelTitle', { number: order.orderNumber })}
            description={t('kitchen:ops.orders.cancelBody')}
            actions={
                <>
                    <DeskButton
                        testID="kitchen-orders-cancel-dismiss"
                        variant="secondary"
                        label={t('kitchen:ops.orders.cancelDismiss')}
                        onPress={onClose}
                    />
                    <DeskButton
                        testID="kitchen-orders-cancel-confirm"
                        variant="danger"
                        label={t('kitchen:ops.orders.cancelConfirm')}
                        loading={cancelOrder.isPending}
                        disabled={
                            reason === null ||
                            (started && disposition === null) ||
                            cancelOrder.isPending
                        }
                        onPress={submit}
                    />
                </>
            }
        >
            <Stack space="sm">
                <Text variant="label" tone="secondary" className="!font-semibold">
                    {t('kitchen:ops.orders.cancelReasonLabel')}
                </Text>
                <View
                    testID="kitchen-orders-cancel-reasons"
                    role="radiogroup"
                    aria-label={t('kitchen:ops.orders.cancelReasonLabel')}
                    className="flex-col gap-0.5"
                >
                    {KITCHEN_ORDER_PICKABLE_CANCELLATION_REASONS.map((candidate) => (
                        <ChoiceRow
                            key={candidate}
                            testID={`kitchen-orders-cancel-reason-${candidate}`}
                            label={t(kitchenOrderCancellationReasonKey(candidate))}
                            selected={reason === candidate}
                            onPress={() => {
                                setReason(candidate);
                            }}
                        />
                    ))}
                </View>
                {!started ? null : (
                    <>
                        <Text variant="label" tone="secondary" className="mt-2 !font-semibold">
                            {t('kitchen:ops.orders.dispositionLabel')}
                        </Text>
                        <View
                            testID="kitchen-orders-cancel-dispositions"
                            role="radiogroup"
                            aria-label={t('kitchen:ops.orders.dispositionLabel')}
                            className="flex-col gap-0.5"
                        >
                            {KITCHEN_ORDER_CANCELLATION_DISPOSITIONS.map((candidate) => (
                                <ChoiceRow
                                    key={candidate}
                                    testID={`kitchen-orders-cancel-disposition-${candidate}`}
                                    label={t(kitchenOrderCancellationDispositionKey(candidate))}
                                    selected={disposition === candidate}
                                    onPress={() => {
                                        setDisposition(candidate);
                                    }}
                                />
                            ))}
                        </View>
                    </>
                )}
                {failure === null ? null : (
                    <Text testID="kitchen-orders-cancel-error" tone="danger" role="alert">
                        {failure.code === 'resource.conflict'
                            ? t('kitchen:ops.orders.conflictTitle')
                            : (failure.message ?? t('kitchen:ops.orders.saveFailed'))}
                    </Text>
                )}
            </Stack>
        </Dialog>
    );
}

/* ── a failed or a courier's run ─────────────────────────────────────────────────────────────── */

export type DeliveryAction = 'fail' | 'redeliver' | 'close';

/** The empty choice in the slot picker: the order keeps the one it has. */
const KEEP_WINDOW = '';

/** Say a courier's delivery failed, send a failed one out again, or close it. */
export function DeliveryActionDialog({
    action,
    order,
    onClose,
}: {
    readonly action: DeliveryAction;
    readonly order: KitchenOrder;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const toast = useToast();
    const canBook = useCan(ORDER_CREATE_ON_BEHALF_PERMISSION);
    const canSupervise = useCan(ORDER_SUPERVISE_PERMISSION);
    const windows = useOrderDeskDeliveryWindowsQuery(
        action === 'redeliver' && (canBook || canSupervise),
    );

    const failDelivery = useFailDeliveryMutation();
    const redeliver = useRedeliverOrderMutation();
    const closeFailed = useCloseFailedDeliveryMutation();

    const [reason, setReason] = useState<DeliveryFailureReason | null>(null);
    const [note, setNote] = useState('');
    const [date, setDate] = useState('');
    const [window, setWindow] = useState(KEEP_WINDOW);
    const [disposition, setDisposition] = useState<KitchenOrderCancellationDisposition | null>(
        null,
    );

    const pending = failDelivery.isPending || redeliver.isPending || closeFailed.isPending;
    const failure =
        toFailure(failDelivery.error) ?? toFailure(redeliver.error) ?? toFailure(closeFailed.error);
    const ready =
        action === 'fail' ? reason !== null : action === 'close' ? disposition !== null : true;
    const number = order.orderNumber;

    function done(message: string) {
        onClose();
        toast.show({ testID: 'kitchen-orders-delivery-toast', tone: 'success', message });
    }

    function submit() {
        const version = { id: order.id, lockVersion: order.lockVersion };
        if (action === 'fail' && reason !== null) {
            failDelivery.mutate(
                { id: order.id, reason, note },
                { onSuccess: () => done(t('kitchen:ops.orders.failedToast', { number })) },
            );
        } else if (action === 'close' && disposition !== null) {
            closeFailed.mutate(
                { ...version, disposition },
                { onSuccess: () => done(t('kitchen:ops.orders.closedFailedToast', { number })) },
            );
        } else if (action === 'redeliver') {
            redeliver.mutate(
                {
                    ...version,
                    ...(date === '' ? {} : { date }),
                    ...(window === KEEP_WINDOW ? {} : { window }),
                },
                { onSuccess: () => done(t('kitchen:ops.orders.redeliveredToast', { number })) },
            );
        }
    }

    return (
        <Dialog
            testID="kitchen-orders-delivery-dialog"
            look="card"
            open
            onClose={onClose}
            title={t(`kitchen:ops.orders.deliveryAction.${action}Title`, { number })}
            description={t(`kitchen:ops.orders.deliveryAction.${action}Body`)}
            actions={
                <>
                    <DeskButton
                        testID="kitchen-orders-delivery-back"
                        variant="secondary"
                        label={t('kitchen:common.back')}
                        onPress={onClose}
                    />
                    <DeskButton
                        testID="kitchen-orders-delivery-confirm"
                        {...(action === 'redeliver' ? {} : { variant: 'danger' as const })}
                        label={t(`kitchen:ops.orders.deliveryAction.${action}Confirm`)}
                        loading={pending}
                        disabled={!ready || pending}
                        onPress={submit}
                    />
                </>
            }
        >
            <Stack space="sm">
                {action !== 'fail' ? null : (
                    <>
                        <Text variant="strong">{t('kitchen:driver.failReasonLabel')}</Text>
                        <Inline space="xs" wrap testID="kitchen-orders-delivery-reasons">
                            {DELIVERY_FAILURE_REASONS.map((candidate) => (
                                <FilterChip
                                    key={candidate}
                                    testID={`kitchen-orders-delivery-reason-${candidate}`}
                                    label={t(deliveryFailureReasonKey(candidate))}
                                    selected={reason === candidate}
                                    onChange={() => {
                                        setReason(candidate);
                                    }}
                                />
                            ))}
                        </Inline>
                        <TextInputField
                            testID="kitchen-orders-delivery-note"
                            id="kitchen-orders-delivery-note"
                            label={t('kitchen:driver.failNoteLabel')}
                            value={note}
                            onChangeText={setNote}
                            multiline
                            maxLength={1000}
                        />
                    </>
                )}
                {action !== 'redeliver' ? null : (
                    <>
                        <DatePickerButton
                            testID="kitchen-orders-delivery-date"
                            label={t('kitchen:ops.orders.deliveryAction.dateLabel')}
                            labelVisible
                            placeholder={t('kitchen:ops.orders.deliveryAction.keepDate')}
                            value={date}
                            onChange={setDate}
                            onClear={() => {
                                setDate('');
                            }}
                        />
                        {(windows.data ?? []).length === 0 ? null : (
                            <Select<string>
                                testID="kitchen-orders-delivery-window"
                                label={t('kitchen:ops.orders.deliveryWindow')}
                                size="sm"
                                value={window}
                                onChange={setWindow}
                                options={[
                                    {
                                        value: KEEP_WINDOW,
                                        label: t('kitchen:ops.orders.deliveryAction.keepWindow'),
                                    },
                                    ...(windows.data ?? []).map((candidate) => ({
                                        value: candidate.code,
                                        label: locale.toLowerCase().startsWith('ar')
                                            ? candidate.nameAr
                                            : candidate.nameEn,
                                    })),
                                ]}
                            />
                        )}
                    </>
                )}
                {action !== 'close' ? null : (
                    <>
                        <Text variant="strong">{t('kitchen:ops.orders.dispositionLabel')}</Text>
                        <Inline space="xs" wrap testID="kitchen-orders-delivery-dispositions">
                            {KITCHEN_ORDER_CANCELLATION_DISPOSITIONS.map((candidate) => (
                                <FilterChip
                                    key={candidate}
                                    testID={`kitchen-orders-delivery-disposition-${candidate}`}
                                    label={t(kitchenOrderCancellationDispositionKey(candidate))}
                                    selected={disposition === candidate}
                                    onChange={() => {
                                        setDisposition(candidate);
                                    }}
                                />
                            ))}
                        </Inline>
                    </>
                )}
                {failure === null ? null : (
                    <Text testID="kitchen-orders-delivery-error" tone="danger" role="alert">
                        {failure.message}
                    </Text>
                )}
            </Stack>
        </Dialog>
    );
}
