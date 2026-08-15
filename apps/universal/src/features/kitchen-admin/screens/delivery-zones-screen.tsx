import type { DeliveryZoneAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Pagination,
    Skeleton,
    Stack,
    Table,
    Text,
} from '@healthy360/design-system';
import type { TableColumn, TableSortDirection } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { pagesInResult, useDeliveryZonePageQuery } from '../../../data/kitchen-admin-hooks.ts';
import { formatMoney, weekdayKey } from '../../marketplace/format.ts';
import { summariseWindows } from '../delivery-model.ts';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    ZONE_STATUS_FILTERS,
    displayName,
    statusKey,
    statusTone,
    zoneRowTestId,
} from '../format.ts';
import { ListToolbar } from '../list-toolbar.tsx';
import { useListPage } from '../use-list-page.ts';

/**
 * `/kitchen/delivery-zones` — where this kitchen delivers, for how much, and how quickly.
 *
 * ## The money columns state an absence as a fact
 *
 * `deliveryFeeMinor` and `minimumOrderMinor` are both nullable, and the two ways a column can get
 * that wrong are the two ways this screen refuses to. It never renders `null` as `0.00`, because
 * "we have not decided a fee" and "delivery is free" are different promises to a customer and only
 * one of them is safe to advertise. And it never renders `null` as an empty cell, because an empty
 * cell in a table of numbers reads as a loading state. So a zone with no fee says *no fee recorded*
 * and a zone with a zero fee says *free* — the same `null`-versus-zero distinction the price editor
 * enforces on a placeholder, one table further out.
 *
 * ## The window column is a coverage summary, not a count
 *
 * "Three windows" says nothing about whether Saturday is covered. The column therefore reports the
 * weekdays at least one *active* window reaches, which is the question a person opens this list to
 * answer, and marks a zone whose windows leave the week with holes in it.
 *
 * ## Sorting is client-side, and stated
 *
 * The same limitation the other six lists document: `DeliveryZoneAdminFilter` publishes no sort
 * parameter, so the table sorts what has been loaded.
 */

type SortKey = 'name' | 'status' | 'updatedAt';

export function DeliveryZonesScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-zones"
        >
            <DeliveryZonesList />
        </Gate>
    );
}

/** The gazetteer rows a zone covers, and the countries they sit in. */
function AreasCell({ row }: { readonly row: DeliveryZoneAdmin }) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const testID = zoneRowTestId(String(row.id));

    if (row.areas.length === 0) {
        return (
            <Text testID={`${testID}-areas-none`} tone="secondary">
                {t('kitchen:zones.noAreas')}
            </Text>
        );
    }

    const inactive = row.areas.filter((area) => !area.isActive).length;

    return (
        <Stack space="xs" testID={`${testID}-areas`}>
            <Text variant="bodyStrong" testID={`${testID}-area-count`}>
                {t('kitchen:zones.areaCount', { count: row.areas.length })}
            </Text>
            <Text variant="caption" tone="secondary" testID={`${testID}-area-names`}>
                {row.areas
                    .slice(0, 3)
                    .map((area) => displayName(area.name, locale).value)
                    .join(t('kitchen:common.listSeparator'))}
            </Text>
            {inactive === 0 ? null : (
                <Badge
                    testID={`${testID}-areas-inactive`}
                    tone="warning"
                    icon="warning"
                    label={t('kitchen:zones.inactiveAreaCount', { count: inactive })}
                />
            )}
        </Stack>
    );
}

/**
 * The fee and the minimum order, each of which may genuinely be absent.
 *
 * Three renderings and not two: an amount, `free` for a decided zero, and `not recorded` for a
 * `null`. See the note on the screen — collapsing any pair of them would state something the record
 * does not say.
 */
function ChargesCell({ row }: { readonly row: DeliveryZoneAdmin }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const testID = zoneRowTestId(String(row.id));

    const render = (amountMinor: number | null, kind: 'fee' | 'minimum'): string => {
        if (amountMinor === null) {
            return kind === 'fee'
                ? t('kitchen:zones.noFeeRecorded')
                : t('kitchen:zones.noMinimumRecorded');
        }
        if (amountMinor === 0) {
            return kind === 'fee' ? t('kitchen:zones.freeDelivery') : t('kitchen:zones.noMinimum');
        }
        return formatMoney(formatter, { amount: amountMinor, currency: row.currency });
    };

    return (
        <Stack space="xs" testID={`${testID}-charges`}>
            <Text testID={`${testID}-fee`}>
                {t('kitchen:zones.feeValue', { value: render(row.deliveryFeeMinor, 'fee') })}
            </Text>
            <Text testID={`${testID}-minimum`} tone="secondary" variant="caption">
                {t('kitchen:zones.minimumValue', {
                    value: render(row.minimumOrderMinor, 'minimum'),
                })}
            </Text>
        </Stack>
    );
}

