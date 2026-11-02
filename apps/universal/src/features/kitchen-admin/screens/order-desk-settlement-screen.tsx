import { parseMinorAmount } from '@healthy360/domain-types';
import type { CurrencyCode } from '@healthy360/domain-types';
import type {
    CashRun,
    CashSettlementRecord,
    CourierCashOwed,
    DriverCashOwed,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Cascade,
    Checkbox,
    Dialog,
    EmptyState,
    ErrorState,
    Stack,
    TableSkeleton,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useCashSettlementsQuery,
    useRecordCashSettlementMutation,
    useSignOffCashSettlementMutation,
} from '../../../data/order-desk-hooks.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { ORDER_SETTLE_CASH_PERMISSION, ORDER_SUPERVISE_PERMISSION } from '../entity-registry.ts';

/**
 * `/kitchen/order-desk/settlement` — cash coming back from the road.
 *
 * Three lists on one page, in the cash report's table: drivers holding cash, couriers owing a batch,
 * and the recent hand-ins. Pressing Settle opens the runs behind a row. There is no shift table, so
 * a driver's shift is whatever they have not yet handed in.
 *
 * A short hand-in needs a reason and waits for a manager's sign-off. The app takes no pay decision.
 */

const EM_DASH = '—';

/** Which row's Settle dialog is open. */
type Settling =
    | { readonly kind: 'driver'; readonly row: DriverCashOwed }
    | { readonly kind: 'courier'; readonly row: CourierCashOwed };

export function OrderDeskSettlementScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_SETTLE_CASH_PERMISSION] }}
            testID="kitchen-order-desk-settlement"
        >
            <OrderDeskSettlement />
        </Gate>
    );
}

