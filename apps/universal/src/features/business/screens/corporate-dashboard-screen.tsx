import {
    Badge,
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    InfoTip,
    Inline,
    SearchInput,
    Stack,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import type { CorporateProgramme, Quotation } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useCorporateCatalogueQuery,
    useCorporateProgrammesQuery,
    useQuotationsQuery,
} from '../../../data/business-hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../../kitchen-admin/catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../../kitchen-admin/catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../../kitchen-admin/catalogue/catalogue-column-spec.ts';
import { CataloguePageHeader } from '../../kitchen-admin/catalogue/catalogue-page-header.tsx';
import { CatalogueStatCards } from '../../kitchen-admin/catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../../kitchen-admin/catalogue/catalogue-toolbar.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../../kitchen-admin/catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../../kitchen-admin/catalogue/use-column-controls.tsx';
import { WorkbenchSectionHeading } from '../../kitchen-admin/workbench-parts.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { CORPORATE_QUOTATIONS_HREF, corporateCatalogueHref } from '../corporate-chrome.tsx';
import { contractPriceTestId, quotationStateKey, quotationTone } from '../format.ts';

/**
 * `/corporate` — the programmes this account buys through, and what is outstanding on each.
 *
 * The admin hub's shape (`kitchen-admin/screens/kitchen-home-screen.tsx`): the title, a strip of
 * summary cards, then the programmes as a table and the latest quotations under it. The rail
 * carries the same programmes, one catalogue each.
 *
 * ## Prices are allowed here, and only here
 *
 * This is a corporate surface, so it may render negotiated figures — the per-employee subsidy is
 * one. Every such figure carries the `contract-price-` marker so the privacy sweep can prove none of
 * them reaches a consumer route (`../format.ts`).
 *
 * ## Counts, not totals
 *
 * The overview spans programmes, and programmes are not guaranteed to share a currency — one
 * fixture line is priced in SAR precisely to make that concrete. So the cards report programme,
 * line and quotation counts, and leave money to the single-programme screens where a currency is
 * actually established.
 */

/** How many quotations the overview lists before handing over to the quotations page. */
const RECENT_QUOTATIONS = 5;

