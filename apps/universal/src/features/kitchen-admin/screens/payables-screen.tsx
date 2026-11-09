import type { Payable } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Cascade,
    DatePickerButton,
    Dialog,
    EmptyState,
    ErrorState,
    Stack,
    TableSkeleton,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useApprovePayablePriceMutation,
    usePayablesQuery,
    usePayPayableMutation,
    useSetPayableDueDateMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import {
    INVENTORY_APPROVE_PAYABLES_PERMISSION,
    INVENTORY_VIEW_COSTS_PERMISSION,
} from '../entity-registry.ts';

/**
 * `/kitchen/supplier-bills?tab=bills` — what is owed for deliveries.
 *
 * Copied from the settlement page: two lists in the cash report's table and a dialog behind each
 * act. Nothing here sends money: Mark paid writes down a payment made by hand. A price waiting for
 * approval holds the payment and never the goods, so a row can read Price waiting with the stock
 * already on the shelf.
 */

const EM_DASH = '—';

/** Which dialog is open, on which row. */
type Acting =
    | { readonly kind: 'review'; readonly row: Payable }
    | { readonly kind: 'pay'; readonly row: Payable };

export function PayablesScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_COSTS_PERMISSION] }}
            testID="kitchen-payables"
        >
            <Payables />
        </Gate>
    );
}

function usePayableNames() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    return {
        supplier: (row: Payable) =>
            (locale === 'ar' ? row.supplierName.ar : '') ||
            row.supplierName.en ||
            t('kitchen:ops.payables.directPurchase'),
        money: (amount: string, currency: string | null) =>
            `${formatter.formatNumber(Number(amount), {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            })} ${currency ?? ''}`.trim(),
    };
}

