import type { ActivityEntry, StockActivityMovement } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Cascade,
    DatePickerButton,
    EmptyState,
    ErrorState,
    Stack,
    SegmentedControl,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useActivityQuery, useStockActivityQuery } from '../../../data/kitchen-ops-hooks.ts';
import { daysBetween, isIsoDate, todayIso } from '../../commerce/dates.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { LensBar } from '../catalogue/lens-bar.tsx';
import { PeriodScope } from '../catalogue/period-scope.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { useColumnControls } from '../catalogue/use-column-controls.tsx';
import { AUDIT_VIEW_PERMISSION } from '../entity-registry.ts';
import { humaniseCode, unitCodeLabel } from '../format.ts';

/**
 * `/kitchen/activity` — where an owner investigates a number. Built like the cash report: a window of
 * days over a table. Read-only, in two views: every stock movement with who made it and what it was
 * worth, and the audit trail.
 *
 * A stock movement with no actor stays that way, and reads as unattributed: the ledger is never
 * rewritten.
 */

const WHEN: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

/** The longest window the server answers, both ends counted. */
const MAX_WINDOW_DAYS = 31;

type ActivityView = 'stock' | 'audit';

/**
 * An order number that opens the order, as the customer page opens one
 * (`customer-detail-screen.tsx`).
 */
function OrderLink({
    orderId,
    orderNumber,
    testID,
}: {
    readonly orderId: string;
    readonly orderNumber: string;
    readonly testID: string;
}) {
    const router = useRouter();

    return (
        <Button
            testID={testID}
            size="sm"
            variant="quiet"
            label={orderNumber}
            onPress={() => {
                router.push(`/kitchen/orders?view=${encodeURIComponent(orderId)}` as never);
            }}
        />
    );
}

export function ActivityScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [AUDIT_VIEW_PERMISSION] }}
            testID="kitchen-activity"
        >
            <Activity />
        </Gate>
    );
}

function Activity() {
    const { t } = useTranslation();
    const [today] = useState(() => todayIso());
    const [from, setFrom] = useState(today);
    const [to, setTo] = useState(today);
    const [view, setView] = useState<ActivityView>('stock');

    const span = isIsoDate(from) && isIsoDate(to) ? daysBetween(from, to) : null;
    const tooLong = span !== null && span >= MAX_WINDOW_DAYS;
    const window = useMemo(
        () => (span !== null && span >= 0 && !tooLong ? { from, to } : null),
        [from, to, span, tooLong],
    );

    return (
        <Cascade space="md" testID="kitchen-activity-screen">
            <LensBar
                testID="kitchen-activity-toolbar"
                label={t('kitchen:lens.label')}
                figures={[]}
                scope={
                    <>
                        <SegmentedControl<ActivityView>
                            testID="kitchen-activity-views"
                            label={t('kitchen:lens.label')}
                            value={view}
                            onChange={setView}
                            items={(['stock', 'audit'] as const).map((candidate) => ({
                                value: candidate,
                                label: t(`kitchen:ops.activity.view.${candidate}`),
                                testID: `kitchen-activity-view-${candidate}`,
                            }))}
                        />
                        <View aria-hidden className="mx-1 h-5 w-px bg-brand-100" />
                        <PeriodScope
                            testID="kitchen-activity-period"
                            today={today}
                            value={{ from, to }}
                            onChange={(next) => {
                                setFrom(next.from);
                                setTo(next.to);
                            }}
                        />
                        <View className="z-auto flex-row items-center gap-tight">
                            <DatePickerButton
                                testID="kitchen-activity-from"
                                label={t('kitchen:ops.cashReport.fromLabel')}
                                value={from}
                                max={to}
                                onChange={setFrom}
                            />
                            <Text variant="caption" tone="secondary" aria-hidden>
                                {t('kitchen:ops.requirements.windowTo')}
                            </Text>
                            <DatePickerButton
                                testID="kitchen-activity-to"
                                label={t('kitchen:ops.cashReport.toLabel')}
                                value={to}
                                min={from}
                                onChange={setTo}
                            />
                        </View>
                    </>
                }
                result={null}
                clearLabel={t('kitchen:lens.clear')}
            />

            {window === null ? (
                <Callout
                    testID="kitchen-activity-window"
                    tone="info"
                    title={
                        tooLong
                            ? t('kitchen:ops.cashReport.windowTooLongTitle', {
                                  count: MAX_WINDOW_DAYS,
                              })
                            : t('kitchen:ops.cashReport.dateInvalidTitle')
                    }
                />
            ) : view === 'stock' ? (
                <StockMovements window={window} />
            ) : (
                <AuditTrail window={window} />
            )}
        </Cascade>
    );
}

