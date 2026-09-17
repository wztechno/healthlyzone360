import type { ConsumptionException } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    DatePickerButton,
    Dialog,
    EmptyState,
    ErrorState,
    SegmentedControl,
    Skeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { can } from '@healthy360/permissions';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useConsumptionExceptionsQuery,
    useResolveConsumptionExceptionMutation,
    useRetryConsumptionExceptionMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { ExceptionRowActions } from '../consumption-exceptions/exception-row-actions.tsx';
import { INVENTORY_MANAGE_PERMISSION, INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';

/**
 * `/kitchen/consumption-exceptions` — what a confirmed order could not deduct honestly (INV1.5), as
 * `Workbench.dc.html` draws it (§3.5).
 *
 * ```
 * Consumption exceptions  [ RETRY WRITES STOCK ]
 * ┌ SHOWN ┐ ┌ UNRESOLVED ┐ ┌ RESOLVED ┐
 * STATUS [ Unresolved | Resolved | All ]   RAISED FROM [ 2026-08-01 ▦ ]
 * ORDER              BRANCH         REASON                   RAISED       STATUS
 * 0148               Beirut Central Not enough stock         2026-08-28   [OPEN] Retry Resolve
 * Grilled chicken …
 * ```
 *
 * Behind `inventory.view_organisation`; Retry and Resolve only for `inventory.manage_organisation`.
 * Nothing confidential shows — an order number, the sold item, the branch, the reason. Never a cost.
 *
 * ## The order cell carries the item underneath
 *
 * Because `unknownOrder` ("Order gone") and `unknownItem` ("Item gone") are different facts and a
 * row can have either. Reasons render the full `exceptions.reasons.*` string — no abbreviation.
 *
 * ## Resolve is confirmed
 *
 * Resolving accepts a permanent stock gap, so it goes through a dialog that says so (the handoff's
 * open question §6.3, answered). Retry is not confirmed: it re-runs the same guarded deduction a
 * confirm uses and cannot deduct twice.
 *
 * ## The cards count the page in hand
 *
 * The list is cursor-paged and the server returns no total, so Shown counts this page and says so
 * in its caption. Unresolved takes the danger ink only while it is non-zero.
 */
export function ConsumptionExceptionsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-consumption-exceptions"
        >
            <ConsumptionExceptions />
        </Gate>
    );
}

type StatusFilter = 'unresolved' | 'resolved' | 'all';

