import type { OrderProposalItem } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Table,
    Text,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useOrderProposalQuery,
    useSupplyNeedsCountQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { INVENTORY_ORDER_SUPPLIES_PERMISSION } from '../entity-registry.ts';
import { OpsPanel } from '../ops-panel.tsx';
import type { OpsMetric } from '../ops-panel.tsx';
import { supplyOrderRowTestId } from '../ops-format.ts';

/**
 * `/kitchen/supply-orders` — what the branch is short of, and the way into ordering it (SUP3).
 *
 * ## Two numbers, and they are not the same number
 *
 * The panel shows *out of stock* and *running low* separately because a person reads them
 * differently: nothing left is a service problem this shift, below the threshold is a purchasing
 * problem this week. Their sum is the queue, so the screen never adds a third tile claiming a total
 * — the count endpoint publishes all three and the two shown partition the one that is not.
 *
 * ## The preview is a preview, not the builder
 *
 * Eight rows and a count of the rest. It exists so somebody can tell at a glance whether the queue
 * is *four things* or *forty*, which changes whether they open the builder now or after service. It
 * deliberately carries no quantity boxes and no supplier pickers: a half-usable builder on the
 * landing page would be a second place to do the same job, and the two would drift.
 *
 * The rows come from the proposal endpoint rather than a second summary read, so the preview and the
 * builder are literally the same list — the first eight of it. The order is the server's and is
 * never re-sorted here either.
 *
 * ## Nothing to order is a good state, and it is dressed as one
 *
 * An empty queue is a kitchen that is fully stocked, not a screen with no content, so it reads
 * "Nothing needs ordering" with the tick icon rather than the shrug an empty list usually gets. The
 * secondary action stays: a manager who wants to order ahead of a busy weekend is not blocked by
 * the shelves currently being fine.
 *
 * `EmptyState` has two variants, `empty` and `prototype`, and neither is a positive one — so the
 * positivity is carried by the `success` icon and the wording rather than by a variant that does
 * not exist. Adding a third variant to a component seven screens depend on, for one screen's tone,
 * would be the wrong direction of change.
 *
 * ## There is no orders list yet
 *
 * Purchase orders arrive in a later slice. This screen renders **no placeholder furniture** for
 * them — no empty "Recent orders" card, no disabled tab — because a heading over nothing tells a
 * person a feature is broken rather than unbuilt. The layout is a `Stack` of sections, so the
 * section lands between the panel and the preview without anything moving.
 */

/** How much of the queue the landing page shows before it starts counting instead. */
const PREVIEW_ROWS = 8;

const EM_DASH = '—';

export function SupplyOrdersScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_ORDER_SUPPLIES_PERMISSION] }}
            testID="kitchen-supply-orders"
        >
            <SupplyOrders />
        </Gate>
    );
}