function OrderDeskSettlement() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const canSignOff = useCan(ORDER_SUPERVISE_PERMISSION);
    const report = useCashSettlementsQuery();
    const signOff = useSignOffCashSettlementMutation();
    const [settling, setSettling] = useState<Settling | null>(null);

    const failure = toFailure(report.error);

    const money = (amount: number, currency: CurrencyCode) =>
        formatMoney(formatter, { amount, currency });
    const name = (value: string | null) => value ?? EM_DASH;

    const driverColumns: readonly CatalogueColumn<DriverCashOwed>[] = [
        {
            key: 'driver',
            role: 'title',
            value: (row) => name(row.displayName),
            label: t('kitchen:ops.settlement.columnDriver'),
            width: 220,
            priority: 100,
            render: (row) => <Text variant="strong">{name(row.displayName)}</Text>,
        },
        {
            key: 'runs',
            label: t('kitchen:ops.settlement.columnRuns'),
            width: 80,
            priority: 80,
            render: (row) => (
                <Text variant="mono" tone="secondary">
                    {formatter.formatNumber(row.runs.length)}
                </Text>
            ),
        },
        {
            key: 'amount',
            role: 'metric',
            label: t('kitchen:ops.settlement.columnCollected'),
            width: 140,
            priority: 95,
            render: (row) => (
                <Text variant="mono">{money(row.collectedMinor, row.currencyCode)}</Text>
            ),
        },
        {
            key: 'settle',
            label: t('kitchen:ops.settlement.columnAction'),
            width: 120,
            priority: 99,
            render: (row) => (
                <Button
                    testID={`kitchen-settlement-driver-${row.driverUserId}-settle`}
                    variant="secondary"
                    size="sm"
                    label={t('kitchen:ops.settlement.settle')}
                    onPress={() => {
                        setSettling({ kind: 'driver', row });
                    }}
                />
            ),
        },
    ];

    const courierColumns: readonly CatalogueColumn<CourierCashOwed>[] = [
        {
            key: 'courier',
            role: 'title',
            value: (row) => row.courierName,
            label: t('kitchen:ops.settlement.columnCourier'),
            width: 220,
            priority: 100,
            render: (row) => <Text variant="strong">{row.courierName}</Text>,
        },
        {
            key: 'runs',
            label: t('kitchen:ops.settlement.columnRuns'),
            width: 80,
            priority: 80,
            render: (row) => (
                <Text variant="mono" tone="secondary">
                    {formatter.formatNumber(row.runs.length)}
                </Text>
            ),
        },
        {
            key: 'due',
            role: 'metric',
            label: t('kitchen:ops.settlement.columnDue'),
            width: 140,
            priority: 95,
            render: (row) => <Text variant="mono">{money(row.dueMinor, row.currencyCode)}</Text>,
        },
        {
            key: 'fee',
            label: t('kitchen:ops.settlement.columnFee'),
            width: 120,
            priority: 70,
            render: (row) => (
                <Text variant="mono" tone="secondary">
                    {money(row.feeMinor, row.currencyCode)}
                </Text>
            ),
        },
        {
            key: 'settle',
            label: t('kitchen:ops.settlement.columnAction'),
            width: 120,
            priority: 99,
            render: (row) => (
                <Button
                    testID={`kitchen-settlement-courier-${row.courierName}-settle`}
                    variant="secondary"
                    size="sm"
                    label={t('kitchen:ops.settlement.settle')}
                    onPress={() => {
                        setSettling({ kind: 'courier', row });
                    }}
                />
            ),
        },
    ];

    const recentColumns: readonly CatalogueColumn<CashSettlementRecord>[] = [
        {
            key: 'when',
            label: t('kitchen:ops.settlement.columnWhen'),
            width: 170,
            priority: 80,
            render: (row) => (
                <Text tone="secondary" className="tabular-nums">
                    {formatter.formatDate(row.recordedAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                    })}
                </Text>
            ),
        },
        {
            key: 'party',
            role: 'title',
            value: (row) => name(row.partyName),
            label: t('kitchen:ops.settlement.columnParty'),
            width: 200,
            priority: 100,
            render: (row) => <Text variant="strong">{name(row.partyName)}</Text>,
        },
        {
            key: 'handed',
            role: 'metric',
            label: t('kitchen:ops.settlement.columnHandedIn'),
            width: 140,
            priority: 95,
            render: (row) => (
                <Text variant="mono">{money(row.handedInMinor, row.currencyCode)}</Text>
            ),
        },
        {
            key: 'short',
            label: t('kitchen:ops.settlement.columnShort'),
            width: 240,
            priority: 90,
            render: (row) =>
                row.shortMinor === 0 ? (
                    <Text tone="secondary">{EM_DASH}</Text>
                ) : (
                    <Stack space="xs">
                        <Text variant="mono">{money(row.shortMinor, row.currencyCode)}</Text>
                        <Text variant="caption" tone="secondary">
                            {row.shortReason}
                        </Text>
                    </Stack>
                ),
        },
        {
            key: 'status',
            label: t('kitchen:ops.settlement.columnStatus'),
            width: 180,
            priority: 92,
            render: (row) =>
                row.shortMinor === 0 ? (
                    <Badge tone="success" label={t('kitchen:ops.settlement.settled')} />
                ) : row.signedOffAt !== null ? (
                    <Badge tone="neutral" label={t('kitchen:ops.settlement.signedOff')} />
                ) : canSignOff ? (
                    <Button
                        testID={`kitchen-settlement-${row.id}-sign-off`}
                        variant="secondary"
                        size="sm"
                        label={t('kitchen:ops.settlement.signOff')}
                        disabled={signOff.isPending}
                        onPress={() => {
                            signOff.mutate(row.id, {
                                onSuccess: () => {
                                    toast.show({
                                        testID: 'kitchen-settlement-toast',
                                        tone: 'success',
                                        message: t('kitchen:ops.settlement.signedOffToast'),
                                    });
                                },
                            });
                        }}
                    />
                ) : (
                    <Badge
                        tone="warning"
                        icon="warning"
                        label={t('kitchen:ops.settlement.awaitingSignOff')}
                    />
                ),
        },
    ];

    const data = report.data;

    return (
        <Cascade space="md" testID="kitchen-order-desk-settlement-screen">
            {report.isPending ? (
                <TableSkeleton testID="kitchen-order-desk-settlement-loading" rows={6} />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-order-desk-settlement-error"
                    title={t('kitchen:ops.settlement.loadErrorTitle')}
                    failure={failure}
                    onRetry={() => {
                        void report.refetch();
                    }}
                    retrying={report.isFetching}
                />
            ) : data === undefined ? null : (
                <View className="flex-col gap-loose">
                    <Text variant="section" accessibilityRole="header">
                        {t('kitchen:ops.settlement.driversHeading')}
                    </Text>
                    {data.drivers.length === 0 ? (
                        <EmptyState
                            testID="kitchen-settlement-drivers-empty"
                            title={t('kitchen:ops.settlement.driversEmpty')}
                        />
                    ) : (
                        <CatalogueList<DriverCashOwed>
                            testID="kitchen-settlement-drivers"
                            label={t('kitchen:ops.settlement.driversHeading')}
                            columns={driverColumns}
                            rows={data.drivers}
                            rowKey={(row) => `${row.driverUserId}-${row.currencyCode}`}
                            rowActionsLabel={t('kitchen:list.rowActions')}
                        />
                    )}

                    <Text variant="section" accessibilityRole="header">
                        {t('kitchen:ops.settlement.couriersHeading')}
                    </Text>
                    {data.couriers.length === 0 ? (
                        <EmptyState
                            testID="kitchen-settlement-couriers-empty"
                            title={t('kitchen:ops.settlement.couriersEmpty')}
                        />
                    ) : (
                        <CatalogueList<CourierCashOwed>
                            testID="kitchen-settlement-couriers"
                            label={t('kitchen:ops.settlement.couriersHeading')}
                            columns={courierColumns}
                            rows={data.couriers}
                            rowKey={(row) => `${row.courierName}-${row.currencyCode}`}
                            rowActionsLabel={t('kitchen:list.rowActions')}
                        />
                    )}

                    <Text variant="section" accessibilityRole="header">
                        {t('kitchen:ops.settlement.recentHeading')}
                    </Text>
                    {data.settlements.length === 0 ? (
                        <EmptyState
                            testID="kitchen-settlement-recent-empty"
                            title={t('kitchen:ops.settlement.recentEmpty')}
                        />
                    ) : (
                        <CatalogueList<CashSettlementRecord>
                            testID="kitchen-settlement-recent"
                            label={t('kitchen:ops.settlement.recentHeading')}
                            columns={recentColumns}
                            rows={data.settlements}
                            rowKey={(row) => row.id}
                            rowActionsLabel={t('kitchen:list.rowActions')}
                        />
                    )}
                </View>
            )}

            {settling === null ? null : (
                <SettleDialog
                    settling={settling}
                    onClose={() => {
                        setSettling(null);
                    }}
                />
            )}
        </Cascade>
    );
}

