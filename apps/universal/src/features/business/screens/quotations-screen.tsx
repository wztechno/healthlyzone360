import {
    Badge,
    Button,
    Callout,
    Cascade,
    EmptyState,
    ErrorState,
    Inline,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import type { Quotation, QuotationFilter, QuotationState } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useCorporateProgrammesQuery,
    useQuotationsQuery,
} from '../../../data/business-hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../../kitchen-admin/catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../../kitchen-admin/catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../../kitchen-admin/catalogue/catalogue-column-spec.ts';
import { CatalogueStatCards } from '../../kitchen-admin/catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../../kitchen-admin/catalogue/catalogue-toolbar.tsx';
import { ColumnPicker } from '../../kitchen-admin/catalogue/column-picker.tsx';
import { RecordViewPage } from '../../kitchen-admin/catalogue/record-view-page.tsx';
import {
    compareText,
    useColumnControls,
} from '../../kitchen-admin/catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../../kitchen-admin/catalogue/use-column-controls.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { AcceptQuotationDialog, DeclineQuotationDialog } from '../accept-quotation-dialog.tsx';
import { CORPORATE_HOME_HREF } from '../corporate-chrome.tsx';
import { contractPriceTestId, quotationStateKey, quotationTone } from '../format.ts';

/**
 * `/corporate/quotations` — every quotation this account has raised, as an admin list
 * (`kitchen-admin/screens/quotations-screen.tsx` is the twin on the selling side): the summary
 * cards, one toolbar row whose segments are the request's state filter, the table, and a record
 * page that opens in place of the table so Back keeps the filter.
 *
 * ## A submitted quotation carries no price, and the screen shows that rather than hiding it
 *
 * `QuotationLine.quotedUnitPrice` is `null` until an account manager has priced the line
 * (`contracts/business.ts`). A submitted request therefore renders "awaiting a price" against every
 * line, and a `quoted` one renders the figures. That distinction is the whole state machine made
 * visible: the prototype never invents a total for something nobody has priced.
 *
 * ## Accept places the order; decline says why; PDF export is not offered
 *
 * Accept opens a dialog for the delivery — day, address, window — because accepting places the
 * order at the quoted prices (`accept-quotation-dialog.tsx`); the accepted quotation then names its
 * order. Decline asks for the reason the kitchen will read. Both send the version on screen, so a
 * quotation the kitchen re-priced meanwhile is refused rather than accepted unseen. There is no
 * document endpoint, so `quotationExport` is unavailable (`src/features/availability.ts`) and the
 * download control is absent — a button that could only ever explain its own absence is worse than
 * no button.
 */

const FILTERS = ['all', 'open', 'quoted', 'closed'] as const;
type FilterKey = (typeof FILTERS)[number];

const FILTER_STATES: Readonly<Record<FilterKey, readonly QuotationState[]>> = {
    all: [],
    open: ['draft', 'submitted', 'in_review'],
    quoted: ['quoted'],
    closed: ['accepted', 'declined', 'expired'],
};

function isFilterKey(value: string | undefined): value is FilterKey {
    return (FILTERS as readonly string[]).includes(value ?? '');
}

export interface QuotationsScreenProps {
    /** The segment to open on — `?state=` on the route. Anything unrecognised opens on All. */
    readonly initialFilter?: string | undefined;
}

