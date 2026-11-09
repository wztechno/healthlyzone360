import { minorAmountToInput, parseMinorAmount } from '@healthy360/domain-types';
import type {
    DailyCloseRecord,
    DailyCloseTotal,
    OpenDailyClose,
    TillBranch,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Cascade,
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
    useDailyClosesQuery,
    useRecordDailyCloseMutation,
    useSignOffDailyCloseMutation,
} from '../../../data/order-desk-hooks.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { LensScope } from '../catalogue/lens-bar.tsx';
import { DeskTableTitle } from '../order-desk/desk-parts.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { ORDER_SETTLE_CASH_PERMISSION, ORDER_SUPERVISE_PERMISSION } from '../entity-registry.ts';

/**
 * `/kitchen/order-desk/cash?tab=close` — counting the till at the end of a shift.
 *
 * Copied from the settlement page: two lists in the cash report's table, the open shifts and the
 * recent closes, and a dialog behind Close. A shift is everything since the last close, one per
 * currency, and its days are the kitchen's. The figures on the page are the same receipts and
 * hand-ins the cash report and the settlement read.
 *
 * A short close needs a reason and waits for a manager's sign-off. The app takes no pay decision.
 *
 * One till per branch (owner, 3 Nov). With more than one branch the page gains the branch picker the
 * team member editor uses — a `Select` whose first option is the whole kitchen — a branch line under
 * each row's shift, and the kitchen total in the same table. With one branch it is the page it was.
 */

const EM_DASH = '—';

/** The picker's whole-kitchen option. Not a branch identifier, so it can never collide with one. */
const ALL_BRANCHES = '__all__';

export function OrderDeskCloseScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_SETTLE_CASH_PERMISSION] }}
            testID="kitchen-order-desk-close"
        >
            <OrderDeskClose />
        </Gate>
    );
}

