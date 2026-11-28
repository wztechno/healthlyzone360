import { parseMinorAmount } from '@healthy360/domain-types';
import { KITCHEN_ORDER_PAYMENT_METHODS } from '@healthy360/api-client/contracts';
import type {
    KitchenOrder,
    KitchenOrderPaymentMethod,
    OrderRefund,
    OrderRefundKind,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Dialog,
    Inline,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCan } from '../../access/gate.tsx';
import { toFailure } from '../../data/hooks.ts';
import {
    useDecideOrderRefundMutation,
    useOrderRefundsQuery,
    useRecordOrderRefundMutation,
} from '../../data/kitchen-orders-hooks.ts';
import { formatMoney } from '../marketplace/format.ts';
import { DeskButton, DeskTabs } from './desk-kit/index.ts';
import { ORDER_APPROVE_REFUND_PERMISSION } from './entity-registry.ts';
import { kitchenOrderPaymentMethodKey } from './ops-format.ts';

import { DeskChip } from './desk-kit/desk-chip.tsx';
import { FailureToast } from './failure-toast.tsx';
/**
 * The refund part of the order record, for a manager. A ledger beside the receipts: entries are
 * added, never edited, and a receipt is never touched. One above the kitchen's limit waits here for
 * the owner, who reaches this page from the bell.
 */

const WHEN: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

const KINDS: readonly OrderRefundKind[] = ['refund', 'receipt_correction'];

export function OrderRefundsSection({ order }: { readonly order: KitchenOrder }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const canApprove = useCan(ORDER_APPROVE_REFUND_PERMISSION);
    const ledger = useOrderRefundsQuery(order.id);
    const decide = useDecideOrderRefundMutation();
    const [recording, setRecording] = useState(false);
    const [openedAt] = useState(() => Date.now());

    const position = ledger.data;
    if (position === undefined) {
        return null;
    }

    const money = (amount: number) =>
        formatMoney(formatter, { amount, currency: order.currencyCode });
    const windowClosed =
        position.windowClosesAt !== null && Date.parse(position.windowClosesAt) < openedAt;

    const figures = [
        { key: 'received', amount: position.receivedMinor, always: true },
        { key: 'refunded', amount: position.refundedMinor, always: false },
        { key: 'corrected', amount: position.correctedMinor, always: false },
        { key: 'pending', amount: position.pendingMinor, always: false },
        { key: 'refundable', amount: position.refundableMinor, always: true },
    ];

    return (
        <Stack space="sm" testID="kitchen-orders-refunds">
            <Stack space="xs">
                {figures
                    .filter((figure) => figure.always || figure.amount > 0)
                    .map((figure) => (
                        <Inline key={figure.key} space="sm" align="start" justify="between" wrap>
                            <Text tone="secondary" variant="caption">
                                {t(`kitchen:ops.orders.refunds.${figure.key}`)}
                            </Text>
                            <Text testID={`kitchen-orders-refunds-${figure.key}`}>
                                {money(figure.amount)}
                            </Text>
                        </Inline>
                    ))}
            </Stack>

            {position.entries.map((entry) => (
                <View
                    key={entry.id}
                    testID={`kitchen-orders-refund-${entry.id}`}
                    className="flex-col gap-tight border-t border-stroke-subtle pt-tight"
                >
                    <Inline space="sm" align="start" justify="between" wrap>
                        <Text variant="strong">{money(entry.amountMinor)}</Text>
                        <EntryBadge entry={entry} />
                    </Inline>
                    <Text variant="caption" tone="secondary">
                        {[
                            t(`kitchen:ops.orders.refunds.kind.${entry.kind}`),
                            t(kitchenOrderPaymentMethodKey(entry.method)),
                            entry.requestedByName ?? t('kitchen:common.notRecorded'),
                            formatter.formatDate(entry.requestedAt, WHEN),
                        ].join(t('kitchen:common.listSeparator'))}
                    </Text>
                    <Text>{entry.reason}</Text>
                    {entry.status !== 'pending_approval' || !canApprove ? null : (
                        <Inline space="xs" wrap>
                            <DeskButton
                                testID={`kitchen-orders-refund-${entry.id}-approve`}
                                variant="secondary"
                                label={t('kitchen:ops.orders.refunds.approve')}
                                disabled={decide.isPending}
                                onPress={() => {
                                    decide.mutate(
                                        { orderId: order.id, refundId: entry.id, approved: true },
                                        {
                                            onSuccess: () => {
                                                toast.show({
                                                    testID: 'kitchen-orders-refund-toast',
                                                    tone: 'success',
                                                    message: t(
                                                        'kitchen:ops.orders.refunds.approvedToast',
                                                    ),
                                                });
                                            },
                                        },
                                    );
                                }}
                            />
                            <DeskButton
                                testID={`kitchen-orders-refund-${entry.id}-reject`}
                                variant="secondary"
                                label={t('kitchen:ops.orders.refunds.reject')}
                                disabled={decide.isPending}
                                onPress={() => {
                                    decide.mutate(
                                        { orderId: order.id, refundId: entry.id, approved: false },
                                        {
                                            onSuccess: () => {
                                                toast.show({
                                                    testID: 'kitchen-orders-refund-toast',
                                                    tone: 'success',
                                                    message: t(
                                                        'kitchen:ops.orders.refunds.rejectedToast',
                                                    ),
                                                });
                                            },
                                        },
                                    );
                                }}
                            />
                        </Inline>
                    )}
                </View>
            ))}

            {windowClosed ? (
                <Text variant="caption" tone="secondary" testID="kitchen-orders-refunds-closed">
                    {t('kitchen:ops.orders.refunds.windowClosed')}
                </Text>
            ) : position.refundableMinor <= 0 ? null : (
                <View className="flex-row">
                    <DeskButton
                        testID="kitchen-orders-refund-open"
                        variant="secondary"
                        label={t('kitchen:ops.orders.refunds.open')}
                        onPress={() => {
                            setRecording(true);
                        }}
                    />
                </View>
            )}

            {!recording ? null : (
                <RefundDialog
                    order={order}
                    refundableMinor={position.refundableMinor}
                    onClose={() => {
                        setRecording(false);
                    }}
                />
            )}
        </Stack>
    );
}