export function QuotationsScreen({ initialFilter }: QuotationsScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const [filter, setFilter] = useState<FilterKey>(
        isFilterKey(initialFilter) ? initialFilter : 'all',
    );
    const [search, setSearch] = useState('');
    const [viewingId, setViewingId] = useState<string | null>(null);
    const states = FILTER_STATES[filter];
    const request: QuotationFilter = states.length === 0 ? {} : { states };

    const quotations = useQuotationsQuery(request);
    // The cards count every quotation whatever the segment says — the same unfiltered read the
    // rail's badge counts, so the two numbers cannot disagree.
    const everything = useQuotationsQuery();
    const programmes = useCorporateProgrammesQuery();
    /** The decision being made, in its dialog; `null` when none is open. */
    const [deciding, setDeciding] = useState<{
        readonly kind: 'accept' | 'decline';
        readonly quotation: Quotation;
    } | null>(null);
    /**
     * The quotation as the decision answered it. The list refetches behind the dialog and can
     * take a moment; the record shows the server's answer — accepted, with its order — at once.
     */
    const [decided, setDecided] = useState<Quotation | null>(null);
    const kitchenOf = (row: Quotation) =>
        programmes.data?.find((programme) => programme.id === row.programmeId)?.kitchenIds[0] ??
        null;
    const dialog =
        deciding === null ? null : deciding.kind === 'accept' ? (
            <AcceptQuotationDialog
                quotation={deciding.quotation}
                kitchenId={kitchenOf(deciding.quotation)}
                onClose={() => {
                    setDeciding(null);
                }}
                onAccepted={(accepted) => {
                    setDecided(accepted);
                    setDeciding(null);
                }}
            />
        ) : (
            <DeclineQuotationDialog
                quotation={deciding.quotation}
                onClose={() => {
                    setDeciding(null);
                }}
                onDeclined={(declined) => {
                    setDecided(declined);
                    setDeciding(null);
                }}
            />
        );

    const loaded = quotations.data?.items;
    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return (loaded ?? []).filter(
            (row) => needle === '' || row.reference.toLowerCase().includes(needle),
        );
    }, [loaded, search]);
    const programmeName = (row: Quotation): string =>
        programmes.data?.find((programme) => programme.id === row.programmeId)?.name ??
        String(row.programmeId);
    const totalText = (row: Quotation): string =>
        row.requestedTotal === null
            ? t('business:quotations.awaitingPriceShort')
            : formatMoney(formatter, row.requestedTotal);
    const dateText = (value: string | null): string =>
        value === null ? '—' : formatter.formatDate(value, { dateStyle: 'medium' });

    const columns: readonly ControlledColumn<Quotation, CatalogueColumn<Quotation>>[] = [
        {
            key: 'reference',
            role: 'title',
            label: t('business:quotations.columnReference'),
            width: 160,
            priority: 100,
            value: (row) => row.reference,
            sort: (left, right, direction) =>
                compareText(left.reference, right.reference, direction),
            render: (row) => (
                <Text
                    variant="mono"
                    className="font-semibold"
                    testID={`quotation-${row.reference}-reference`}
                >
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
                <Badge
                    testID={`quotation-${row.reference}-state`}
                    tone={quotationTone(row.state)}
                    label={t(quotationStateKey(row.state))}
                />
            ),
        },
        {
            key: 'programme',
            role: 'meta',
            label: t('business:quotations.columnProgramme'),
            width: 200,
            grow: true,
            priority: 70,
            value: programmeName,
            filter: {
                values: (all) =>
                    [...new Set(all.map((row) => String(row.programmeId)))].map((id) => ({
                        key: id,
                        label:
                            programmes.data?.find((programme) => String(programme.id) === id)
                                ?.name ?? id,
                    })),
                match: (row, value) => String(row.programmeId) === value,
            },
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
            key: 'total',
            role: 'metric',
            label: t('business:quotations.columnTotal'),
            width: 150,
            align: 'end',
            priority: 85,
            value: totalText,
            render: (row) =>
                row.requestedTotal === null ? (
                    <Text tone="secondary">{totalText(row)}</Text>
                ) : (
                    <Text
                        variant="mono"
                        testID={contractPriceTestId(`quoted-total-${row.reference}`)}
                    >
                        {totalText(row)}
                    </Text>
                ),
        },
        {
            key: 'raised',
            role: 'meta',
            label: t('business:quotations.columnRaised'),
            width: 130,
            priority: 65,
            value: (row) => dateText(row.requestedAt),
            sort: (left, right, direction) =>
                compareText(left.requestedAt, right.requestedAt, direction),
        },
        {
            key: 'expires',
            role: 'meta',
            label: t('business:quotations.columnExpires'),
            width: 130,
            priority: 75,
            value: (row) => dateText(row.expiresAt),
            sort: (left, right, direction) =>
                compareText(left.expiresAt, right.expiresAt, direction),
        },
        {
            key: 'recurring',
            role: 'meta',
            label: t('business:quotations.columnSchedule'),
            width: 130,
            priority: 40,
            value: (row) =>
                row.recurring
                    ? t('business:quotations.recurring')
                    : t('business:quotations.oneOff'),
        },
    ];

    const controls = useColumnControls(rows, columns, 'quotations', {
        picker: { defaults: ['reference', 'state', 'programme', 'total', 'expires', 'lines'] },
    });
    const listFailure = toFailure(quotations.error);
    const unfiltered = filter === 'all' && search === '' && !controls.filtered;
    const clearFilters = () => {
        setFilter('all');
        setSearch('');
        controls.clearFilters();
    };

    const listed = (loaded ?? []).find((row) => String(row.id) === viewingId) ?? null;
    const viewing =
        decided !== null && String(decided.id) === viewingId && listed?.state === 'quoted'
            ? decided
            : listed;

    if (viewing !== null) {
        return (
            <RecordViewPage
                testID={`quotation-${viewing.reference}`}
                onBack={() => {
                    setViewingId(null);
                }}
                title={viewing.reference}
                kind={t('business:quotations.viewKind')}
                status={{
                    label: t(quotationStateKey(viewing.state)),
                    tone: quotationTone(viewing.state),
                }}
                fields={[
                    {
                        key: 'programme',
                        label: t('business:quotations.columnProgramme'),
                        value: programmeName(viewing),
                    },
                    {
                        key: 'raised',
                        label: t('business:quotations.columnRaised'),
                        value: dateText(viewing.requestedAt),
                        mono: true,
                    },
                    {
                        key: 'delivery',
                        label: t('business:quotations.columnDelivery'),
                        value: dateText(viewing.requestedDeliveryDate),
                        mono: true,
                    },
                    {
                        key: 'expires',
                        label: t('business:quotations.columnExpires'),
                        value: dateText(viewing.expiresAt),
                        mono: true,
                    },
                    {
                        key: 'schedule',
                        label: t('business:quotations.columnSchedule'),
                        value: viewing.recurring
                            ? t('business:quotations.recurring')
                            : t('business:quotations.oneOff'),
                    },
                    ...(viewing.contactName === null
                        ? []
                        : [
                              {
                                  key: 'contact',
                                  label: t('business:quotations.columnContact'),
                                  value:
                                      viewing.contactEmail === null
                                          ? viewing.contactName
                                          : `${viewing.contactName} · ${viewing.contactEmail}`,
                              },
                          ]),
                    ...(viewing.orderNumber === null
                        ? []
                        : [
                              {
                                  key: 'order',
                                  label: t('business:quotations.columnOrder'),
                                  value: viewing.orderNumber,
                                  mono: true,
                              },
                          ]),
                    ...(viewing.note === null
                        ? []
                        : [
                              {
                                  key: 'note',
                                  label: t('business:quotations.columnNote'),
                                  value: viewing.note,
                              },
                          ]),
                    ...(viewing.declineReason === null
                        ? []
                        : [
                              {
                                  key: 'declineReason',
                                  label: t('business:quotations.columnDeclineReason'),
                                  value: viewing.declineReason,
                              },
                          ]),
                ]}
                linesTitle={t('business:quotations.linesTitle')}
                lines={<QuotationLines quotation={viewing} />}
                statusContent={
                    <>
                        {viewing.requestedTotal === null ? (
                            <Text tone="secondary" variant="caption">
                                {t('business:quotations.awaitingPrice')}
                            </Text>
                        ) : (
                            <Text
                                variant="display"
                                testID={contractPriceTestId(
                                    `quoted-total-${viewing.reference}-view`,
                                )}
                            >
                                {formatMoney(formatter, viewing.requestedTotal)}
                            </Text>
                        )}
                        {viewing.state === 'accepted' && viewing.orderNumber !== null ? (
                            <Callout
                                testID={`quotation-${viewing.reference}-order-placed`}
                                tone="success"
                                icon="check"
                                role="status"
                                title={
                                    viewing.orders.length > 1
                                        ? t('business:accept.placedRunTitle', {
                                              count: viewing.orders.length,
                                              order: viewing.orderNumber,
                                          })
                                        : t('business:accept.placedTitle', {
                                              order: viewing.orderNumber,
                                          })
                                }
                                body={
                                    viewing.requestedDeliveryDate === null
                                        ? undefined
                                        : t('business:accept.placedBody', {
                                              date: dateText(viewing.requestedDeliveryDate),
                                          })
                                }
                            />
                        ) : null}
                        {viewing.state === 'quoted' ? (
                            <Inline space="xs" wrap>
                                <Button
                                    testID={`quotation-${viewing.reference}-decline`}
                                    size="sm"
                                    variant="secondary"
                                    label={t('business:quotations.decline')}
                                    onPress={() => {
                                        setDeciding({ kind: 'decline', quotation: viewing });
                                    }}
                                />
                            </Inline>
                        ) : null}
                        {dialog}
                    </>
                }
                primaryAction={
                    viewing.state === 'quoted'
                        ? {
                              testID: `quotation-${viewing.reference}-accept`,
                              label: t('business:quotations.accept'),
                              icon: 'circleCheck',
                              onPress: () => {
                                  setDeciding({ kind: 'accept', quotation: viewing });
                              },
                          }
                        : undefined
                }
            />
        );
    }

    const all = everything.data?.items ?? [];
    const count = (key: FilterKey) =>
        formatter.formatNumber(all.filter((row) => FILTER_STATES[key].includes(row.state)).length);
    const awaiting = all.filter((row) => row.state === 'quoted').length;

    return (
        <Cascade space="md" testID="quotations-screen">
            {listFailure !== null ? null : (
                <CatalogueStatCards
                    testID="quotations-stats"
                    pending={everything.isPending}
                    cards={[
                        {
                            key: 'all',
                            label: t('business:quotations.statAll'),
                            value: formatter.formatNumber(all.length),
                            mark: 'list',
                            tone: 'brand',
                            onPress: clearFilters,
                            accessibilityLabel: t('business:quotations.clearFilter'),
                        },
                        {
                            key: 'open',
                            label: t('business:quotations.statOpen'),
                            value: count('open'),
                            mark: 'clock',
                            onPress: () => {
                                setFilter('open');
                            },
                            accessibilityLabel: t('business:quotations.filters.open'),
                        },
                        {
                            key: 'quoted',
                            label: t('business:quotations.statQuoted'),
                            value: formatter.formatNumber(awaiting),
                            mark: 'circleCheck',
                            tone: awaiting === 0 ? 'default' : 'warning',
                            onPress: () => {
                                setFilter('quoted');
                            },
                            accessibilityLabel: t('business:quotations.filters.quoted'),
                        },
                        {
                            key: 'closed',
                            label: t('business:quotations.statClosed'),
                            value: count('closed'),
                            mark: 'archive',
                            onPress: () => {
                                setFilter('closed');
                            },
                            accessibilityLabel: t('business:quotations.filters.closed'),
                        },
                    ]}
                />
            )}

            <CatalogueToolbar<FilterKey>
                testID="quotations-toolbar"
                search={search}
                onSearchChange={setSearch}
                searchLabel={t('business:quotations.searchLabel')}
                searchPlaceholder={t('business:quotations.columnReference')}
                statusLabel={t('business:quotations.filterLabel')}
                statusSegments={FILTERS.map((value) => ({
                    value,
                    label: t(`business:quotations.filters.${value}`),
                }))}
                status={filter}
                onStatusChange={setFilter}
            >
                <ColumnPicker {...controls.picker} />
            </CatalogueToolbar>

            {quotations.isPending ? (
                <TableSkeleton testID="quotations-loading" />
            ) : listFailure !== null ? (
                <ErrorState
                    testID="quotations-error"
                    title={t('business:quotations.loadErrorTitle')}
                    failure={listFailure}
                    onRetry={() => {
                        void quotations.refetch();
                    }}
                    retrying={quotations.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="quotations-empty"
                    title={
                        unfiltered
                            ? t('business:quotations.emptyTitle')
                            : t('business:quotations.emptyFilteredTitle')
                    }
                    body={
                        unfiltered
                            ? t('business:quotations.emptyBody')
                            : t('business:quotations.emptyFilteredBody')
                    }
                    actions={
                        unfiltered ? (
                            <Button
                                testID="quotations-corporate-home"
                                size="sm"
                                variant="secondary"
                                label={t('business:quotations.home')}
                                onPress={() => {
                                    router.push(CORPORATE_HOME_HREF as never);
                                }}
                            />
                        ) : (
                            <Button
                                testID="quotations-clear-filter"
                                size="sm"
                                variant="secondary"
                                label={t('business:quotations.clearFilter')}
                                onPress={clearFilters}
                            />
                        )
                    }
                />
            ) : (
                <CatalogueList<Quotation>
                    testID="quotations-list"
                    label={t('business:quotations.caption')}
                    columns={controls.columns}
                    rows={controls.rows}
                    rowKey={(row) => row.reference}
                    density="sm"
                    onRowPress={(row) => {
                        setViewingId(String(row.id));
                    }}
                    rowActionsLabel={t('business:catalogue.rowActions')}
                    rowActions={(row): readonly MenuItem[] => [
                        {
                            key: 'view',
                            label: t('business:quotations.view'),
                            icon: CATALOGUE_ROW_ICONS.view,
                            testID: `quotation-${row.reference}-view`,
                            onSelect: () => {
                                setViewingId(String(row.id));
                            },
                        },
                        ...(row.state === 'quoted'
                            ? [
                                  {
                                      key: 'accept',
                                      label: t('business:quotations.accept'),
                                      icon: 'circleCheck' as const,
                                      testID: `quotation-${row.reference}-accept`,
                                      onSelect: () => {
                                          setDeciding({ kind: 'accept', quotation: row });
                                      },
                                  },
                                  {
                                      key: 'decline',
                                      label: t('business:quotations.decline'),
                                      icon: 'circleX' as const,
                                      tone: 'danger' as const,
                                      testID: `quotation-${row.reference}-decline`,
                                      onSelect: () => {
                                          setDeciding({ kind: 'decline', quotation: row });
                                      },
                                  },
                              ]
                            : []),
                    ]}
                />
            )}
            {dialog}
        </Cascade>
    );
}

