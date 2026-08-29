import type { ConsumptionException } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    EmptyState,
    ErrorState,
    Inline,
    Select,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { can } from '@healthy360/permissions';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useConsumptionExceptionsQuery,
    useResolveConsumptionExceptionMutation,
    useRetryConsumptionExceptionMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { INVENTORY_MANAGE_PERMISSION, INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import { OpsPanel } from '../ops-panel.tsx';

/**
 * `/kitchen/consumption-exceptions` — the consumption-exception review surface (INV1.5).
 *
 * Every thing a confirmed order could not deduct honestly (INV1.2), so the kitchen can see which
 * sales left the stock figures incomplete and act: **resolve** one it has looked at and accepted, or
 * **retry** one whose cause it has fixed (published the recipe, created the stock item, received
 * stock). The retry re-runs the same deduction a confirm uses, guarded so nothing is deducted twice.
 *
 * Behind `inventory.view_organisation` — reading the queue is a plain ops read; the resolve and retry
 * controls are shown only to a holder of `inventory.manage_organisation`. Nothing confidential shows:
 * an order number, the sold item, the branch, the reason and its detail — never a recipe or a cost.
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
    const state = useAccessState();
    const canManage = can(state, INVENTORY_MANAGE_PERMISSION);

    const [status, setStatus] = useState<StatusFilter>('unresolved');
    const [from, setFrom] = useState('');
    const [cursor, setCursor] = useState<string | undefined>(undefined);

    const filter = useMemo(
        () => ({
            ...(status === 'all' ? {} : { resolved: status === 'resolved' }),
            ...(from.trim() === '' ? {} : { from: from.trim() }),
            ...(cursor === undefined ? {} : { cursor }),
        }),
        [status, from, cursor],
    );
    const exceptions = useConsumptionExceptionsQuery(filter);

    const resolve = useResolveConsumptionExceptionMutation();
    const retry = useRetryConsumptionExceptionMutation();
    // The one row a write is in flight for, so only its buttons show the spinner.
    const [pendingId, setPendingId] = useState<string | null>(null);

    function resetCursor() {
        setCursor(undefined);
    }

    const rows = exceptions.data?.items ?? [];
    const nextCursor = exceptions.data?.nextCursor ?? null;
    const hasMore = (exceptions.data?.hasMore ?? false) && nextCursor !== null;

    const statusOptions = [
        { value: 'unresolved', label: t('kitchen:ops.exceptions.filterUnresolved') },
        { value: 'resolved', label: t('kitchen:ops.exceptions.filterResolved') },
        { value: 'all', label: t('kitchen:ops.exceptions.filterAll') },
    ];

    const reasonLabel = (row: ConsumptionException): string =>
        t(`kitchen:ops.exceptions.reasons.${row.reasonCode}`);

    const columns: readonly TableColumn<ConsumptionException>[] = [
        {
            key: 'order',
            header: t('kitchen:ops.exceptions.columnOrder'),
            rowHeader: true,
            render: (row) => (
                <Stack space="none">
                    <Text variant="bodyStrong" testID={`kitchen-exception-${row.id}-order`}>
                        {row.orderNumber ?? t('kitchen:ops.exceptions.unknownOrder')}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {row.itemNameEn ?? t('kitchen:ops.exceptions.unknownItem')}
                    </Text>
                </Stack>
            ),
        },
        {
            key: 'branch',
            header: t('kitchen:ops.exceptions.columnBranch'),
            render: (row) => (
                <Text variant="caption" tone="secondary">
                    {row.branchName ?? '—'}
                </Text>
            ),
        },
        {
            key: 'reason',
            header: t('kitchen:ops.exceptions.columnReason'),
            flex: 2,
            render: (row) => (
                <Stack space="none">
                    <Text variant="bodyStrong" testID={`kitchen-exception-${row.id}-reason`}>
                        {reasonLabel(row)}
                    </Text>
                    {row.detail === null ? null : (
                        <Text variant="caption" tone="secondary" numberOfLines={2}>
                            {row.detail}
                        </Text>
                    )}
                </Stack>
            ),
        },
        {
            key: 'raised',
            header: t('kitchen:ops.exceptions.columnRaised'),
            render: (row) => (
                <Text variant="caption" tone="secondary">
                    {row.createdAt === null
                        ? '—'
                        : formatter.formatDate(row.createdAt, { dateStyle: 'medium' })}
                </Text>
            ),
        },
        {
            key: 'status',
            header: t('kitchen:ops.exceptions.columnStatus'),
            flex: 2,
            render: (row) =>
                row.resolved ? (
                    <Stack space="none">
                        <Badge
                            testID={`kitchen-exception-${row.id}-resolved`}
                            tone="success"
                            icon="check"
                            label={t('kitchen:ops.exceptions.resolvedBadge')}
                        />
                        {row.resolutionNote === null ? null : (
                            <Text variant="caption" tone="secondary" numberOfLines={2}>
                                {row.resolutionNote}
                            </Text>
                        )}
                    </Stack>
                ) : canManage ? (
                    <Inline space="xs" wrap>
                        <Button
                            testID={`kitchen-exception-${row.id}-retry`}
                            // The row's primary (KITCHEN.md 7i): retrying is the fix — resolving
                            // without one is the concession, and stays quiet beside it.
                            size="sm"
                            label={t('kitchen:ops.exceptions.retry')}
                            loading={pendingId === row.id && retry.isPending}
                            disabled={pendingId !== null}
                            onPress={() => {
                                setPendingId(row.id);
                                retry.mutate(row.id, {
                                    onSettled: () => {
                                        setPendingId(null);
                                    },
                                });
                            }}
                        />
                        <Button
                            testID={`kitchen-exception-${row.id}-resolve`}
                            variant="quiet"
                            size="sm"
                            label={t('kitchen:ops.exceptions.resolve')}
                            loading={pendingId === row.id && resolve.isPending}
                            disabled={pendingId !== null}
                            onPress={() => {
                                setPendingId(row.id);
                                resolve.mutate(
                                    { exceptionId: row.id },
                                    {
                                        onSettled: () => {
                                            setPendingId(null);
                                        },
                                    },
                                );
                            }}
                        />
                    </Inline>
                ) : (
                    <Badge
                        testID={`kitchen-exception-${row.id}-open`}
                        tone="warning"
                        icon="warning"
                        label={t('kitchen:ops.exceptions.openBadge')}
                    />
                ),
        },
    ];

    const failure = toFailure(exceptions.error);

    return (
        <Stack space="lg" testID="kitchen-consumption-exceptions-screen">
            <OpsPanel
                testID="kitchen-consumption-exceptions-panel"
                titleKey="kitchen:ops.exceptions.title"
                subtitleKey="kitchen:ops.exceptions.subtitle"
                metrics={[]}
                emptyTitleKey="kitchen:ops.exceptions.emptyTitle"
                emptyBodyKey="kitchen:ops.exceptions.emptyBody"
            >
                <Stack space="md" testID="kitchen-consumption-exceptions-content">
                    <Inline space="sm" align="end" wrap>
                        <Select
                            testID="kitchen-exceptions-filter-status"
                            label={t('kitchen:ops.exceptions.filterStatus')}
                            options={statusOptions}
                            value={status}
                            onChange={(value) => {
                                setStatus(value as StatusFilter);
                                resetCursor();
                            }}
                            className="min-w-[180px]"
                        />
                        <TextInputField
                            testID="kitchen-exceptions-filter-from"
                            label={t('kitchen:ops.exceptions.filterFrom')}
                            value={from}
                            onChangeText={(value) => {
                                setFrom(value);
                                resetCursor();
                            }}
                            placeholder="YYYY-MM-DD"
                            className="w-40"
                        />
                    </Inline>

                    {exceptions.isPending ? (
                        <Stack space="sm" testID="kitchen-consumption-exceptions-loading">
                            {Array.from({ length: 4 }, (_, index) => (
                                <Skeleton key={index} heightClassName="h-12" />
                            ))}
                        </Stack>
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
                        <Stack space="sm">
                            <Table<ConsumptionException>
                                testID="kitchen-consumption-exceptions-table"
                                caption={t('kitchen:ops.exceptions.title')}
                                captionHidden
                                columns={columns}
                                rows={rows}
                                rowKey={(row) => row.id}
                            />
                            {hasMore ? (
                                <Inline space="sm" justify="end">
                                    <Button
                                        testID="kitchen-consumption-exceptions-next"
                                        variant="secondary"
                                        size="sm"
                                        label={t('kitchen:ops.exceptions.nextPage')}
                                        onPress={() => {
                                            setCursor(nextCursor ?? undefined);
                                        }}
                                    />
                                </Inline>
                            ) : null}
                        </Stack>
                    )}
                </Stack>
            </OpsPanel>
        </Stack>
    );
}