function StockMovements({ window }: { readonly window: { from: string; to: string } }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const activity = useStockActivityQuery(window);
    const failure = toFailure(activity.error);
    const rows = activity.data?.movements ?? [];
    const waste = activity.data?.waste ?? [];

    const columns: readonly ControlledColumn<
        StockActivityMovement,
        CatalogueColumn<StockActivityMovement>
    >[] = [
        {
            key: 'when',
            label: t('kitchen:ops.activity.columnWhen'),
            width: 170,
            priority: 90,
            render: (row) => (
                <Text tone="secondary" className="tabular-nums">
                    {formatter.formatDate(row.at, WHEN)}
                </Text>
            ),
        },
        {
            key: 'item',
            role: 'title',
            value: (row) => row.itemName,
            label: t('kitchen:ops.activity.columnItem'),
            width: 200,
            priority: 100,
            render: (row) => <Text variant="strong">{row.itemName}</Text>,
        },
        {
            key: 'reason',
            role: 'meta',
            label: t('kitchen:ops.activity.columnReason'),
            width: 150,
            priority: 95,
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((row) => row.reason))].map((reason) => ({
                        key: reason,
                        label: t(`kitchen:ops.activity.reason.${reason}`),
                    })),
                match: (row, value) => row.reason === value,
            },
            render: (row) => (
                <Stack space="xs">
                    <Text tone="secondary">{t(`kitchen:ops.activity.reason.${row.reason}`)}</Text>
                    {row.wasteReason === null ? null : (
                        <Text
                            variant="caption"
                            tone="secondary"
                            testID={`kitchen-activity-waste-reason-${row.id}`}
                        >
                            {t(`kitchen:ops.stock.wasteReason.${row.wasteReason}`)}
                        </Text>
                    )}
                    {row.notes === null ? null : (
                        <Text variant="caption" tone="secondary">
                            {row.notes}
                        </Text>
                    )}
                    {!row.wastedOrder ? null : (
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.activity.wastedOrder', { number: row.orderNumber })}
                        </Text>
                    )}
                    {/*
                     * The order a movement served, here rather than in a column of its own: a
                     * seventh column falls outside the six the list shows, and most rows have none.
                     */}
                    {row.orderId === null || row.orderNumber === null ? null : (
                        <OrderLink
                            orderId={row.orderId}
                            orderNumber={row.orderNumber}
                            testID={`kitchen-activity-stock-order-${row.id}`}
                        />
                    )}
                </Stack>
            ),
        },
        {
            key: 'quantity',
            label: t('kitchen:ops.activity.columnQuantity'),
            width: 120,
            priority: 92,
            render: (row) => (
                <Text variant="mono">
                    {`${formatter.formatNumber(Number(row.quantityDelta))} ${unitCodeLabel(row.unit, t)}`}
                </Text>
            ),
        },
        {
            key: 'value',
            role: 'metric',
            label: t('kitchen:ops.activity.columnValue'),
            width: 120,
            priority: 91,
            render: (row) => (
                <Text variant="mono" tone={row.costMinor === null ? 'secondary' : 'primary'}>
                    {row.costMinor === null || row.currencyCode === null
                        ? t('kitchen:list.noValue')
                        : formatMoney(formatter, {
                              amount: Math.abs(row.costMinor),
                              currency: row.currencyCode,
                          })}
                </Text>
            ),
        },
        {
            key: 'actor',
            label: t('kitchen:ops.activity.columnActor'),
            width: 170,
            priority: 93,
            render: (row) => (
                <Text tone={row.attributed ? 'primary' : 'secondary'}>
                    {row.attributed
                        ? (row.actorName ?? t('kitchen:list.noValue'))
                        : t('kitchen:ops.activity.unattributed')}
                </Text>
            ),
        },
    ];
    const controls = useColumnControls(rows, columns, 'kitchen-activity-stock-table');

    if (activity.isPending) {
        return <TableSkeleton testID="kitchen-activity-stock-loading" rows={6} />;
    }
    if (failure !== null) {
        return (
            <ErrorState
                testID="kitchen-activity-stock-error"
                title={t('kitchen:ops.activity.loadErrorTitle')}
                failure={failure}
                onRetry={() => {
                    void activity.refetch();
                }}
                retrying={activity.isFetching}
            />
        );
    }
    if (rows.length === 0) {
        return (
            <EmptyState
                testID="kitchen-activity-stock-empty"
                title={t('kitchen:ops.activity.emptyTitle')}
            />
        );
    }

    return (
        <View className="flex-col gap-loose">
            {(activity.data?.truncated ?? false) ? (
                <Callout
                    testID="kitchen-activity-stock-truncated"
                    tone="info"
                    title={t('kitchen:ops.activity.truncated')}
                />
            ) : null}
            <Stack space="xs" testID="kitchen-activity-waste">
                <Text variant="section" accessibilityRole="header">
                    {t('kitchen:ops.activity.wasteHeading')}
                </Text>
                {waste.length === 0 ? (
                    <Text tone="secondary">{t('kitchen:ops.activity.wasteNone')}</Text>
                ) : (
                    waste.map((total) => (
                        <Text
                            key={total.currencyCode}
                            variant="strong"
                            className="tabular-nums"
                            testID={`kitchen-activity-waste-${total.currencyCode}`}
                        >
                            {formatMoney(formatter, {
                                amount: total.amountMinor,
                                currency: total.currencyCode,
                            })}
                        </Text>
                    ))
                )}
                {(activity.data?.unvaluedWasteCount ?? 0) === 0 ? null : (
                    <Text variant="caption" tone="secondary" testID="kitchen-activity-unvalued">
                        {t('kitchen:ops.activity.unvalued', {
                            count: activity.data?.unvaluedWasteCount ?? 0,
                        })}
                    </Text>
                )}
            </Stack>
            <CatalogueList<StockActivityMovement>
                testID="kitchen-activity-stock-table"
                label={t('kitchen:ops.activity.view.stock')}
                columns={controls.columns}
                rows={controls.rows}
                rowKey={(row) => row.id}
                rowActionsLabel={t('kitchen:list.rowActions')}
            />
        </View>
    );
}