/** The runs behind a row, what came back, and why if it is short. Open only while settling. */
function SettleDialog({
    settling,
    onClose,
}: {
    readonly settling: Settling;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const record = useRecordCashSettlementMutation();

    const { row } = settling;
    const currency = row.currencyCode;
    const runs: readonly CashRun[] = row.runs;
    const title =
        settling.kind === 'driver'
            ? (settling.row.displayName ?? EM_DASH)
            : settling.row.courierName;

    const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
    const chosen = runs.filter((run) => !excluded.has(run.jobId));
    const expected = chosen.reduce((sum, run) => sum + run.amountMinor, 0);
    const fees =
        settling.kind === 'courier'
            ? settling.row.runs
                  .filter((run) => !excluded.has(run.jobId))
                  .reduce((sum, run) => sum + run.feeMinor, 0)
            : 0;
    const net = expected - fees;

    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');

    const handedIn = parseMinorAmount(amount, currency);
    const amountValid = handedIn !== null && handedIn <= net;
    const short = handedIn === null ? 0 : net - handedIn;
    const ready = chosen.length > 0 && amountValid && (short <= 0 || reason.trim() !== '');
    const failure = toFailure(record.error);

    const money = (value: number) => formatMoney(formatter, { amount: value, currency });

    function submit() {
        if (handedIn === null || !ready) return;
        record.mutate(
            {
                jobIds: chosen.map((run) => run.jobId),
                handedInMinor: handedIn,
                ...(short > 0 ? { shortReason: reason.trim() } : {}),
            },
            {
                onSuccess: () => {
                    onClose();
                    toast.show({
                        testID: 'kitchen-settlement-toast',
                        tone: 'success',
                        message: t('kitchen:ops.settlement.savedToast'),
                    });
                },
            },
        );
    }

    return (
        <Dialog
            testID="kitchen-settlement-dialog"
            open
            onClose={onClose}
            title={t('kitchen:ops.settlement.dialogTitle', { name: title })}
            description={t(`kitchen:ops.settlement.dialogBody.${settling.kind}`)}
            actions={
                <>
                    <Button
                        testID="kitchen-settlement-dismiss"
                        variant="quiet"
                        label={t('kitchen:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="kitchen-settlement-confirm"
                        label={t('kitchen:ops.settlement.confirm')}
                        loading={record.isPending}
                        disabled={!ready || record.isPending}
                        onPress={submit}
                    />
                </>
            }
        >
            <Stack space="sm">
                <Stack space="xs" testID="kitchen-settlement-runs">
                    {runs.map((run) => (
                        <Checkbox
                            key={run.jobId}
                            testID={`kitchen-settlement-run-${run.jobId}`}
                            label={`${run.orderNumber}  ${money(run.amountMinor)}`}
                            checked={!excluded.has(run.jobId)}
                            onChange={(checked) => {
                                const next = new Set(excluded);
                                if (checked) next.delete(run.jobId);
                                else next.add(run.jobId);
                                setExcluded(next);
                            }}
                        />
                    ))}
                </Stack>
                {settling.kind !== 'courier' ? null : (
                    <Text variant="caption" tone="secondary" testID="kitchen-settlement-fee">
                        {t('kitchen:ops.settlement.feeNote', {
                            fee: money(fees),
                            net: money(net),
                        })}
                    </Text>
                )}
                <TextInputField
                    testID="kitchen-settlement-amount"
                    id="kitchen-settlement-amount"
                    label={t('kitchen:ops.settlement.amountLabel', { currency })}
                    hint={t('kitchen:ops.settlement.amountHint', { amount: money(net) })}
                    {...(amount.trim() !== '' && !amountValid
                        ? { error: t('kitchen:ops.settlement.amountInvalid') }
                        : {})}
                    value={amount}
                    onChangeText={setAmount}
                    inputMode="decimal"
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                {short <= 0 ? null : (
                    <>
                        <Callout
                            testID="kitchen-settlement-short"
                            tone="warning"
                            role="status"
                            title={t('kitchen:ops.settlement.shortTitle', { amount: money(short) })}
                            body={t('kitchen:ops.settlement.shortBody')}
                        />
                        <TextInputField
                            testID="kitchen-settlement-reason"
                            id="kitchen-settlement-reason"
                            label={t('kitchen:ops.settlement.reasonLabel')}
                            value={reason}
                            onChangeText={setReason}
                            multiline
                            maxLength={300}
                            required
                        />
                    </>
                )}
                {failure === null ? null : (
                    <Callout
                        testID="kitchen-settlement-error"
                        tone="danger"
                        title={t('kitchen:ops.settlement.saveError')}
                        body={failure.message}
                    />
                )}
            </Stack>
        </Dialog>
    );
}