/** How much of the week the zone's active windows actually reach. */
function WindowsCell({ row }: { readonly row: DeliveryZoneAdmin }) {
    const { t } = useTranslation();
    const testID = zoneRowTestId(String(row.id));
    const coverage = summariseWindows(row.deliveryWindows);

    if (coverage.total === 0) {
        return (
            <Text testID={`${testID}-windows-none`} tone="secondary">
                {t('kitchen:zones.noWindows')}
            </Text>
        );
    }

    return (
        <Stack space="xs" testID={`${testID}-windows`}>
            <Text testID={`${testID}-window-count`}>
                {t('kitchen:zones.windowCount', { count: coverage.total })}
            </Text>
            <Text variant="caption" tone="secondary" testID={`${testID}-window-weekdays`}>
                {coverage.weekdays.length === 0
                    ? t('kitchen:zones.noActiveWindows')
                    : coverage.weekdays
                          .map((weekday) => t(weekdayKey(weekday)))
                          .join(t('kitchen:common.listSeparator'))}
            </Text>
            {coverage.weekdays.length > 0 && coverage.weekdays.length < 7 ? (
                <Badge
                    testID={`${testID}-window-gaps`}
                    tone="info"
                    label={t('kitchen:zones.uncoveredDayCount', {
                        count: 7 - coverage.weekdays.length,
                    })}
                />
            ) : null}
        </Stack>
    );
}