function OrderDeskClose() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const canSignOff = useCan(ORDER_SUPERVISE_PERMISSION);
    const report = useDailyClosesQuery();
    const signOff = useSignOffDailyCloseMutation();
    const [closing, setClosing] = useState<OpenDailyClose | null>(null);
    const [branch, setBranch] = useState(ALL_BRANCHES);

    const failure = toFailure(report.error);
    const multiBranch = (report.data?.branches.length ?? 0) > 1;
    const inBranch = (row: TillBranch) => branch === ALL_BRANCHES || row.branchId === branch;
    const branchLine = (row: TillBranch) =>
        !multiBranch || row.branchName === null ? null : (
            <Text variant="caption" tone="secondary">
                {row.branchName}
            </Text>
        );

    const openColumns: readonly CatalogueColumn<OpenDailyClose>[] = [
        {
            key: 'shift',
            role: 'title',
            value: (row) => row.businessDate,
            label: t('kitchen:ops.dailyClose.columnShift'),
            width: 200,
            priority: 100,
            render: (row) => (
                <Stack space="xs">
                    <Text variant="strong">{row.businessDate}</Text>
                    <Text variant="caption" tone="secondary">
                        {row.currencyCode}
                    </Text>
                    {branchLine(row)}
                </Stack>
            ),
        },
        {
            key: 'counter',
            label: t('kitchen:ops.dailyClose.columnCounter'),
            width: 140,
            priority: 95,
            render: (row) => (
                <Text variant="mono">
                    {formatMoney(formatter, {
                        amount: row.counterCashMinor,
                        currency: row.currencyCode,
                    })}
                </Text>
            ),
        },
        {
            key: 'handedIn',
            label: t('kitchen:ops.dailyClose.columnHandedIn'),
            width: 140,
            priority: 90,
            render: (row) => (
                <Text variant="mono">
                    {formatMoney(formatter, {
                        amount: row.handedInMinor,
                        currency: row.currencyCode,
                    })}
                </Text>
            ),
        },
        {
            key: 'refunds',
            label: t('kitchen:ops.dailyClose.columnRefunds'),
            width: 140,
            priority: 85,
            render: (row) => (
                <Text variant="mono" tone="secondary">
                    {formatMoney(formatter, {
                        amount: row.cashRefundsMinor,
                        currency: row.currencyCode,
                    })}
                </Text>
            ),
        },
        {
            key: 'close',
            align: 'end',
            label: '',
            width: 120,
            priority: 99,
            render: (row) => (
                <View className="flex-row justify-end">
                    <Button
                        testID={`kitchen-close-${row.branchId ?? 'kitchen'}-${row.currencyCode}-open`}
                        variant="secondary"
                        size="sm"
                        label={t('kitchen:ops.dailyClose.close')}
                        onPress={() => {
                            setClosing(row);
                        }}
                    />
                </View>
            ),
        },
    ];

    const recentColumns: readonly CatalogueColumn<DailyCloseRecord>[] = [
        {
            key: 'shift',
            role: 'title',
            value: (row) => row.businessDate,
            label: t('kitchen:ops.dailyClose.columnShift'),
            width: 170,
            priority: 100,
            render: (row) => (
                <Stack space="xs">
                    <Text variant="strong">{row.businessDate}</Text>
                    <Text variant="caption" tone="secondary">
                        {row.recordedByName ?? EM_DASH}
                    </Text>
                    {branchLine(row)}
                </Stack>
            ),
        },
        {
            key: 'closed',
            label: t('kitchen:ops.dailyClose.columnClosed'),
            width: 170,
            priority: 60,
            render: (row) => (
                <Text tone="secondary" className="tabular-nums">
                    {formatter.formatDate(row.closedAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                    })}
                </Text>
            ),
        },
        {
            key: 'float',
            label: t('kitchen:ops.dailyClose.columnFloat'),
            width: 120,
            priority: 70,
            render: (row) => (
                <Text variant="mono" tone="secondary">
                    {formatMoney(formatter, {
                        amount: row.openingFloatMinor,
                        currency: row.currencyCode,
                    })}
                </Text>
            ),
        },
        {
            key: 'expected',
            label: t('kitchen:ops.dailyClose.columnExpected'),
            width: 120,
            priority: 90,
            render: (row) => (
                <Text variant="mono">
                    {formatMoney(formatter, {
                        amount: row.expectedMinor,
                        currency: row.currencyCode,
                    })}
                </Text>
            ),
        },
        {
            key: 'counted',
            role: 'metric',
            label: t('kitchen:ops.dailyClose.columnCounted'),
            width: 120,
            priority: 95,
            render: (row) => (
                <Text variant="mono">
                    {formatMoney(formatter, {
                        amount: row.countedMinor,
                        currency: row.currencyCode,
                    })}
                </Text>
            ),
        },
        {
            key: 'variance',
            label: t('kitchen:ops.dailyClose.columnVariance'),
            width: 220,
            priority: 92,
            render: (row) =>
                row.varianceMinor === 0 ? (
                    <Text tone="secondary">{EM_DASH}</Text>
                ) : (
                    <Stack space="xs">
                        <Text variant="mono">
                            {formatMoney(formatter, {
                                amount: row.varianceMinor,
                                currency: row.currencyCode,
                            })}
                        </Text>
                        {row.varianceReason === null ? null : (
                            <Text variant="caption" tone="secondary">
                                {row.varianceReason}
                            </Text>
                        )}
                    </Stack>
                ),
        },
        {
            key: 'status',
            label: t('kitchen:ops.dailyClose.columnStatus'),
            width: 180,
            priority: 93,
            render: (row) =>
                row.varianceMinor === 0 ? (
                    <Badge tone="success" label={t('kitchen:ops.dailyClose.balanced')} />
                ) : row.varianceMinor > 0 ? (
                    <Badge tone="neutral" label={t('kitchen:ops.dailyClose.over')} />
                ) : row.signedOffAt !== null ? (
                    <Badge tone="neutral" label={t('kitchen:ops.dailyClose.signedOff')} />
                ) : canSignOff ? (
                    <Button
                        testID={`kitchen-close-${row.id}-sign-off`}
                        variant="secondary"
                        size="sm"
                        label={t('kitchen:ops.dailyClose.signOff')}
                        disabled={signOff.isPending}
                        onPress={() => {
                            signOff.mutate(row.id, {
                                onSuccess: () => {
                                    toast.show({
                                        testID: 'kitchen-close-toast',
                                        tone: 'success',
                                        message: t('kitchen:ops.dailyClose.signedOffToast'),
                                    });
                                },
                            });
                        }}
                    />
                ) : (
                    <Badge
                        tone="warning"
                        icon="warning"
                        label={t('kitchen:ops.dailyClose.awaitingSignOff')}
                    />
                ),
        },
    ];

    /** The kitchen total: every till together, a day to a row, in the recent list's figure style. */
    const totalFigures = [
        ['counter', 'columnCounter', (row: DailyCloseTotal) => row.counterCashMinor, 85],
        ['handedIn', 'columnHandedIn', (row: DailyCloseTotal) => row.handedInMinor, 80],
        ['refunds', 'columnRefunds', (row: DailyCloseTotal) => row.cashRefundsMinor, 75],
        ['counted', 'columnCounted', (row: DailyCloseTotal) => row.countedMinor, 95],
        ['variance', 'columnVariance', (row: DailyCloseTotal) => row.varianceMinor, 92],
    ] as const;
    const totalColumns: readonly CatalogueColumn<DailyCloseTotal>[] = [
        {
            key: 'day',
            role: 'title',
            value: (row) => row.businessDate,
            label: t('kitchen:ops.dailyClose.columnDay'),
            width: 170,
            priority: 100,
            render: (row) => (
                <Stack space="xs">
                    <Text variant="strong">{row.businessDate}</Text>
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:ops.dailyClose.tillCount', {
                            tills: formatter.formatNumber(row.tillCount),
                        })}
                    </Text>
                </Stack>
            ),
        },
        ...totalFigures.map(([key, label, amount, priority]): CatalogueColumn<DailyCloseTotal> => ({
            key,
            ...(key === 'counted' ? { role: 'metric' as const } : {}),
            label: t(`kitchen:ops.dailyClose.${label}`),
            width: 130,
            priority,
            render: (row) => (
                <Text variant="mono">
                    {formatMoney(formatter, { amount: amount(row), currency: row.currencyCode })}
                </Text>
            ),
        })),
    ];

    const data = report.data;
    const open = data?.open.filter(inBranch) ?? [];
    const closes = data?.closes.filter(inBranch) ?? [];

    return (
        <Cascade space="md" testID="kitchen-order-desk-close-screen">
            {report.isPending ? (
                <TableSkeleton testID="kitchen-order-desk-close-loading" rows={6} />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-order-desk-close-error"
                    title={t('kitchen:ops.dailyClose.loadErrorTitle')}
                    failure={failure}
                    onRetry={() => {
                        void report.refetch();
                    }}
                    retrying={report.isFetching}
                />
            ) : data === undefined ? null : (
                <View className="flex-col gap-loose">
                    {!multiBranch ? null : (
                        <View className="z-10 flex-row">
                            <LensScope<string>
                                testID="kitchen-close-branch"
                                label={t('kitchen:ops.dailyClose.branchLabel')}
                                value={branch}
                                onChange={setBranch}
                                options={[
                                    {
                                        value: ALL_BRANCHES,
                                        label: t('kitchen:ops.dailyClose.allBranches'),
                                        testID: 'kitchen-close-branch-option-all',
                                    },
                                    ...data.branches.map((option) => ({
                                        value: String(option.id),
                                        label: option.name,
                                        testID: `kitchen-close-branch-option-${String(option.id)}`,
                                    })),
                                ]}
                            />
                        </View>
                    )}
                    <DeskTableTitle
                        title={t('kitchen:ops.dailyClose.openHeading')}
                        count={open.length}
                        aside={
                            <Text variant="caption" tone="secondary" testID="kitchen-close-clock">
                                {t('kitchen:ops.dailyClose.clockNote', { timezone: data.timezone })}
                            </Text>
                        }
                    />
                    <CatalogueList<OpenDailyClose>
                        testID="kitchen-close-open"
                        label={t('kitchen:ops.dailyClose.openHeading')}
                        columns={openColumns}
                        rows={open}
                        rowKey={(row) => `${row.branchId ?? 'kitchen'}-${row.currencyCode}`}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        frameEmpty
                        emptyState={
                            <EmptyState
                                testID="kitchen-close-open-empty"
                                shape="row"
                                icon="coins"
                                title={t('kitchen:ops.dailyClose.openEmpty')}
                            />
                        }
                    />

                    <DeskTableTitle title={t('kitchen:ops.dailyClose.recentHeading')} />
                    <CatalogueList<DailyCloseRecord>
                        testID="kitchen-close-recent"
                        label={t('kitchen:ops.dailyClose.recentHeading')}
                        columns={recentColumns}
                        rows={closes}
                        rowKey={(row) => row.id}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        frameEmpty
                        emptyState={
                            <EmptyState
                                testID="kitchen-close-recent-empty"
                                shape="row"
                                icon="clipboardCheck"
                                title={t('kitchen:ops.dailyClose.recentEmpty')}
                            />
                        }
                    />

                    {!multiBranch ? null : (
                        <>
                            <DeskTableTitle
                                title={t('kitchen:ops.dailyClose.totalHeading')}
                                aside={
                                    <Text variant="caption" tone="secondary">
                                        {t('kitchen:ops.dailyClose.totalNote')}
                                    </Text>
                                }
                            />
                            <CatalogueList<DailyCloseTotal>
                                testID="kitchen-close-total"
                                label={t('kitchen:ops.dailyClose.totalHeading')}
                                columns={totalColumns}
                                rows={data.totals}
                                rowKey={(row) => `${row.businessDate}-${row.currencyCode}`}
                                rowActionsLabel={t('kitchen:list.rowActions')}
                                frameEmpty
                                emptyState={
                                    <EmptyState
                                        testID="kitchen-close-total-empty"
                                        shape="row"
                                        icon="banknote"
                                        title={t('kitchen:ops.dailyClose.recentEmpty')}
                                    />
                                }
                            />
                        </>
                    )}
                </View>
            )}

            {closing === null ? null : (
                <CloseDialog
                    closing={closing}
                    onClose={() => {
                        setClosing(null);
                    }}
                />
            )}
        </Cascade>
    );
}

