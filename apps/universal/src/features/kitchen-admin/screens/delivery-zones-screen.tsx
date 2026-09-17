import type { DeliveryZoneAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    EmptyState,
    ErrorState,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { pagesInResult, useDeliveryZonePageQuery } from '../../../data/kitchen-admin-hooks.ts';
import { formatMoney, weekdayKey } from '../../marketplace/format.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn, SortDirection } from '../catalogue/use-column-controls.tsx';
import { summariseWindows } from '../delivery-model.ts';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    ZONE_STATUS_FILTERS,
    displayName,
    statusShortKey,
    statusTone,
    zoneRowTestId,
} from '../format.ts';
import { useListPage } from '../use-list-page.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';

/**
 * `/kitchen/delivery-zones` — where this kitchen delivers, for how much, and when (Commercial §3.4).
 *
 * ```
 *                                                                [ + New delivery zone ]
 * ┌ SHOWN ┐ ┌ NO AREAS ┐ ┌ NO WINDOWS ┐
 * [ ⌕ search ]  [ All | Live | Draft | Archived ]
 * ZONE    AREAS COVERED   FEE AND MINIMUM            DELIVERY WINDOWS          ESTIMATED   ◉ ✎
 * ```
 *
 * The Catalogue list's parts, unchanged.
 *
 * ## The money cell never merges its answers
 *
 * `Fee: 3.00 · Minimum: none` — each of the two is an amount, `free` / `none` for a decided zero, or
 * `no fee recorded` / `no minimum recorded` for a `null`. "Nothing recorded" and "free" are different
 * promises to a customer, and only one is safe to advertise.
 *
 * ## The window cell is coverage, not a count
 *
 * "3 windows · 6 days covered", "None of them are active", "No windows" — whether Saturday is reached
 * is the question a person opens this list to answer.
 */
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

const SEGMENT_STATUSES: readonly PublishableStatus[] = ['published', 'draft', 'retired'];
type StatusSegmentValue = PublishableStatus | 'all';