function Payables() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const canAct = useCan(INVENTORY_APPROVE_PAYABLES_PERMISSION);
    const report = usePayablesQuery();
    const names = usePayableNames();
    const [acting, setActing] = useState<Acting | null>(null);

    const failure = toFailure(report.error);

    const owedColumns: readonly CatalogueColumn<Payable>[] = [
        {
            key: 'supplier',
            role: 'title',
            value: (row) => names.supplier(row),
            label: t('kitchen:ops.payables.columnSupplier'),
            width: 240,
            priority: 100,
            render: (row) => (
                <Stack space="xs">
                    <Text variant="strong">{names.supplier(row)}</Text>
                    <Text variant="caption" tone="secondary">
                        {row.supplierInvoiceRef ?? row.documentRef ?? EM_DASH}
                    </Text>
                </Stack>
            ),
        },
        {
            key: 'received',
            label: t('kitchen:ops.payables.columnReceived'),
            width: 120,
            priority: 60,
            render: (row) => (
                <Text tone="secondary" className="tabular-nums">
                    {row.receivedOn ?? EM_DASH}
                </Text>
            ),
        },
        {
            key: 'due',
            label: t('kitchen:ops.payables.columnDue'),
            width: 170,
            priority: 92,
            render: (row) =>
                row.isOverdue ? (
                    <View className="flex-row flex-wrap items-center gap-1.5">
                        <Text variant="mono">{row.dueOn}</Text>
                        <Badge
                            tone="warning"
                            icon="warning"
                            label={t('kitchen:ops.payables.overdue')}
                        />
                    </View>
                ) : (
                    <Text tone="secondary" className="tabular-nums">
                        {row.dueOn ?? t('kitchen:ops.payables.noDueDate')}
                    </Text>
                ),
        },
        {
            key: 'amount',
            role: 'metric',
            align: 'end',
            label: t('kitchen:ops.payables.columnAmount'),
            width: 150,
            priority: 95,
            render: (row) =>
                row.amount === null ? (
                    <Badge
                        tone="warning"
                        icon="warning"
                        label={t('kitchen:ops.payables.priceMissing')}
                    />
                ) : (
                    <Text variant="mono">{names.money(row.amount, row.currencyCode)}</Text>
                ),
        },
        {
            key: 'price',
            label: t('kitchen:ops.payables.columnPrice'),
            width: 170,
            priority: 90,
            render: (row) =>
                row.priceApprovalStatus === 'pending' ? (
                    <Badge
                        tone="warning"
                        icon="warning"
                        label={t('kitchen:ops.payables.priceWaiting')}
                    />
                ) : row.priceRises[0] !== undefined ? (
                    <Text tone="secondary" className="tabular-nums">
                        {t('kitchen:ops.payables.priceRise', {
                            percent: row.priceRises[0].priceVariancePercent,
                        })}
                    </Text>
                ) : (
                    <Text tone="secondary">{EM_DASH}</Text>
                ),
        },
        {
            key: 'action',
            align: 'end',
            label: t('kitchen:ops.payables.columnAction'),
            width: 130,
            priority: 99,
            render: (row) =>
                !canAct ? (
                    <Text tone="secondary">{EM_DASH}</Text>
                ) : row.priceApprovalStatus === 'pending' ? (
                    <Button
                        testID={`kitchen-payable-${row.id}-review`}
                        variant="secondary"
                        size="sm"
                        label={t('kitchen:ops.payables.review')}
                        onPress={() => {
                            setActing({ kind: 'review', row });
                        }}
                    />
                ) : row.amount === null ? (
                    <Text tone="secondary">{EM_DASH}</Text>
                ) : (
                    <Button
                        testID={`kitchen-payable-${row.id}-pay`}
                        variant="secondary"
                        size="sm"
                        label={t('kitchen:ops.payables.pay')}
                        onPress={() => {
                            setActing({ kind: 'pay', row });
                        }}
                    />
                ),
        },
    ];

    const paidColumns: readonly CatalogueColumn<Payable>[] = [
        {
            key: 'supplier',
            role: 'title',
            value: (row) => names.supplier(row),
            label: t('kitchen:ops.payables.columnSupplier'),
            width: 240,
            priority: 100,
            render: (row) => <Text variant="strong">{names.supplier(row)}</Text>,
        },
        {
            key: 'amount',
            role: 'metric',
            align: 'end',
            label: t('kitchen:ops.payables.columnAmount'),
            width: 150,
            priority: 95,
            render: (row) => (
                <Text variant="mono">
                    {row.amount === null ? EM_DASH : names.money(row.amount, row.currencyCode)}
                </Text>
            ),
        },
        {
            key: 'paid',
            label: t('kitchen:ops.payables.columnPaid'),
            width: 170,
            priority: 90,
            render: (row) => (
                <Text tone="secondary" className="tabular-nums">
                    {row.paidAt === null
                        ? EM_DASH
                        : formatter.formatDate(row.paidAt, { dateStyle: 'medium' })}
                </Text>
            ),
        },
        {
            key: 'reference',
            label: t('kitchen:ops.payables.columnReference'),
            width: 180,
            priority: 70,
            render: (row) => <Text tone="secondary">{row.paidReference ?? EM_DASH}</Text>,
        },
    ];

    const data = report.data;

    return (
        <Cascade space="md" testID="kitchen-payables-screen">
            {report.isPending ? (
                <TableSkeleton testID="kitchen-payables-loading" rows={6} />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-payables-error"
                    title={t('kitchen:ops.payables.loadErrorTitle')}
                    failure={failure}
                    onRetry={() => {
                        void report.refetch();
                    }}
                    retrying={report.isFetching}
                />
            ) : data === undefined ? null : (
                <View className="flex-col gap-loose">
                    <View className="flex-row flex-wrap items-baseline gap-x-snug">
                        <Text accessibilityRole="header" variant="title" className="font-display">
                            {t('kitchen:ops.payables.owedHeading')}
                        </Text>
                        {data.totals.length === 0 ? null : (
                            <Text tone="secondary" testID="kitchen-payables-totals">
                                {`${t('kitchen:ops.payables.totalsLabel')}: ${data.totals
                                    .map((total) => names.money(total.amount, total.currencyCode))
                                    .join(' · ')}`}
                            </Text>
                        )}
                    </View>
                    {data.unpaid.length === 0 ? (
                        <EmptyState
                            testID="kitchen-payables-owed-empty"
                            title={t('kitchen:ops.payables.owedEmpty')}
                        />
                    ) : (
                        <CatalogueList<Payable>
                            testID="kitchen-payables-owed"
                            label={t('kitchen:ops.payables.owedHeading')}
                            columns={owedColumns}
                            rows={data.unpaid}
                            rowKey={(row) => row.id}
                            rowActionsLabel={t('kitchen:list.rowActions')}
                        />
                    )}

                    <Text accessibilityRole="header" variant="title" className="font-display">
                        {t('kitchen:ops.payables.paidHeading')}
                    </Text>
                    {data.paid.length === 0 ? (
                        <EmptyState
                            testID="kitchen-payables-paid-empty"
                            title={t('kitchen:ops.payables.paidEmpty')}
                        />
                    ) : (
                        <CatalogueList<Payable>
                            testID="kitchen-payables-paid"
                            label={t('kitchen:ops.payables.paidHeading')}
                            columns={paidColumns}
                            rows={data.paid}
                            rowKey={(row) => row.id}
                            rowActionsLabel={t('kitchen:list.rowActions')}
                        />
                    )}
                </View>
            )}

            {acting === null ? null : acting.kind === 'review' ? (
                <ReviewDialog
                    row={acting.row}
                    onClose={() => {
                        setActing(null);
                    }}
                />
            ) : (
                <PayDialog
                    row={acting.row}
                    onClose={() => {
                        setActing(null);
                    }}
                />
            )}
        </Cascade>
    );
}