function DeliveryZonesList() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const [query, setQuery] = useState('');
    const [statuses, setStatuses] = useState<readonly PublishableStatus[]>([]);
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [sortDirection, setSortDirection] = useState<TableSortDirection>('asc');

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(statuses.length === 0 ? {} : { statuses }),
        }),
        [trimmed, statuses],
    );

    const [page, setPage] = useListPage(filter);
    const zones = useDeliveryZonePageQuery(filter, page);
    // Left possibly-undefined rather than defaulted to `[]`: `?? []` is a fresh array on
    // every render, which would re-run anything memoised over it whether or not it changed.
    const rows = zones.data?.items;
    const total = zones.data?.totalCount ?? null;
    const totalPages = pagesInResult(zones.data) ?? 0;

    const sorted = useMemo(() => {
        const factor = sortDirection === 'asc' ? 1 : -1;
        return [...(rows ?? [])].sort((left, right) => {
            if (sortKey === 'status') {
                return factor * left.meta.status.localeCompare(right.meta.status);
            }
            if (sortKey === 'updatedAt') {
                return factor * left.meta.updatedAt.localeCompare(right.meta.updatedAt);
            }
            return (
                factor *
                displayName(left.name, locale).value.localeCompare(
                    displayName(right.name, locale).value,
                    locale,
                )
            );
        });
    }, [rows, sortKey, sortDirection, locale]);

    const columns: readonly TableColumn<DeliveryZoneAdmin>[] = [
        {
            key: 'name',
            header: t('kitchen:zones.columnName'),
            rowHeader: true,
            sortable: true,
            flex: 2,
            render: (row) => {
                const name = displayName(row.name, locale);
                const testID = zoneRowTestId(String(row.id));
                return (
                    <Stack space="none">
                        <Text variant="bodyStrong" testID={`${testID}-name`}>
                            {name.value}
                        </Text>
                        {name.isFallback ? (
                            <Badge
                                testID={`${testID}-missing-arabic`}
                                tone="warning"
                                icon="warning"
                                label={t('kitchen:list.missingArabic')}
                            />
                        ) : null}
                    </Stack>
                );
            },
        },
        {
            key: 'areas',
            header: t('kitchen:zones.columnAreas'),
            flex: 2,
            render: (row) => <AreasCell row={row} />,
        },
        {
            key: 'charges',
            header: t('kitchen:zones.columnCharges'),
            flex: 2,
            render: (row) => <ChargesCell row={row} />,
        },
        {
            key: 'windows',
            header: t('kitchen:zones.columnWindows'),
            flex: 2,
            render: (row) => <WindowsCell row={row} />,
        },
        {
            key: 'estimated',
            header: t('kitchen:zones.columnEstimated'),
            render: (row) => (
                <Text testID={`${zoneRowTestId(String(row.id))}-estimated`}>
                    {row.estimatedMinutes === null
                        ? t('kitchen:zones.noEstimate')
                        : t('kitchen:zones.estimatedMinutes', {
                              minutes: formatter.formatNumber(row.estimatedMinutes),
                          })}
                </Text>
            ),
        },
        {
            key: 'status',
            header: t('kitchen:list.columnStatus'),
            sortable: true,
            render: (row) => (
                <Badge
                    testID={`${zoneRowTestId(String(row.id))}-status`}
                    tone={statusTone(row.meta.status)}
                    label={t(statusKey(row.meta.status))}
                />
            ),
        },
        {
            key: 'updatedAt',
            header: t('kitchen:list.columnUpdated'),
            sortable: true,
            render: (row) => (
                <Stack space="none">
                    <Text testID={`${zoneRowTestId(String(row.id))}-updated`} variant="caption">
                        {formatter.formatRelativeTime(row.meta.updatedAt)}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {row.meta.updatedByName === null
                            ? t('kitchen:list.updatedBySeed')
                            : t('kitchen:list.updatedBy', { name: row.meta.updatedByName })}
                    </Text>
                </Stack>
            ),
        },
    ];

    const failure = toFailure(zones.error);
    const unfiltered = trimmed === '' && statuses.length === 0;

    return (
        <Stack space="lg" testID="kitchen-zones-screen">
            <Stack space="xs">
                <Heading level={1} testID="kitchen-zones-title">
                    {t('kitchen:zones.title')}
                </Heading>
                <Text tone="secondary" testID="kitchen-zones-subtitle">
                    {t('kitchen:zones.subtitle')}
                </Text>
            </Stack>

            <ListToolbar
                testID="kitchen-zones-toolbar"
                query={query}
                onQueryChange={setQuery}
                statuses={statuses}
                onStatusesChange={setStatuses}
                statusOptions={ZONE_STATUS_FILTERS}
                createLabel={t('kitchen:zones.create')}
                {...(canManage
                    ? {
                          onCreate: () => {
                              router.push('/kitchen/delivery-zones/new' as never);
                          },
                      }
                    : {})}
                {...(zones.isPending || total === null
                    ? {}
                    : { resultSummary: t('kitchen:zones.resultCount', { count: total }) })}
            />

            {zones.isPending ? (
                <Stack space="sm" testID="kitchen-zones-loading">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`kitchen-zones-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-zones-error"
                    failure={failure}
                    onRetry={() => {
                        void zones.refetch();
                    }}
                    retrying={zones.isFetching}
                />
            ) : sorted.length === 0 ? (
                <EmptyState
                    testID="kitchen-zones-empty"
                    title={
                        unfiltered
                            ? t('kitchen:zones.emptyTitle')
                            : t('kitchen:zones.filteredEmptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('kitchen:zones.emptyBody')
                            : t('kitchen:zones.filteredEmptyBody')
                    }
                />
            ) : (
                <Stack space="sm">
                    <Table<DeliveryZoneAdmin>
                        testID="kitchen-zones-table"
                        caption={t('kitchen:zones.caption')}
                        captionHidden
                        columns={columns}
                        rows={sorted}
                        rowKey={(row) => String(row.id)}
                        sortKey={sortKey}
                        sortDirection={sortDirection}
                        onSortChange={(key, direction) => {
                            setSortKey(key as SortKey);
                            setSortDirection(direction);
                        }}
                        rowAction={{
                            header: t('kitchen:list.actionHeader'),
                            render: (row) => (
                                <Inline space="xs" wrap justify="end">
                                    <Button
                                        testID={`${zoneRowTestId(String(row.id))}-open`}
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:list.open')}
                                        onPress={() => {
                                            router.push(
                                                `/kitchen/delivery-zones/${String(row.id)}` as never,
                                            );
                                        }}
                                    />
                                </Inline>
                            ),
                        }}
                    />

                    <Pagination
                        testID="kitchen-zones-pagination"
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        disabled={zones.isFetching}
                    />
                </Stack>
            )}
        </Stack>
    );
}