/** The request's lines, with the account manager's price where there is one. */
function QuotationLines({ quotation }: { readonly quotation: Quotation }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const testId = `quotation-${quotation.reference}`;

    const columns: readonly CatalogueColumn<Quotation['lines'][number]>[] = [
        {
            key: 'name',
            role: 'title',
            label: t('business:catalogue.columnItem'),
            width: 200,
            grow: true,
            priority: 100,
            value: (line) => line.name,
        },
        {
            key: 'quantity',
            role: 'meta',
            label: t('business:quotations.columnQuantity'),
            width: 90,
            align: 'end',
            priority: 90,
            value: (line) => formatter.formatNumber(line.quantity),
        },
        {
            key: 'total',
            role: 'metric',
            label: t('business:quotations.columnLineTotal'),
            width: 150,
            align: 'end',
            priority: 95,
            value: (line) =>
                line.quotedTotal === null
                    ? t('business:quotations.awaitingPriceShort')
                    : formatMoney(formatter, line.quotedTotal),
            render: (line) =>
                line.quotedTotal === null ? (
                    <Text
                        tone="secondary"
                        testID={`${testId}-line-${line.catalogueItemId}-unpriced`}
                    >
                        {t('business:quotations.awaitingPriceShort')}
                    </Text>
                ) : (
                    <Text
                        variant="mono"
                        testID={contractPriceTestId(
                            `quoted-${quotation.reference}-${line.catalogueItemId}`,
                        )}
                    >
                        {formatMoney(formatter, line.quotedTotal)}
                    </Text>
                ),
        },
    ];

    return (
        <CatalogueList
            testID={`${testId}-line-table`}
            label={t('business:quotations.linesTitle')}
            columns={columns}
            rows={quotation.lines}
            rowKey={(line) => line.catalogueItemId}
            density="sm"
            rowActionsLabel={t('business:catalogue.rowActions')}
            rowEntrance={false}
        />
    );
}