function AuditTrail({ window }: { readonly window: { from: string; to: string } }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const activity = useActivityQuery(window);
    const failure = toFailure(activity.error);
    const rows = activity.data?.entries ?? [];

    const columns: readonly ControlledColumn<ActivityEntry, CatalogueColumn<ActivityEntry>>[] = [
        {
            key: 'when',
            label: t('kitchen:ops.activity.columnWhen'),
            width: 170,
            priority: 90,
            render: (row) => (
                <Text tone="secondary" className="tabular-nums">
                    {formatter.formatDate(row.at, WHEN)}
                </Text>
            ),
        },
        {
            key: 'action',
            role: 'title',
            value: (row) => humaniseCode(row.action),
            label: t('kitchen:ops.activity.columnAction'),
            width: 240,
            priority: 100,
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((row) => row.action))].map((action) => ({
                        key: action,
                        label: humaniseCode(action),
                    })),
                match: (row, value) => row.action === value,
            },
            render: (row) => <Text variant="strong">{humaniseCode(row.action)}</Text>,
        },
        {
            key: 'order',
            label: t('kitchen:ops.activity.columnOrder'),
            width: 120,
            priority: 92,
            render: (row) =>
                row.orderId === null || row.orderNumber === null ? (
                    <Text variant="mono" tone="secondary">
                        {row.orderNumber ?? t('kitchen:list.noValue')}
                    </Text>
                ) : (
                    <OrderLink
                        orderId={row.orderId}
                        orderNumber={row.orderNumber}
                        testID={`kitchen-activity-audit-order-${row.id}`}
                    />
                ),
        },
        {
            key: 'actor',
            label: t('kitchen:ops.activity.columnActor'),
            width: 170,
            priority: 93,
            render: (row) => <Text>{row.actorName ?? t('kitchen:list.noValue')}</Text>,
        },
        {
            key: 'details',
            label: t('kitchen:ops.activity.columnDetails'),
            width: 320,
            priority: 80,
            render: (row) => (
                <Text variant="caption" tone="secondary">
                    {Object.entries(row.metadata)
                        .filter(([, value]) => typeof value !== 'object')
                        .map(([key, value]) => `${humaniseCode(key)}: ${String(value)}`)
                        .join(t('kitchen:common.listSeparator'))}
                </Text>
            ),
        },
    ];
    const controls = useColumnControls(rows, columns, 'kitchen-activity-audit-table');

    if (activity.isPending) {
        return <TableSkeleton testID="kitchen-activity-audit-loading" rows={6} />;
    }
    if (failure !== null) {
        return (
            <ErrorState
                testID="kitchen-activity-audit-error"
                title={t('kitchen:ops.activity.loadErrorTitle')}
                failure={failure}
                onRetry={() => {
                    void activity.refetch();
                }}
                retrying={activity.isFetching}
            />
        );
    }
    if (rows.length === 0) {
        return (
            <EmptyState
                testID="kitchen-activity-audit-empty"
                title={t('kitchen:ops.activity.emptyTitle')}
            />
        );
    }

    return (
        <View className="flex-col gap-loose">
            {(activity.data?.truncated ?? false) ? (
                <Callout
                    testID="kitchen-activity-audit-truncated"
                    tone="info"
                    title={t('kitchen:ops.activity.truncated')}
                />
            ) : null}
            <CatalogueList<ActivityEntry>
                testID="kitchen-activity-audit-table"
                label={t('kitchen:ops.activity.view.audit')}
                columns={controls.columns}
                rows={controls.rows}
                rowKey={(row) => row.id}
                rowActionsLabel={t('kitchen:list.rowActions')}
            />
        </View>
    );
}