function SupplyOrders() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const access = useAccessState();

    const branchId = access.branch?.id ?? null;

    const needs = useSupplyNeedsCountQuery(branchId);
    const proposal = useOrderProposalQuery(branchId);

    /**
     * `null` while pending, which `OpsMetric` renders as an em dash — the three-way collapse the
     * hub's KPI tiles use. A zero here would claim the shelves are fine before anybody has looked.
     */
    const metrics: readonly OpsMetric[] = [
        {
            key: 'outOfStock',
            labelKey: 'kitchen:ops.supplyOrders.metrics.outOfStock',
            value: needs.data?.outOfStockCount ?? null,
        },
        {
            key: 'low',
            labelKey: 'kitchen:ops.supplyOrders.metrics.low',
            value: needs.data?.lowStockCount ?? null,
        },
    ];

    const rows = proposal.data?.items ?? [];
    const preview = rows.slice(0, PREVIEW_ROWS);
    const remaining = Math.max(rows.length - preview.length, 0);

    const failure = toFailure(needs.error ?? proposal.error);
    const isPending = needs.isPending || proposal.isPending;
    const isEmpty = !isPending && failure === null && rows.length === 0;

    const columns: readonly TableColumn<OrderProposalItem>[] = [
        {
            key: 'item',
            header: t('kitchen:ops.supplyOrders.columnItem'),
            rowHeader: true,
            flex: 2,
            render: (row) => {
                const testID = supplyOrderRowTestId(String(row.stockItemId));
                return (
                    <Stack space="none">
                        <Text variant="bodyStrong" testID={`${testID}-name`}>
                            {row.itemNameEn}
                        </Text>
                        <Text variant="caption" tone="secondary" testID={`${testID}-code`}>
                            {row.itemCode}
                        </Text>
                    </Stack>
                );
            },
        },
        {
            key: 'onHand',
            header: t('kitchen:ops.supplyOrders.columnOnHand'),
            flex: 2,
            render: (row) => {
                const testID = supplyOrderRowTestId(String(row.stockItemId));
                return (
                    <Inline space="xs" align="center" wrap>
                        <Text testID={`${testID}-on-hand`}>
                            {`${formatter.formatNumber(Number(row.quantityOnHand))} ${row.unitCode}`}
                        </Text>
                        {/*
                         * A word and a tone, never colour alone — the platform's standing rule, and
                         * the reason the badge carries a label rather than a dot. Out of stock wins
                         * when a row is both, matching the label the server already chose.
                         */}
                        {row.isOutOfStock ? (
                            <Badge
                                testID={`${testID}-out`}
                                tone="danger"
                                label={t('kitchen:ops.supplyOrders.outBadge')}
                            />
                        ) : row.isLow ? (
                            <Badge
                                testID={`${testID}-low`}
                                tone="warning"
                                label={t('kitchen:ops.supplyOrders.lowBadge')}
                            />
                        ) : null}
                    </Inline>
                );
            },
        },
        {
            key: 'reorderAt',
            header: t('kitchen:ops.supplyOrders.columnReorderAt'),
            numeric: true,
            render: (row) => (
                <Text
                    tone="secondary"
                    testID={`${supplyOrderRowTestId(String(row.stockItemId))}-reorder-at`}
                >
                    {row.reorderThreshold === null
                        ? EM_DASH
                        : formatter.formatNumber(Number(row.reorderThreshold))}
                </Text>
            ),
        },
    ];

    return (
        <Stack space="lg" testID="kitchen-supply-orders-screen">
            <Stack space="xs">
                <Heading level={1} testID="kitchen-supply-orders-title">
                    {t('kitchen:ops.supplyOrders.title')}
                </Heading>
                <Text tone="secondary" testID="kitchen-supply-orders-subtitle">
                    {t('kitchen:ops.supplyOrders.subtitle')}
                </Text>
            </Stack>

            {branchId === null ? (
                /*
                 * The screen does not fetch without a branch. A proposal is always for one site, an
                 * organisation-wide manager holds none, and asking anyway would spend a 422 to
                 * render "validation failed" at somebody who needs to pick a branch.
                 */
                <EmptyState
                    testID="kitchen-supply-orders-branch-required"
                    title={t('kitchen:ops.supplyOrders.branchRequiredTitle')}
                    body={t('kitchen:ops.supplyOrders.branchRequiredBody')}
                />
            ) : (
                <>
                    <OpsPanel
                        testID="kitchen-supply-orders-panel"
                        titleKey="kitchen:ops.supplyOrders.panelTitle"
                        subtitleKey="kitchen:ops.supplyOrders.panelSubtitle"
                        metrics={metrics}
                        emptyTitleKey="kitchen:ops.supplyOrders.emptyTitle"
                        emptyBodyKey="kitchen:ops.supplyOrders.emptyBody"
                    />

                    <Inline space="sm" align="center" justify="between" wrap>
                        <Heading level={2} testID="kitchen-supply-orders-preview-title">
                            {t('kitchen:ops.supplyOrders.previewTitle')}
                        </Heading>
                        {isEmpty ? null : (
                            <Button
                                testID="kitchen-supply-orders-prepare"
                                label={t('kitchen:ops.supplyOrders.prepare')}
                                onPress={() => {
                                    router.push('/kitchen/supply-orders/new' as never);
                                }}
                            />
                        )}
                    </Inline>

                    {isPending ? (
                        <Stack space="sm" testID="kitchen-supply-orders-loading">
                            {Array.from({ length: 3 }, (_, index) => (
                                <Card key={index} padding="md">
                                    <Stack space="xs">
                                        <Skeleton
                                            testID={`kitchen-supply-orders-skeleton-${String(index + 1)}`}
                                            heightClassName="h-5"
                                        />
                                        <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                                    </Stack>
                                </Card>
                            ))}
                        </Stack>
                    ) : failure !== null ? (
                        <ErrorState
                            testID="kitchen-supply-orders-error"
                            failure={failure}
                            onRetry={() => {
                                void needs.refetch();
                                void proposal.refetch();
                            }}
                            retrying={needs.isFetching || proposal.isFetching}
                        />
                    ) : isEmpty ? (
                        <EmptyState
                            testID="kitchen-supply-orders-empty"
                            icon="success"
                            title={t('kitchen:ops.supplyOrders.nothingNeededTitle')}
                            body={t('kitchen:ops.supplyOrders.nothingNeededBody')}
                            actions={
                                <Button
                                    testID="kitchen-supply-orders-order-anyway"
                                    variant="secondary"
                                    label={t('kitchen:ops.supplyOrders.orderAnyway')}
                                    onPress={() => {
                                        router.push('/kitchen/supply-orders/new' as never);
                                    }}
                                />
                            }
                        />
                    ) : (
                        <Stack space="sm">
                            <Table<OrderProposalItem>
                                testID="kitchen-supply-orders-preview"
                                caption={t('kitchen:ops.supplyOrders.previewCaption')}
                                captionHidden
                                columns={columns}
                                rows={preview}
                                rowKey={(row) => String(row.stockItemId)}
                            />
                            {remaining === 0 ? null : (
                                <Text
                                    tone="secondary"
                                    variant="caption"
                                    testID="kitchen-supply-orders-and-more"
                                >
                                    {t('kitchen:ops.supplyOrders.andMore', { count: remaining })}
                                </Text>
                            )}
                        </Stack>
                    )}
                </>
            )}
        </Stack>
    );
}