export function CorporateDashboardScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const [code, setCode] = useState('');
    const [search, setSearch] = useState('');

    const programmes = useCorporateProgrammesQuery();
    const visible = useMemo<readonly CorporateProgramme[]>(
        () => programmes.data ?? [],
        [programmes.data],
    );
    const quotations = useQuotationsQuery();
    const outstanding: readonly Quotation[] = quotations.data?.items ?? [];

    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return visible.filter(
            (programme) => needle === '' || programme.name.toLowerCase().includes(needle),
        );
    }, [visible, search]);

    const termText = (programme: CorporateProgramme): string => {
        const start = formatter.formatDate(programme.startsAt, { dateStyle: 'medium' });
        return programme.endsAt === null
            ? t('business:programme.termOpenShort', { start })
            : t('business:programme.termShort', {
                  start,
                  end: formatter.formatDate(programme.endsAt, { dateStyle: 'medium' }),
              });
    };

    const columns: readonly ControlledColumn<
        CorporateProgramme,
        CatalogueColumn<CorporateProgramme>
    >[] = [
        {
            key: 'name',
            role: 'title',
            label: t('business:programme.columnProgramme'),
            width: 220,
            min: 160,
            grow: true,
            priority: 100,
            value: (programme) => programme.name,
            sort: (left, right, direction) => compareText(left.name, right.name, direction),
            render: (programme) => (
                <Text
                    variant="bodyStrong"
                    numberOfLines={1}
                    testID={`corporate-programme-${String(programme.id)}-name`}
                >
                    {programme.name}
                </Text>
            ),
        },
        {
            key: 'state',
            role: 'status',
            label: t('business:programme.columnState'),
            width: 120,
            priority: 90,
            value: (programme) =>
                programme.isActive
                    ? t('business:programme.active')
                    : t('business:programme.inactive'),
            filter: {
                values: () => [
                    { key: 'active', label: t('business:programme.active') },
                    { key: 'inactive', label: t('business:programme.inactive') },
                ],
                match: (programme, value) => programme.isActive === (value === 'active'),
            },
            render: (programme) => (
                <Badge
                    testID={`corporate-programme-${String(programme.id)}-state`}
                    tone={programme.isActive ? 'success' : 'neutral'}
                    label={
                        programme.isActive
                            ? t('business:programme.active')
                            : t('business:programme.inactive')
                    }
                />
            ),
        },
        {
            key: 'headcount',
            role: 'metric',
            label: t('business:programme.columnHeadcount'),
            width: 90,
            align: 'end',
            priority: 85,
            value: (programme) => formatter.formatNumber(programme.headcount),
            sort: (left, right, direction) =>
                compareNumber(left.headcount, right.headcount, direction),
            render: (programme) => (
                <Text
                    variant="mono"
                    testID={`corporate-programme-${String(programme.id)}-headcount`}
                >
                    {formatter.formatNumber(programme.headcount)}
                </Text>
            ),
        },
        {
            key: 'subsidy',
            role: 'meta',
            label: t('business:programme.columnSubsidy'),
            width: 130,
            align: 'end',
            priority: 80,
            value: (programme) =>
                programme.employeeSubsidy === null
                    ? t('business:programme.noSubsidyShort')
                    : formatMoney(formatter, programme.employeeSubsidy),
            render: (programme) =>
                programme.employeeSubsidy === null ? (
                    <Text
                        tone="secondary"
                        testID={`corporate-programme-${String(programme.id)}-no-subsidy`}
                    >
                        {t('business:programme.noSubsidyShort')}
                    </Text>
                ) : (
                    <Text
                        variant="mono"
                        testID={contractPriceTestId(`subsidy-${String(programme.id)}`)}
                    >
                        {formatMoney(formatter, programme.employeeSubsidy)}
                    </Text>
                ),
        },
        {
            key: 'lines',
            role: 'meta',
            label: t('business:programme.columnLines'),
            width: 110,
            align: 'end',
            priority: 75,
            sort: false,
            value: () => '',
            render: (programme) => <ProgrammeLineCount programme={programme} />,
        },
        {
            key: 'term',
            role: 'meta',
            label: t('business:programme.columnTerm'),
            width: 200,
            priority: 60,
            value: termText,
            sort: (left, right, direction) => compareText(left.startsAt, right.startsAt, direction),
            render: (programme) => (
                <Text
                    tone="secondary"
                    numberOfLines={1}
                    testID={`corporate-programme-${String(programme.id)}-term`}
                >
                    {termText(programme)}
                </Text>
            ),
        },
        {
            key: 'manager',
            role: 'meta',
            label: t('business:programme.columnManager'),
            width: 160,
            priority: 50,
            value: (programme) =>
                programme.accountManagerName ?? t('business:programme.noManagerShort'),
        },
        {
            key: 'locations',
            role: 'meta',
            label: t('business:programme.columnLocations'),
            width: 200,
            priority: 40,
            value: (programme) =>
                programme.deliveryLocations.join(t('business:common.listSeparator')),
        },
    ];

    const controls = useColumnControls(rows, columns, 'corporate-programmes', {
        picker: { defaults: ['name', 'state', 'headcount', 'subsidy', 'lines', 'term'] },
    });
    const programmesFailure = toFailure(programmes.error);
    const quotationsFailure = toFailure(quotations.error);
    const unfiltered = search === '' && !controls.filtered;

    const awaiting = outstanding.filter((row) => row.state === 'quoted').length;
    const open = outstanding.filter(
        (row) => row.state === 'draft' || row.state === 'submitted' || row.state === 'in_review',
    ).length;
    const running = visible.filter((programme) => programme.isActive).length;
    const recent = [...outstanding]
        .sort((left, right) => compareText(left.requestedAt, right.requestedAt, 'desc'))
        .slice(0, RECENT_QUOTATIONS);

    const openLookup = () => {
        if (code.trim() === '') return;
        router.push(`/corporate/items/${code.trim()}` as never);
    };

    return (
        <Cascade space="md" testID="corporate-dashboard-screen">
            <CataloguePageHeader
                testID="corporate-dashboard-header"
                titleTestID="corporate-dashboard-title"
                title={t('business:dashboard.title')}
                titleAside={
                    <InfoTip
                        testID="corporate-programme-source"
                        label={t('business:dashboard.title')}
                        text={t('business:dashboard.sourceNote')}
                    />
                }
                primaryAction={
                    <Inline space="xs" align="center" testID="corporate-lookup">
                        <SearchInput
                            testID="corporate-lookup-code"
                            size="sm"
                            label={t('business:dashboard.lookupLabel')}
                            placeholder={t('business:dashboard.lookupPlaceholder')}
                            value={code}
                            onChangeText={setCode}
                            onSubmitEditing={openLookup}
                            className="w-[220px]"
                        />
                        <Button
                            testID="corporate-lookup-open"
                            size="sm"
                            variant="secondary"
                            label={t('business:dashboard.lookupOpen')}
                            disabled={code.trim() === ''}
                            onPress={openLookup}
                        />
                    </Inline>
                }
            />

            <CatalogueStatCards
                testID="corporate-dashboard-stats"
                cards={[
                    {
                        key: 'programmes',
                        label: t('business:dashboard.statProgrammes'),
                        value: formatter.formatNumber(visible.length),
                        caption: t('business:dashboard.statProgrammesCaption', {
                            count: running,
                        }),
                        mark: 'building',
                        tone: 'brand',
                        pending: programmes.isPending,
                    },
                    {
                        key: 'open',
                        label: t('business:dashboard.statOpen'),
                        value: formatter.formatNumber(open),
                        mark: 'clock',
                        pending: quotations.isPending,
                        onPress: () => {
                            router.push(`${CORPORATE_QUOTATIONS_HREF}?state=open` as never);
                        },
                        accessibilityLabel: t('business:dashboard.statOpen'),
                    },
                    {
                        key: 'awaiting',
                        label: t('business:dashboard.statAwaiting'),
                        value: formatter.formatNumber(awaiting),
                        mark: 'circleCheck',
                        tone: awaiting === 0 ? 'default' : 'warning',
                        pending: quotations.isPending,
                        onPress: () => {
                            router.push(`${CORPORATE_QUOTATIONS_HREF}?state=quoted` as never);
                        },
                        accessibilityLabel: t('business:dashboard.statAwaiting'),
                    },
                ]}
            />

            <CatalogueToolbar
                testID="corporate-programmes-toolbar"
                search={search}
                onSearchChange={setSearch}
                searchLabel={t('business:dashboard.searchLabel')}
                searchPlaceholder={t('business:programme.columnProgramme')}
            />

            {programmes.isPending ? (
                <TableSkeleton testID="corporate-programmes-loading" />
            ) : programmesFailure !== null ? (
                <ErrorState
                    testID="corporate-programmes-error"
                    title={t('business:dashboard.loadErrorTitle')}
                    failure={programmesFailure}
                    onRetry={() => {
                        void programmes.refetch();
                    }}
                    retrying={programmes.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="corporate-programmes-empty"
                    title={
                        unfiltered
                            ? t('business:dashboard.emptyTitle')
                            : t('business:catalogue.emptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('business:dashboard.emptyBody')
                            : t('business:dashboard.emptyFilteredBody')
                    }
                    actions={
                        unfiltered ? undefined : (
                            <Button
                                testID="corporate-programmes-clear"
                                size="sm"
                                variant="secondary"
                                label={t('business:catalogue.clearFilters')}
                                onPress={() => {
                                    setSearch('');
                                    controls.clearFilters();
                                }}
                            />
                        )
                    }
                />
            ) : (
                <CatalogueList<CorporateProgramme>
                    testID="corporate-programme-list"
                    label={t('business:dashboard.programmesCaption')}
                    columns={controls.columns}
                    rows={controls.rows}
                    rowKey={(programme) => String(programme.id)}
                    density="sm"
                    onRowPress={(programme) => {
                        router.push(corporateCatalogueHref(String(programme.id)) as never);
                    }}
                    rowActionsLabel={t('business:catalogue.rowActions')}
                    rowActions={(programme): readonly MenuItem[] => [
                        {
                            key: 'catalogue',
                            label: t('business:programme.openCatalogue'),
                            icon: CATALOGUE_ROW_ICONS.view,
                            testID: `corporate-programme-${String(programme.id)}-open-catalogue`,
                            onSelect: () => {
                                router.push(corporateCatalogueHref(String(programme.id)) as never);
                            },
                        },
                        {
                            key: 'quotation',
                            label: t('business:programme.requestQuotation'),
                            icon: 'fileText',
                            testID: `corporate-programme-${String(programme.id)}-request-quotation`,
                            onSelect: () => {
                                router.push(
                                    `/corporate/quotations/new?programme=${String(programme.id)}` as never,
                                );
                            },
                        },
                    ]}
                />
            )}

            <Stack space="sm" testID="corporate-quotation-summary">
                <WorkbenchSectionHeading
                    title={t('business:dashboard.quotationsTitle')}
                    aside={
                        <Button
                            testID="corporate-open-quotations"
                            size="sm"
                            variant="ghost"
                            label={t('business:dashboard.openQuotations')}
                            onPress={() => {
                                router.push(CORPORATE_QUOTATIONS_HREF as never);
                            }}
                        />
                    }
                />
                {quotations.isPending ? (
                    <TableSkeleton testID="corporate-quotations-loading" />
                ) : quotationsFailure !== null ? (
                    <ErrorState
                        testID="corporate-quotations-error"
                        title={t('business:quotations.loadErrorTitle')}
                        failure={quotationsFailure}
                        onRetry={() => {
                            void quotations.refetch();
                        }}
                        retrying={quotations.isFetching}
                    />
                ) : recent.length === 0 ? (
                    <EmptyState
                        testID="corporate-quotations-empty"
                        title={t('business:dashboard.noQuotationsTitle')}
                        body={t('business:dashboard.noQuotationsBody')}
                    />
                ) : (
                    <RecentQuotations
                        rows={recent}
                        programmes={visible}
                        onOpen={() => {
                            router.push(CORPORATE_QUOTATIONS_HREF as never);
                        }}
                    />
                )}
            </Stack>
        </Cascade>
    );
}

/**
 * One programme's line and tier counts, read per row because `listCatalogue` is scoped to a
 * programme by the contract — there is no "everything I can buy" call. Shares its query key with
 * the catalogue screen, so opening the programme next costs nothing.
 */
function ProgrammeLineCount({ programme }: { readonly programme: CorporateProgramme }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const catalogue = useCorporateCatalogueQuery({ programmeId: programme.id });
    const items = catalogue.data?.items ?? [];
    const tiers = items.reduce((running, item) => running + item.volumeTiers.length, 0);

    return (
        <Text
            variant="mono"
            tone={catalogue.isPending ? 'secondary' : 'primary'}
            testID={`corporate-programme-${String(programme.id)}-tiers`}
        >
            {catalogue.isPending
                ? '…'
                : t('business:programme.linesTiers', {
                      lines: formatter.formatNumber(items.length),
                      tiers: formatter.formatNumber(tiers),
                  })}
        </Text>
    );
}

function RecentQuotations({
    rows,
    programmes,
    onOpen,
}: {
    readonly rows: readonly Quotation[];
    readonly programmes: readonly CorporateProgramme[];
    readonly onOpen: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const columns: readonly CatalogueColumn<Quotation>[] = [
        {
            key: 'reference',
            role: 'title',
            label: t('business:quotations.columnReference'),
            width: 160,
            priority: 100,
            value: (row) => row.reference,
            render: (row) => (
                <Text variant="mono" className="font-semibold">
                    {row.reference}
                </Text>
            ),
        },
        {
            key: 'state',
            role: 'status',
            label: t('business:quotations.columnState'),
            width: 170,
            priority: 90,
            value: (row) => t(quotationStateKey(row.state)),
            render: (row) => (
                <Badge tone={quotationTone(row.state)} label={t(quotationStateKey(row.state))} />
            ),
        },
        {
            key: 'programme',
            role: 'meta',
            label: t('business:quotations.columnProgramme'),
            width: 200,
            grow: true,
            priority: 70,
            value: (row) =>
                programmes.find((programme) => programme.id === row.programmeId)?.name ??
                String(row.programmeId),
        },
        {
            key: 'lines',
            role: 'meta',
            label: t('business:quotations.columnLines'),
            width: 80,
            align: 'end',
            priority: 60,
            value: (row) => formatter.formatNumber(row.lines.length),
        },
        {
            key: 'raised',
            role: 'meta',
            label: t('business:quotations.columnRaised'),
            width: 130,
            priority: 65,
            value: (row) => formatter.formatDate(row.requestedAt, { dateStyle: 'medium' }),
        },
    ];

    return (
        <CatalogueList<Quotation>
            testID="corporate-quotations"
            label={t('business:dashboard.quotationsTitle')}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.reference}
            density="sm"
            onRowPress={onOpen}
            rowActionsLabel={t('business:catalogue.rowActions')}
        />
    );
}