/** The float, the count, and why if it is short. Open only while closing. */
function CloseDialog({
    closing,
    onClose,
}: {
    readonly closing: OpenDailyClose;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const record = useRecordDailyCloseMutation();

    const currency = closing.currencyCode;
    const money = (value: number) => formatMoney(formatter, { amount: value, currency });

    const [float, setFloat] = useState(() =>
        minorAmountToInput(closing.suggestedFloatMinor, currency),
    );
    const [counted, setCounted] = useState('');
    const [reason, setReason] = useState('');

    const floatMinor = parseMinorAmount(float, currency);
    const countedMinor = parseMinorAmount(counted, currency);
    const expected =
        (floatMinor ?? 0) +
        closing.counterCashMinor +
        closing.handedInMinor -
        closing.cashRefundsMinor;
    const variance = countedMinor === null ? 0 : countedMinor - expected;
    const short = variance < 0;
    const ready = floatMinor !== null && countedMinor !== null && (!short || reason.trim() !== '');
    const failure = toFailure(record.error);

    function submit() {
        if (floatMinor === null || countedMinor === null || !ready) return;
        record.mutate(
            {
                branchId: closing.branchId,
                currencyCode: currency,
                openingFloatMinor: floatMinor,
                countedMinor,
                ...(variance === 0 || reason.trim() === ''
                    ? {}
                    : { varianceReason: reason.trim() }),
            },
            {
                onSuccess: () => {
                    onClose();
                    toast.show({
                        testID: 'kitchen-close-toast',
                        tone: 'success',
                        message: t('kitchen:ops.dailyClose.savedToast'),
                    });
                },
            },
        );
    }

    return (
        <Dialog
            testID="kitchen-close-dialog"
            open
            onClose={onClose}
            title={t('kitchen:ops.dailyClose.dialogTitle', {
                date: closing.businessDate,
                currency:
                    closing.branchName === null ? currency : `${currency} · ${closing.branchName}`,
            })}
            description={t('kitchen:ops.dailyClose.dialogBody')}
            actions={
                <>
                    <Button
                        testID="kitchen-close-dismiss"
                        variant="quiet"
                        label={t('kitchen:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="kitchen-close-confirm"
                        label={t('kitchen:ops.dailyClose.confirm')}
                        loading={record.isPending}
                        disabled={!ready || record.isPending}
                        onPress={submit}
                    />
                </>
            }
        >
            <Stack space="sm">
                <TextInputField
                    testID="kitchen-close-float"
                    id="kitchen-close-float"
                    label={t('kitchen:ops.dailyClose.floatLabel', { currency })}
                    {...(float.trim() !== '' && floatMinor === null
                        ? { error: t('kitchen:ops.dailyClose.amountInvalid') }
                        : {})}
                    value={float}
                    onChangeText={setFloat}
                    inputMode="decimal"
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                <Text variant="caption" tone="secondary" testID="kitchen-close-expected">
                    {t('kitchen:ops.dailyClose.expectedNote', { amount: money(expected) })}
                </Text>
                <TextInputField
                    testID="kitchen-close-counted"
                    id="kitchen-close-counted"
                    label={t('kitchen:ops.dailyClose.countedLabel', { currency })}
                    {...(counted.trim() !== '' && countedMinor === null
                        ? { error: t('kitchen:ops.dailyClose.amountInvalid') }
                        : {})}
                    value={counted}
                    onChangeText={setCounted}
                    inputMode="decimal"
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                {!short ? null : (
                    <Callout
                        testID="kitchen-close-short"
                        tone="warning"
                        role="status"
                        title={t('kitchen:ops.dailyClose.shortTitle', {
                            amount: money(-variance),
                        })}
                        body={t('kitchen:ops.dailyClose.shortBody')}
                    />
                )}
                {variance === 0 ? null : (
                    <TextInputField
                        testID="kitchen-close-reason"
                        id="kitchen-close-reason"
                        label={t(
                            short
                                ? 'kitchen:ops.dailyClose.reasonLabel'
                                : 'kitchen:ops.dailyClose.overReasonLabel',
                        )}
                        value={reason}
                        onChangeText={setReason}
                        multiline
                        maxLength={300}
                        required={short}
                    />
                )}
                {failure === null ? null : (
                    <Callout
                        testID="kitchen-close-error"
                        tone="danger"
                        title={t('kitchen:ops.dailyClose.saveError')}
                        body={failure.message}
                    />
                )}
            </Stack>
        </Dialog>
    );
}