/** The rises on a delivery, and the one act that lets it be paid. */
function ReviewDialog({ row, onClose }: { readonly row: Payable; readonly onClose: () => void }) {
    const { t } = useTranslation();
    const toast = useToast();
    const names = usePayableNames();
    const approve = useApprovePayablePriceMutation();
    const failure = toFailure(approve.error);

    return (
        <Dialog
            testID="kitchen-payable-review-dialog"
            open
            onClose={onClose}
            title={t('kitchen:ops.payables.reviewTitle')}
            description={t('kitchen:ops.payables.reviewBody')}
            actions={
                <>
                    <Button
                        testID="kitchen-payable-review-dismiss"
                        variant="quiet"
                        label={t('kitchen:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="kitchen-payable-review-confirm"
                        label={t('kitchen:ops.payables.approve')}
                        loading={approve.isPending}
                        disabled={approve.isPending}
                        onPress={() => {
                            approve.mutate(row.id, {
                                onSuccess: () => {
                                    onClose();
                                    toast.show({
                                        testID: 'kitchen-payables-toast',
                                        tone: 'success',
                                        message: t('kitchen:ops.payables.approvedToast'),
                                    });
                                },
                            });
                        }}
                    />
                </>
            }
        >
            <Stack space="sm">
                <Stack space="xs" testID="kitchen-payable-review-lines">
                    {row.priceRises.map((rise) => (
                        <Text key={`${rise.nameEn ?? ''}-${rise.unitPriceAmount}`}>
                            {t('kitchen:ops.payables.reviewLine', {
                                name: rise.nameEn ?? EM_DASH,
                                last: names.money(rise.lastUnitPriceAmount, row.currencyCode),
                                price: names.money(rise.unitPriceAmount, row.currencyCode),
                                percent: rise.priceVariancePercent,
                            })}
                        </Text>
                    ))}
                </Stack>
                {failure === null ? null : (
                    <Callout
                        testID="kitchen-payable-review-error"
                        tone="danger"
                        title={t('kitchen:ops.payables.saveError')}
                        body={failure.message}
                    />
                )}
            </Stack>
        </Dialog>
    );
}

/** The payment's reference, and the place to move a due date. Open only while paying. */
function PayDialog({ row, onClose }: { readonly row: Payable; readonly onClose: () => void }) {
    const { t } = useTranslation();
    const toast = useToast();
    const names = usePayableNames();
    const pay = usePayPayableMutation();
    const setDue = useSetPayableDueDateMutation();
    const [reference, setReference] = useState('');
    const failure = toFailure(pay.error) ?? toFailure(setDue.error);

    return (
        <Dialog
            testID="kitchen-payable-pay-dialog"
            open
            onClose={onClose}
            title={t('kitchen:ops.payables.payTitle', { supplier: names.supplier(row) })}
            description={t('kitchen:ops.payables.payBody')}
            actions={
                <>
                    <Button
                        testID="kitchen-payable-pay-dismiss"
                        variant="quiet"
                        label={t('kitchen:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="kitchen-payable-pay-confirm"
                        label={t('kitchen:ops.payables.confirmPay')}
                        loading={pay.isPending}
                        disabled={pay.isPending}
                        onPress={() => {
                            pay.mutate(
                                { receiptId: row.id, reference: reference.trim() || null },
                                {
                                    onSuccess: () => {
                                        onClose();
                                        toast.show({
                                            testID: 'kitchen-payables-toast',
                                            tone: 'success',
                                            message: t('kitchen:ops.payables.paidToast'),
                                        });
                                    },
                                },
                            );
                        }}
                    />
                </>
            }
        >
            <Stack space="sm">
                <DatePickerButton
                    testID="kitchen-payable-due"
                    label={t('kitchen:ops.payables.dueLabel')}
                    labelVisible
                    value={
                        setDue.data?.unpaid.find((owed) => owed.id === row.id)?.dueOn ??
                        row.dueOn ??
                        ''
                    }
                    onChange={(next) => {
                        setDue.mutate(
                            { receiptId: row.id, dueOn: next },
                            {
                                onSuccess: () => {
                                    toast.show({
                                        testID: 'kitchen-payables-toast',
                                        tone: 'success',
                                        message: t('kitchen:ops.payables.dueToast'),
                                    });
                                },
                            },
                        );
                    }}
                />
                <TextInputField
                    testID="kitchen-payable-reference"
                    id="kitchen-payable-reference"
                    label={t('kitchen:ops.payables.referenceLabel')}
                    value={reference}
                    onChangeText={setReference}
                    maxLength={120}
                    autoCorrect={false}
                />
                {failure === null ? null : (
                    <Callout
                        testID="kitchen-payable-pay-error"
                        tone="danger"
                        title={t('kitchen:ops.payables.saveError')}
                        body={failure.message}
                    />
                )}
            </Stack>
        </Dialog>
    );
}