function ConsumptionExceptions() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const state = useAccessState();
    const canManage = can(state, INVENTORY_MANAGE_PERMISSION);

    const [status, setStatus] = useState<StatusFilter>('unresolved');
    const [from, setFrom] = useState('');
    const [cursor, setCursor] = useState<string | undefined>(undefined);
    const [viewing, setViewing] = useState<ConsumptionException | null>(null);
    const [resolving, setResolving] = useState<ConsumptionException | null>(null);

    const fromIsValid = from === '' || /^\d{4}-\d{2}-\d{2}$/.test(from);
    const filter = useMemo(
        () => ({
            ...(status === 'all' ? {} : { resolved: status === 'resolved' }),
            ...(from === '' || !fromIsValid ? {} : { from }),
            ...(cursor === undefined ? {} : { cursor }),
        }),
        [status, from, fromIsValid, cursor],
    );
    const exceptions = useConsumptionExceptionsQuery(filter);

    const resolve = useResolveConsumptionExceptionMutation();
    const retry = useRetryConsumptionExceptionMutation();
    const [pendingId, setPendingId] = useState<string | null>(null);

    const rows = exceptions.data?.items ?? [];
    const nextCursor = exceptions.data?.nextCursor ?? null;
    const hasMore = (exceptions.data?.hasMore ?? false) && nextCursor !== null;
    const unresolved = rows.filter((row) => !row.resolved).length;

    /** A filter change is a navigation: the page, and any record held in the window, go with it. */
    const refilter = () => {
        setCursor(undefined);
        setViewing(null);
    };

    const runRetry = (row: ConsumptionException) => {
        setPendingId(row.id);
        retry.mutate(row.id, {
            onSettled: () => {
                setPendingId(null);
            },
        });
    };

    const confirmResolve = () => {
        if (resolving === null) return;
        const row = resolving;
        setPendingId(row.id);
        resolve.mutate(
            { exceptionId: row.id },
            {
                onSuccess: () => {
                    setResolving(null);
                    setViewing(null);
                    toast.show({
                        testID: 'kitchen-exception-resolved-toast',
                        tone: 'success',
                        message: t('kitchen:ops.exceptions.resolvedToast', {
                            order: row.orderNumber ?? t('kitchen:ops.exceptions.unknownOrder'),
                        }),
                    });
                },
                onSettled: () => {
                    setPendingId(null);
                },
            },
        );
    };

    const orderLabel = (row: ConsumptionException) =>
        row.orderNumber ?? t('kitchen:ops.exceptions.unknownOrder');
    const itemLabel = (row: ConsumptionException) =>
        row.itemNameEn ?? t('kitchen:ops.exceptions.unknownItem');
    const raisedLabel = (row: ConsumptionException) =>
        row.createdAt === null
            ? t('kitchen:list.noValue')
            : formatter.formatDate(row.createdAt, { dateStyle: 'medium' });

    const columns: readonly ControlledColumn<
        ConsumptionException,
        CatalogueColumn<ConsumptionException>
    >[] = [
        {
            key: 'order',
            role: 'title',
            value: (row) => orderLabel(row),
            label: t('kitchen:ops.exceptions.columnOrder'),
            width: 180,
            priority: 100,
            sort: (left, right, direction) =>
                compareText(orderLabel(left), orderLabel(right), direction),
            render: (row) => (
                <View className="min-w-0 flex-col py-1">
                    <Text
                        variant="mono"
                        className="font-medium"
                        testID={`kitchen-exception-${row.id}-order`}
                    >
                        {orderLabel(row)}
                    </Text>
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                        {itemLabel(row)}
                    </Text>
                </View>
            ),
        },
        {
            key: 'branch',
            label: t('kitchen:ops.exceptions.columnBranch'),
            width: 130,
            priority: 60,
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((row) => row.branchName ?? ''))]
                        .filter((name) => name !== '')
                        .map((name) => ({ key: name, label: name })),
                match: (row, value) => row.branchName === value,
            },
            render: (row) => (
                <Text tone="secondary" numberOfLines={1}>
                    {row.branchName ?? t('kitchen:list.noValue')}
                </Text>
            ),
        },
        {
            key: 'reason',
            role: 'meta',
            label: t('kitchen:ops.exceptions.columnReason'),
            width: 220,
            priority: 90,
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((row) => row.reasonCode))].map((code) => ({
                        key: code,
                        label: t(`kitchen:ops.exceptions.reasons.${code}`),
                    })),
                match: (row, value) => row.reasonCode === value,
            },
            render: (row) => (
                <Text testID={`kitchen-exception-${row.id}-reason`}>
                    {t(`kitchen:ops.exceptions.reasons.${row.reasonCode}`)}
                </Text>
            ),
        },
        {
            key: 'raised',
            label: t('kitchen:ops.exceptions.columnRaised'),
            width: 120,
            priority: 40,
            sort: (left, right, direction) =>
                compareText(left.createdAt ?? '', right.createdAt ?? '', direction),
            render: (row) => (
                <Text variant="mono" tone="secondary">
                    {raisedLabel(row)}
                </Text>
            ),
        },
        {
            key: 'status',
            role: 'status',
            label: t('kitchen:ops.exceptions.columnStatus'),
            width: 190,
            priority: 95,
            /*
             * The toolbar's status cut, offered again where the column is: the same state, so the
             * two never disagree, and sent with the request as `resolved` — the list is cursor-paged,
             * and narrowing the page in hand would misreport every page after it.
             */
            filter: {
                values: () =>
                    (
                        [
                            ['unresolved', 'kitchen:ops.exceptions.filterUnresolved'],
                            ['resolved', 'kitchen:ops.exceptions.filterResolved'],
                        ] as const
                    ).map(([key, labelKey]) => ({ key, label: t(labelKey) })),
                external: {
                    value: status === 'all' ? null : status,
                    onChange: (next) => {
                        setStatus(next === 'resolved' || next === 'unresolved' ? next : 'all');
                        refilter();
                    },
                },
            },
            render: (row) => (
                <View className="flex-row flex-wrap items-center gap-1.5">
                    {row.resolved ? (
                        <Badge
                            testID={`kitchen-exception-${row.id}-resolved`}
                            tone="success"
                            label={t('kitchen:ops.exceptions.resolvedBadge')}
                        />
                    ) : (
                        <Badge
                            testID={`kitchen-exception-${row.id}-open`}
                            tone="danger"
                            label={t('kitchen:ops.exceptions.openBadge')}
                        />
                    )}
                    {canManage ? (
                        <ExceptionRowActions
                            row={row}
                            pendingId={pendingId}
                            onRetry={runRetry}
                            onResolve={setResolving}
                        />
                    ) : null}
                </View>
            ),
        },
    ];

    const controls = useColumnControls(rows, columns, 'kitchen-consumption-exceptions-table');
    const failure = toFailure(exceptions.error);
    const hasData = !exceptions.isPending && failure === null;

    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-consumption-exceptions-window"
                onBack={() => {
                    setViewing(null);
                }}
                title={t('kitchen:ops.exceptions.window.title', { order: orderLabel(viewing) })}
                kind={t('kitchen:ops.exceptions.window.kind')}
                status={
                    viewing.resolved
                        ? { label: t('kitchen:ops.exceptions.resolvedBadge'), tone: 'success' }
                        : { label: t('kitchen:ops.exceptions.openBadge'), tone: 'danger' }
                }
                {...(viewing.resolved ? {} : { note: t('kitchen:ops.exceptions.window.openNote') })}
                fields={[
                    {
                        key: 'item',
                        label: t('kitchen:ops.exceptions.window.fieldItem'),
                        value: itemLabel(viewing),
                    },
                    {
                        key: 'branch',
                        label: t('kitchen:ops.exceptions.columnBranch'),
                        value: viewing.branchName ?? t('kitchen:list.noValue'),
                    },
                    {
                        key: 'reason',
                        label: t('kitchen:ops.exceptions.columnReason'),
                        value: t(`kitchen:ops.exceptions.reasons.${viewing.reasonCode}`),
                    },
                    {
                        key: 'raised',
                        label: t('kitchen:ops.exceptions.columnRaised'),
                        value: raisedLabel(viewing),
                        mono: true,
                    },
                    ...(viewing.detail === null
                        ? []
                        : [
                              {
                                  key: 'detail',
                                  label: t('kitchen:ops.exceptions.window.fieldDetail'),
                                  value: viewing.detail,
                              },
                          ]),
                    ...(viewing.resolutionNote === null
                        ? []
                        : [
                              {
                                  key: 'resolutionNote',
                                  label: t('kitchen:ops.exceptions.window.fieldResolutionNote'),
                                  value: viewing.resolutionNote,
                              },
                          ]),
                    {
                        key: 'money',
                        label: t('kitchen:ops.exceptions.window.fieldMoney'),
                        value: t('kitchen:ops.exceptions.window.moneyValue'),
                    },
                ]}
                primaryAction={
                    viewing.resolved || !canManage
                        ? undefined
                        : {
                              label: t('kitchen:ops.exceptions.window.retry'),
                              icon: 'refresh',
                              onPress: () => {
                                  const row = viewing;
                                  setViewing(null);
                                  runRetry(row);
                              },
                          }
                }
            />
        );
    }

    return (
        <Stack space="md" testID="kitchen-consumption-exceptions-screen">
            {!hasData ? null : (
                <CatalogueStatCards
                    testID="kitchen-consumption-exceptions-summary"
                    cards={[
                        {
                            key: 'shown',
                            label: t('kitchen:review.statShown'),
                            value: formatter.formatNumber(rows.length),
                            unit: t('kitchen:ops.exceptions.statUnit'),
                            caption: t('kitchen:ops.exceptions.statShownCaption'),
                            mark: 'calendar',
                            tone: 'brand',
                            onPress: () => {
                                setStatus('all');
                                refilter();
                            },
                            accessibilityLabel: t('kitchen:ops.exceptions.filterAll'),
                        },
                        {
                            key: 'unresolved',
                            label: t('kitchen:ops.exceptions.filterUnresolved'),
                            value: formatter.formatNumber(unresolved),
                            unit: t('kitchen:ops.exceptions.statUnit'),
                            caption: t('kitchen:ops.exceptions.statUnresolvedCaption'),
                            mark: 'warning',
                            tone: unresolved === 0 ? 'default' : 'danger',
                            onPress: () => {
                                setStatus('unresolved');
                                refilter();
                            },
                            accessibilityLabel: t('kitchen:ops.exceptions.filterUnresolved'),
                        },
                        {
                            key: 'resolved',
                            label: t('kitchen:ops.exceptions.filterResolved'),
                            value: formatter.formatNumber(rows.length - unresolved),
                            unit: t('kitchen:ops.exceptions.statUnit'),
                            caption: t('kitchen:ops.exceptions.statResolvedCaption'),
                            mark: 'check',
                            tone: 'default',
                            onPress: () => {
                                setStatus('resolved');
                                refilter();
                            },
                            accessibilityLabel: t('kitchen:ops.exceptions.filterResolved'),
                        },
                    ]}
                />
            )}
            <View
                testID="kitchen-consumption-exceptions-toolbar"
                className="z-10 min-h-control-sm flex-row flex-wrap items-center gap-snug"
            >
                <SegmentedControl<StatusFilter>
                    testID="kitchen-exceptions-filter-status"
                    label={t('kitchen:ops.exceptions.filterStatus')}
                    value={status}
                    onChange={(next) => {
                        setStatus(next);
                        refilter();
                    }}
                    items={(
                        [
                            ['all', 'kitchen:ops.exceptions.filterAll'],
                            ['unresolved', 'kitchen:ops.exceptions.filterUnresolved'],
                            ['resolved', 'kitchen:ops.exceptions.filterResolved'],
                        ] as const
                    ).map(([value, labelKey]) => ({
                        value,
                        label: t(labelKey),
                        testID: `kitchen-exceptions-filter-status-${value}`,
                    }))}
                />
                <DatePickerButton
                    testID="kitchen-exceptions-filter-from"
                    label={t('kitchen:ops.exceptions.filterFrom')}
                    value={from}
                    onChange={(next) => {
                        setFrom(next);
                        refilter();
                    }}
                />
            </View>

            {exceptions.isPending ? (
                <View testID="kitchen-consumption-exceptions-loading" className="flex-col">
                    {Array.from({ length: 8 }, (_, index) => (
                        <View
                            key={index}
                            className="h-row-md flex-row items-center border-b border-stroke-subtle"
                        >
                            <Skeleton heightClassName="h-2" />
                        </View>
                    ))}
                </View>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-consumption-exceptions-error"
                    failure={failure}
                    onRetry={() => {
                        void exceptions.refetch();
                    }}
                    retrying={exceptions.isFetching}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-consumption-exceptions-empty"
                    title={t('kitchen:ops.exceptions.emptyTitle')}
                    body={t('kitchen:ops.exceptions.emptyBody')}
                />
            ) : (
                <View className="flex-col gap-2.5">
                    <CatalogueList<ConsumptionException>
                        testID="kitchen-consumption-exceptions-table"
                        label={t('kitchen:ops.exceptions.title')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => row.id}
                        onRowPress={setViewing}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                    />
                    <View className="flex-row flex-wrap items-center justify-between gap-snug">
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.exceptions.showingCount', { count: rows.length })}
                        </Text>
                        {hasMore ? (
                            <Button
                                testID="kitchen-consumption-exceptions-next"
                                variant="secondary"
                                size="sm"
                                label={t('kitchen:ops.exceptions.nextPage')}
                                onPress={() => {
                                    setCursor(nextCursor ?? undefined);
                                    setViewing(null);
                                }}
                            />
                        ) : null}
                    </View>
                </View>
            )}

            <Dialog
                testID="kitchen-exception-resolve-dialog"
                open={resolving !== null}
                onClose={() => {
                    setResolving(null);
                }}
                title={t('kitchen:ops.exceptions.resolveTitle')}
                description={t('kitchen:ops.exceptions.resolveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-exception-resolve-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setResolving(null);
                            }}
                        />
                        <Button
                            testID="kitchen-exception-resolve-confirm"
                            variant="danger"
                            label={t('kitchen:ops.exceptions.resolveConfirm')}
                            loading={resolve.isPending}
                            onPress={confirmResolve}
                        />
                    </>
                }
            />
        </Stack>
    );
}