function DeliveryZonesList() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<StatusSegmentValue>('all');
    const [viewing, setViewing] = useState<DeliveryZoneAdmin | null>(null);

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(status === 'all' ? {} : { statuses: [status] }),
        }),
        [trimmed, status],
    );
    const [page, setPage] = useListPage(filter);
    const zones = useDeliveryZonePageQuery(filter, page);
    const rows = useMemo(() => zones.data?.items ?? [], [zones.data]);
    const total = zones.data?.totalCount ?? null;
    const totalPages = pagesInResult(zones.data) ?? 0;

    const openEditor = (row: DeliveryZoneAdmin) => {
        setViewing(null);
        router.push(`/kitchen/delivery-zones/${String(row.id)}` as never);
    };

    const columns: readonly ControlledColumn<
        DeliveryZoneAdmin,
        CatalogueColumn<DeliveryZoneAdmin>
    >[] = [
        {
            key: 'name',
            role: 'title',
            label: t('kitchen:zones.columnName'),
            width: 180,
            priority: 100,
            value: (row) => displayName(row.name, locale).value,
            sort: (left, right, direction) =>
                compareText(
                    displayName(left.name, locale).value,
                    displayName(right.name, locale).value,
                    direction,
                ),
            render: (row) => {
                const testID = zoneRowTestId(String(row.id));
                const name = displayName(row.name, locale);
                return (
                    <Stack space="none" testID={testID}>
                        <Text variant="strong" numberOfLines={1} testID={`${testID}-name`}>
                            {name.value}
                        </Text>
                        {name.isFallback ? (
                            <Badge
                                testID={`${testID}-missing-arabic`}
                                tone="warning"
                                label={t('kitchen:list.missingArabic')}
                            />
                        ) : null}
                    </Stack>
                );
            },
        },
        {
            key: 'areas',
            label: t('kitchen:zones.columnAreas'),
            width: 150,
            priority: 80,
            value: (row) => areasText(row, t),
            sort: (left, right, direction) =>
                compareNumber(left.areas.length, right.areas.length, direction),
            render: (row) => {
                const testID = zoneRowTestId(String(row.id));
                const inactive = row.areas.filter((area) => !area.isActive).length;
                return row.areas.length === 0 ? (
                    <Text tone="secondary" testID={`${testID}-areas-none`}>
                        {t('kitchen:zones.noAreas')}
                    </Text>
                ) : (
                    <Stack space="none">
                        <Text testID={`${testID}-area-count`}>
                            {t('kitchen:zones.areaCount', { count: row.areas.length })}
                        </Text>
                        {inactive === 0 ? null : (
                            <Text
                                variant="caption"
                                tone="warning"
                                testID={`${testID}-areas-inactive`}
                            >
                                {t('kitchen:zones.inactiveAreaCount', { count: inactive })}
                            </Text>
                        )}
                    </Stack>
                );
            },
        },
        {
            key: 'charges',
            role: 'metric',
            label: t('kitchen:zones.columnCharges'),
            width: 200,
            priority: 85,
            value: (row) => `${feeText(row, t, formatter)} · ${minimumText(row, t, formatter)}`,
            // By the fee, then the minimum — the order the cell states them in. A zone with no
            // fee recorded sorts last both ways rather than passing for a free one.
            sort: (left, right, direction) =>
                compareMissingLast(left.deliveryFeeMinor, right.deliveryFeeMinor, direction) ||
                compareMissingLast(left.minimumOrderMinor, right.minimumOrderMinor, direction),
            render: (row) => {
                const testID = zoneRowTestId(String(row.id));
                return (
                    <Text testID={`${testID}-charges`}>
                        <Text testID={`${testID}-fee`}>{feeText(row, t, formatter)}</Text>
                        {' · '}
                        <Text testID={`${testID}-minimum`} tone="secondary">
                            {minimumText(row, t, formatter)}
                        </Text>
                    </Text>
                );
            },
        },
        {
            key: 'windows',
            label: t('kitchen:zones.columnWindows'),
            width: 190,
            priority: 70,
            value: (row) => windowsText(row, t),
            // Coverage first — the days reached are what the cell is read for — then the count.
            sort: (left, right, direction) => {
                const a = summariseWindows(left.deliveryWindows);
                const b = summariseWindows(right.deliveryWindows);
                return (
                    compareNumber(a.weekdays.length, b.weekdays.length, direction) ||
                    compareNumber(a.total, b.total, direction)
                );
            },
            render: (row) => {
                const testID = zoneRowTestId(String(row.id));
                const coverage = summariseWindows(row.deliveryWindows);
                if (coverage.total === 0) {
                    return (
                        <Text tone="secondary" testID={`${testID}-windows-none`}>
                            {t('kitchen:zones.noWindows')}
                        </Text>
                    );
                }
                return (
                    <Text testID={`${testID}-windows`}>
                        <Text testID={`${testID}-window-count`}>
                            {t('kitchen:zones.windowCount', { count: coverage.total })}
                        </Text>
                        {' · '}
                        <Text tone={coverage.weekdays.length === 0 ? 'warning' : 'secondary'}>
                            {coverage.weekdays.length === 0
                                ? t('kitchen:zones.noActiveWindows')
                                : t('kitchen:zones.coveredDayCount', {
                                      count: coverage.weekdays.length,
                                  })}
                        </Text>
                    </Text>
                );
            },
        },
        {
            key: 'estimated',
            label: t('kitchen:zones.columnEstimated'),
            width: 110,
            priority: 40,
            value: (row) => estimatedText(row, t, formatter),
            sort: (left, right, direction) =>
                compareMissingLast(left.estimatedMinutes, right.estimatedMinutes, direction),
            render: (row) => (
                <Text
                    tone={row.estimatedMinutes === null ? 'secondary' : 'primary'}
                    testID={`${zoneRowTestId(String(row.id))}-estimated`}
                >
                    {estimatedText(row, t, formatter)}
                </Text>
            ),
        },
        {
            key: 'status',
            role: 'status',
            label: t('kitchen:list.columnStatus'),
            width: 96,
            priority: 75,
            value: (row) => t(statusShortKey(row.meta.status)),
            // The status the request already carries, so the header and the segments are one
            // filter: narrowing the loaded page instead would misreport every page after it.
            filter: {
                values: () =>
                    ZONE_STATUS_FILTERS.map((value) => ({
                        key: value,
                        label: t(statusShortKey(value)),
                    })),
                external: {
                    value: status === 'all' ? null : status,
                    onChange: (next) => {
                        setStatus(next === null ? 'all' : (next as PublishableStatus));
                        setViewing(null);
                    },
                },
            },
            render: (row) => (
                <Badge
                    testID={`${zoneRowTestId(String(row.id))}-status`}
                    tone={statusTone(row.meta.status)}
                    label={t(statusShortKey(row.meta.status))}
                />
            ),
        },
    ];

    const controls = useColumnControls(rows, columns, 'kitchen-zones');
    const failure = toFailure(zones.error);
    const unfiltered = trimmed === '' && status === 'all';

    const statusSegments: readonly CatalogueStatusSegment<StatusSegmentValue>[] = [
        { value: 'all', label: t('kitchen:toolbar.statusAll') },
        ...SEGMENT_STATUSES.map((value) => ({ value, label: t(statusShortKey(value)) })),
    ];

    const noAreas = controls.rows.filter((row) => row.areas.length === 0).length;
    const noWindows = controls.rows.filter(
        (row) => summariseWindows(row.deliveryWindows).weekdays.length === 0,
    ).length;
    const cards: readonly CatalogueStatCard[] = [
        {
            key: 'shown',
            label: t('kitchen:list.statShown'),
            value: String(controls.rows.length),
            unit: t('kitchen:list.statShownUnit', { total: total ?? controls.rows.length }),
            caption: unfiltered
                ? t('kitchen:list.statShownUnfiltered')
                : t('kitchen:list.statShownFiltered'),
            mark: 'calendar',
            tone: 'brand',
            onPress: () => {
                setQuery('');
                setStatus('all');
            },
            accessibilityLabel: t('kitchen:list.statShownAction'),
        },
        {
            key: 'noAreas',
            label: t('kitchen:zones.noAreas'),
            value: String(noAreas),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:zones.statNoAreasCaption'),
            mark: 'warning',
            tone: noAreas === 0 ? 'default' : 'warning',
        },
        {
            key: 'noWindows',
            label: t('kitchen:zones.noActiveWindows'),
            value: String(noWindows),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:zones.statNoWindowsCaption'),
            mark: 'warning',
            tone: noWindows === 0 ? 'default' : 'warning',
        },
    ];

    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-zones-view"
                onBack={() => {
                    setViewing(null);
                }}
                title={displayName(viewing.name, locale).value}
                kind={t('kitchen:zones.viewKind')}
                status={{
                    label: t(statusShortKey(viewing.meta.status)),
                    tone: statusTone(viewing.meta.status),
                }}
                fields={[
                    {
                        key: 'currency',
                        label: t('kitchen:priceLists.columnCurrency'),
                        value: viewing.currency,
                        mono: true,
                    },
                    {
                        key: 'estimated',
                        label: t('kitchen:zones.columnEstimated'),
                        value: estimatedText(viewing, t, formatter),
                    },
                    {
                        key: 'fee',
                        label: t('kitchen:zones.viewFee'),
                        value: feeText(viewing, t, formatter),
                    },
                    {
                        key: 'minimum',
                        label: t('kitchen:zones.viewMinimum'),
                        value: minimumText(viewing, t, formatter),
                    },
                    {
                        key: 'windows',
                        label: t('kitchen:zones.columnWindows'),
                        value: windowsText(viewing, t),
                    },
                    {
                        key: 'weekdays',
                        label: t('kitchen:zones.viewWeekdays'),
                        value: (() => {
                            const days = summariseWindows(viewing.deliveryWindows).weekdays;
                            return days.length === 0
                                ? t('kitchen:zones.noActiveWindows')
                                : days
                                      .map((day) => t(weekdayKey(day)))
                                      .join(t('kitchen:common.listSeparator'));
                        })(),
                    },
                ]}
                chipsLabel={t('kitchen:zones.columnAreas')}
                chips={
                    viewing.areas.length === 0
                        ? [{ key: 'none', label: t('kitchen:zones.noAreas') }]
                        : viewing.areas.map((area) => ({
                              key: String(area.id),
                              label: displayName(area.name, locale).value,
                          }))
                }
                primaryAction={{
                    label: t('kitchen:catalogue.edit'),
                    onPress: () => {
                        openEditor(viewing);
                    },
                }}
            />
        );
    }

    return (
        <Stack space="md" testID="kitchen-zones-screen">
            {zones.isPending || failure !== null ? null : (
                <CatalogueStatCards testID="kitchen-zones-stats" cards={cards} />
            )}

            <CatalogueToolbar<StatusSegmentValue>
                testID="kitchen-zones-toolbar"
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                statusLabel={t('kitchen:toolbar.statusLabel')}
                statusSegments={statusSegments}
                status={status}
                onStatusChange={(next) => {
                    setStatus(next);
                    setViewing(null);
                }}
            >
                {canManage ? (
                    <Button
                        testID="kitchen-zones-toolbar-create"
                        label={t('kitchen:zones.create')}
                        onPress={() => {
                            router.push('/kitchen/delivery-zones/new' as never);
                        }}
                    />
                ) : null}
            </CatalogueToolbar>

            {zones.isPending ? (
                <Stack space="xs" testID="kitchen-zones-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-zones-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
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
            ) : controls.rows.length === 0 ? (
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
                    <CatalogueList<DeliveryZoneAdmin>
                        testID="kitchen-zones-table"
                        label={t('kitchen:zones.caption')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        onRowPress={openEditor}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${zoneRowTestId(String(row.id))}-view`,
                                onSelect: () => {
                                    setViewing(row);
                                },
                            },
                            {
                                key: 'edit',
                                label: t('kitchen:catalogue.edit'),
                                icon: CATALOGUE_ROW_ICONS.edit,
                                testID: `${zoneRowTestId(String(row.id))}-open`,
                                onSelect: () => {
                                    openEditor(row);
                                },
                            },
                        ]}
                    />
                    <CataloguePager
                        testID="kitchen-zones-pagination"
                        range={t('kitchen:toolbar.showing', {
                            shown: controls.rows.length,
                            total: total ?? controls.rows.length,
                        })}
                        page={page}
                        totalPages={totalPages}
                        onPageChange={(next) => {
                            setPage(next);
                            setViewing(null);
                        }}
                        label={t('kitchen:catalogue.pagerLabel')}
                    />
                </Stack>
            )}
        </Stack>
    );
}

/** Numbers in `direction`, with an unrecorded value last either way. */
function compareMissingLast(
    left: number | null,
    right: number | null,
    direction: SortDirection,
): number {
    if (left === null || right === null) {
        return left === right ? 0 : left === null ? 1 : -1;
    }
    return compareNumber(left, right, direction);
}

/** An amount, the decided-zero word, or the no-record words — never one for another. */
function money(
    row: DeliveryZoneAdmin,
    amountMinor: number | null,
    unset: string,
    zero: string,
    formatter: Formatter,
): string {
    if (amountMinor === null) return unset;
    if (amountMinor === 0) return zero;
    return formatMoney(formatter, { amount: amountMinor, currency: row.currency });
}

function feeText(row: DeliveryZoneAdmin, t: TFunction, formatter: Formatter): string {
    return t('kitchen:zones.feeValue', {
        value: money(
            row,
            row.deliveryFeeMinor,
            t('kitchen:zones.noFeeRecorded'),
            t('kitchen:zones.freeDelivery'),
            formatter,
        ),
    });
}

function minimumText(row: DeliveryZoneAdmin, t: TFunction, formatter: Formatter): string {
    return t('kitchen:zones.minimumValue', {
        value: money(
            row,
            row.minimumOrderMinor,
            t('kitchen:zones.noMinimumRecorded'),
            t('kitchen:zones.noMinimum'),
            formatter,
        ),
    });
}

function areasText(row: DeliveryZoneAdmin, t: TFunction): string {
    return row.areas.length === 0
        ? t('kitchen:zones.noAreas')
        : t('kitchen:zones.areaCount', { count: row.areas.length });
}

function windowsText(row: DeliveryZoneAdmin, t: TFunction): string {
    const coverage = summariseWindows(row.deliveryWindows);
    if (coverage.total === 0) return t('kitchen:zones.noWindows');
    const count = t('kitchen:zones.windowCount', { count: coverage.total });
    return coverage.weekdays.length === 0
        ? `${count} · ${t('kitchen:zones.noActiveWindows')}`
        : `${count} · ${t('kitchen:zones.coveredDayCount', { count: coverage.weekdays.length })}`;
}

function estimatedText(row: DeliveryZoneAdmin, t: TFunction, formatter: Formatter): string {
    return row.estimatedMinutes === null
        ? t('kitchen:zones.noEstimate')
        : t('kitchen:zones.estimatedMinutes', {
              minutes: formatter.formatNumber(row.estimatedMinutes),
          });
}