function EntryBadge({ entry }: { readonly entry: OrderRefund }) {
    const { t } = useTranslation();
    const label = t(`kitchen:ops.orders.refunds.status.${entry.status}`);

    return entry.status === 'pending_approval' ? (
        <Badge tone="warning" icon="warning" label={label} />
    ) : entry.status === 'rejected' ? (
        <DeskChip tone="neutral" label={label} />
    ) : (
        <DeskChip tone="success" label={label} />
    );
}

/** Mounted only while open, so every opening starts clean. */
function RefundDialog({
    order,
    refundableMinor,
    onClose,
}: {
    readonly order: KitchenOrder;
    readonly refundableMinor: number;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const record = useRecordOrderRefundMutation();

    const [kind, setKind] = useState<OrderRefundKind>('refund');
    const [method, setMethod] = useState<KitchenOrderPaymentMethod>(order.paymentMethod);
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');

    const amountMinor = parseMinorAmount(amount, order.currencyCode);
    const amountValid = amountMinor !== null && amountMinor >= 1 && amountMinor <= refundableMinor;
    const ready = amountValid && reason.trim() !== '';
    const failure = toFailure(record.error);

    function submit() {
        if (amountMinor === null || !ready) return;
        record.mutate(
            { orderId: order.id, kind, method, amountMinor, reason: reason.trim() },
            {
                onSuccess: (ledger) => {
                    onClose();
                    toast.show({
                        testID: 'kitchen-orders-refund-toast',
                        tone: 'success',
                        message: t(
                            ledger.entries[0]?.status === 'pending_approval'
                                ? 'kitchen:ops.orders.refunds.waitingToast'
                                : 'kitchen:ops.orders.refunds.recordedToast',
                        ),
                    });
                },
            },
        );
    }

    return (
        <Dialog
            testID="kitchen-orders-refund-dialog"
            look="card"
            open
            onClose={onClose}
            title={t('kitchen:ops.orders.refunds.dialogTitle', { number: order.orderNumber })}
            description={t('kitchen:ops.orders.refunds.dialogBody')}
            actions={
                <>
                    <DeskButton
                        testID="kitchen-orders-refund-dismiss"
                        variant="secondary"
                        label={t('kitchen:common.back')}
                        onPress={onClose}
                    />
                    <DeskButton
                        testID="kitchen-orders-refund-confirm"
                        variant="primary"
                        label={t('kitchen:ops.orders.refunds.confirm')}
                        loading={record.isPending}
                        disabled={!ready || record.isPending}
                        onPress={submit}
                    />
                </>
            }
        >
            <Stack space="sm">
                <DeskTabs<OrderRefundKind>
                    testID="kitchen-orders-refund-kinds"
                    size="sm"
                    radio
                    block
                    label={t('kitchen:ops.orders.refunds.dialogTitle', {
                        number: order.orderNumber,
                    })}
                    value={kind}
                    onChange={setKind}
                    items={KINDS.map((candidate) => ({
                        value: candidate,
                        label: t(`kitchen:ops.orders.refunds.kind.${candidate}`),
                        testID: `kitchen-orders-refund-kind-${candidate}`,
                    }))}
                />
                <Text variant="caption" tone="secondary">
                    {t(`kitchen:ops.orders.refunds.kindHint.${kind}`)}
                </Text>
                <View className="flex-col gap-1.5">
                    <Text variant="label" tone="secondary" className="!font-semibold">
                        {t('kitchen:ops.orders.refunds.methodLabel')}
                    </Text>
                    <DeskTabs<KitchenOrderPaymentMethod>
                        testID="kitchen-orders-refund-method"
                        size="sm"
                        radio
                        block
                        label={t('kitchen:ops.orders.refunds.methodLabel')}
                        value={method}
                        onChange={setMethod}
                        items={KITCHEN_ORDER_PAYMENT_METHODS.map((candidate) => ({
                            value: candidate,
                            label: t(kitchenOrderPaymentMethodKey(candidate)),
                            testID: `kitchen-orders-refund-method-${candidate}`,
                        }))}
                    />
                </View>
                <TextInputField
                    testID="kitchen-orders-refund-amount"
                    id="kitchen-orders-refund-amount"
                    label={t('kitchen:ops.orders.refunds.amountLabel', {
                        currency: order.currencyCode,
                    })}
                    hint={t('kitchen:ops.orders.refunds.amountHint', {
                        refundable: formatMoney(formatter, {
                            amount: refundableMinor,
                            currency: order.currencyCode,
                        }),
                    })}
                    {...(amount.trim() !== '' && !amountValid
                        ? { error: t('kitchen:ops.orders.refunds.amountInvalid') }
                        : {})}
                    value={amount}
                    onChangeText={setAmount}
                    inputMode="decimal"
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                <TextInputField
                    testID="kitchen-orders-refund-reason"
                    id="kitchen-orders-refund-reason"
                    label={t('kitchen:ops.orders.refunds.reasonLabel')}
                    value={reason}
                    onChangeText={setReason}
                    multiline
                    maxLength={300}
                    required
                />
                <FailureToast
                    failure={failure}
                    testID="kitchen-orders-refund-error"
                    title={t('kitchen:ops.orders.refunds.saveError')}
                    body={failure?.message}
                />
            </Stack>
        </Dialog>
    );
}
