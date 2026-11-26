import {
    Badge,
    Button,
    Cascade,
    DATA_TABLE_ROW_ICONS,
    DataTable,
    EmptyState,
    ErrorState,
    Icon,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { DataTableColumn, MenuItem, StatusStep } from '@healthy360/design-system';
import type { Quotation, QuotationState } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
    toFailure,
    useCorporateProgrammesQuery,
    useQuotationsQuery,
} from '../../../data/business-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { ColumnPicker } from '../../kitchen-admin/catalogue/column-picker.tsx';
import { LensBar } from '../../kitchen-admin/catalogue/lens-bar.tsx';
import type { LensFigure, LensTone } from '../../kitchen-admin/catalogue/lens-bar.tsx';
import { RecordViewPage } from '../../kitchen-admin/catalogue/record-view-page.tsx';
import { SheetFacts } from '../../kitchen-admin/catalogue/record-sheet.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../../kitchen-admin/catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../../kitchen-admin/catalogue/use-column-controls.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { AcceptQuotationDialog, DeclineQuotationDialog } from '../accept-quotation-dialog.tsx';
import { CORPORATE_HOME_HREF, CORPORATE_NEW_QUOTATION_HREF } from '../corporate-chrome.tsx';
import { contractPriceTestId, quotationStateKey, quotationTone } from '../format.ts';

/**
 * `/corporate/quotations` — every quotation this account has raised. From the corporate canvas's
 * Quotations board (2026-11-10), in the kitchen's list look (`kitchen-admin/screens/
 * quotations-screen.tsx` is the twin on the selling side):
 *
 * - **The lens:** All / Open / Awaiting your decision / Closed, the mix bar under them, New
 *   quotation at their end, then the reference search, the filter in force, "N of M" and Show
 *   columns.
 * - **The table:** Reference, State (filtered from its header), Lines, Quoted total and Expires. A
 *   row opens the quotation; its menu has View and, while priced, Accept and schedule and Decline.
 * - **The quotation** opens as the record sheet: its progress, four figures, the lines and their
 *   total across the window, what you asked for, and — once decided — the order or the reason.
 *   Accept and schedule and Decline sit at its foot while it waits on you.
 *
 * ## A submitted quotation carries no price, and the screen shows that rather than hiding it
 *
 * `QuotationLine.quotedUnitPrice` is `null` until an account manager has priced the line. A
 * submitted request therefore says "Awaiting price" against every line; a quoted one shows the
 * figures. The prototype never invents a total for something nobody has priced.
 *
 * ## Accept places the order
 *
 * Accept opens the delivery dialog (`../accept-quotation-dialog.tsx`); the accepted quotation then
 * names its order. Both decisions send the version on screen, so a quotation re-priced meanwhile is
 * refused rather than accepted unseen.
 */

const FILTERS = ['all', 'open', 'quoted', 'closed'] as const;
type FilterKey = (typeof FILTERS)[number];

const FILTER_STATES: Readonly<Record<FilterKey, readonly QuotationState[]>> = {
    all: [],
    open: ['draft', 'submitted', 'in_review'],
    quoted: ['quoted'],
    closed: ['accepted', 'declined', 'expired'],
};

const FILTER_TONES: Readonly<Record<Exclude<FilterKey, 'all'>, LensTone>> = {
    open: 'info',
    quoted: 'warning',
    closed: 'neutral',
};

/** The states the State header offers, in the order a quotation moves through them. */
const STATE_ORDER: readonly QuotationState[] = [
    'draft',
    'submitted',
    'in_review',
    'quoted',
    'accepted',
    'declined',
    'expired',
];

function isFilterKey(value: string | undefined): value is FilterKey {
    return (FILTERS as readonly string[]).includes(value ?? '');
}

function inFilter(row: Quotation, filter: FilterKey): boolean {
    return filter === 'all' || FILTER_STATES[filter].includes(row.state);
}

export interface QuotationsScreenProps {
    /** The group to open on — `?state=` on the route. Anything unrecognised opens on All. */
    readonly initialFilter?: string | undefined;
    /** A quotation to open at once, by its reference — `?open=` on the route. */
    readonly initialOpen?: string | undefined;
}

export function QuotationsScreen({ initialFilter, initialOpen }: QuotationsScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const [filter, setFilter] = useState<FilterKey>(
        isFilterKey(initialFilter) ? initialFilter : 'all',
    );
    const [search, setSearch] = useState('');
    const [viewingRef, setViewingRef] = useState<string | null>(initialOpen ?? null);

    const quotations = useQuotationsQuery();
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

    const all = useMemo<readonly Quotation[]>(
        () => quotations.data?.items ?? [],
        [quotations.data],
    );
    const pending = quotations.isPending;
    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return all.filter(
            (row) =>
                inFilter(row, filter) &&
                (needle === '' || row.reference.toLowerCase().includes(needle)),
        );
    }, [all, filter, search]);

    const programmeOf = (row: Quotation) =>
        programmes.data?.find((programme) => programme.id === row.programmeId);
    const programmeName = (row: Quotation): string =>
        programmeOf(row)?.name ?? String(row.programmeId);
    const totalText = (row: Quotation): string =>
        row.requestedTotal === null
            ? t('business:quotations.awaitingPriceShort')
            : formatMoney(formatter, row.requestedTotal);
    const dateText = (value: string | null): string =>
        value === null ? '—' : formatter.formatDate(value, { dateStyle: 'medium' });
    const scheduleText = (row: Quotation): string =>
        row.recurring ? t('business:quotations.recurring') : t('business:quotations.oneOff');

    const columns: readonly ControlledColumn<Quotation, DataTableColumn<Quotation>>[] = [
        {
            key: 'reference',
            role: 'title',
            label: t('business:quotations.columnReference'),
            width: 200,
            min: 160,
            grow: true,
            priority: 100,
            value: (row) => row.reference,
            sort: (left, right, direction) =>
                compareText(left.reference, right.reference, direction),
            render: (row) => (
                <Text
                    variant="bodyStrong"
                    className="tabular-nums"
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
            width: 210,
            priority: 90,
            sort: false,
            value: (row) => t(quotationStateKey(row.state)),
            filter: {
                values: (list) =>
                    STATE_ORDER.filter((state) => list.some((row) => row.state === state)).map(
                        (state) => ({ key: state, label: t(quotationStateKey(state)) }),
                    ),
                match: (row, value) => row.state === value,
            },
            render: (row) => (
                <Badge
                    testID={`quotation-${row.reference}-state`}
                    tone={quotationTone(row.state)}
                    label={t(quotationStateKey(row.state))}
                />
            ),
        },
        {
            key: 'lines',
            role: 'meta',
            label: t('business:quotations.columnLines'),
            width: 80,
            priority: 60,
            sort: false,
            value: (row) => formatter.formatNumber(row.lines.length),
            render: (row) => (
                <Text tone="secondary" className="tabular-nums">
                    {formatter.formatNumber(row.lines.length)}
                </Text>
            ),
        },
        {
            key: 'total',
            role: 'metric',
            label: t('business:quotations.columnTotal'),
            width: 150,
            priority: 85,
            value: totalText,
            sort: (left, right, direction) =>
                compareNumber(
                    left.requestedTotal?.amount ?? -1,
                    right.requestedTotal?.amount ?? -1,
                    direction,
                ),
            render: (row) =>
                row.requestedTotal === null ? (
                    <Text tone="secondary">{totalText(row)}</Text>
                ) : (
                    <Text
                        variant="bodyStrong"
                        className="tabular-nums"
                        testID={contractPriceTestId(`quoted-total-${row.reference}`)}
                    >
                        {totalText(row)}
                    </Text>
                ),
        },
        {
            key: 'expires',
            role: 'meta',
            label: t('business:quotations.columnExpires'),
            width: 140,
            priority: 75,
            sort: false,
            value: (row) => dateText(row.expiresAt),
            render: (row) => (
                <Text
                    tone={row.state === 'quoted' ? 'primary' : 'secondary'}
                    className="tabular-nums"
                >
                    {dateText(row.expiresAt)}
                </Text>
            ),
        },
        {
            key: 'programme',
            role: 'meta',
            label: t('business:quotations.columnProgramme'),
            width: 200,
            priority: 40,
            value: programmeName,
        },
        {
            key: 'raised',
            role: 'meta',
            label: t('business:quotations.columnRaised'),
            width: 130,
            priority: 35,
            value: (row) => dateText(row.requestedAt),
            sort: (left, right, direction) =>
                compareText(left.requestedAt, right.requestedAt, direction),
        },
        {
            key: 'schedule',
            role: 'meta',
            label: t('business:quotations.columnSchedule'),
            width: 150,
            priority: 30,
            value: scheduleText,
        },
        {
            key: 'delivery',
            role: 'meta',
            label: t('business:quotations.columnDelivery'),
            width: 140,
            priority: 25,
            value: (row) => dateText(row.requestedDeliveryDate),
        },
    ];

    const controls = useColumnControls(rows, columns, 'corporate-quotations', {
        picker: { defaults: ['reference', 'state', 'lines', 'total', 'expires'] },
    });
    const listFailure = toFailure(quotations.error);
    const unfiltered = filter === 'all' && search === '' && !controls.filtered;
    const clearFilters = () => {
        setFilter('all');
        setSearch('');
        controls.clearFilters();
    };

    const listed = all.find((row) => row.reference === viewingRef) ?? null;
    const viewing =
        decided !== null && decided.reference === viewingRef && listed?.state === 'quoted'
            ? decided
            : listed;
    // An `?open=` reference that is not on the list draws nothing: `viewing` is `null`.

    const count = (key: FilterKey) => all.filter((row) => inFilter(row, key)).length;
    const figures = FILTERS.map((value, index): LensFigure => ({
        key: value,
        label:
            value === 'all'
                ? t('business:quotations.statAll')
                : value === 'quoted'
                  ? t('business:quotations.statQuoted')
                  : t(`business:quotations.filters.${value}`),
        value: pending ? null : count(value),
        ...(value === 'all' ? {} : { tone: FILTER_TONES[value] }),
        separated: index === 1,
        active: filter === value,
        onPress: () => {
            setFilter(value);
        },
    }));
    const filterToken =
        filter === 'all'
            ? null
            : t('business:quotations.groupToken', {
                  group:
                      filter === 'quoted'
                          ? t('business:quotations.statQuoted')
                          : t(`business:quotations.filters.${filter}`),
              });
    const joined = !pending && listFailure === null && controls.rows.length > 0;

    const dialog =
        deciding === null ? null : deciding.kind === 'accept' ? (
            <AcceptQuotationDialog
                quotation={deciding.quotation}
                kitchenId={programmeOf(deciding.quotation)?.kitchenIds[0] ?? null}
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

    return (
        <Cascade space="md" testID="quotations-screen">
            <View className={joined ? 'z-10' : 'z-10 gap-4'}>
                <LensBar
                    testID="quotations-toolbar"
                    layout="split"
                    joined={joined}
                    label={t('kitchen:lens.label')}
                    figures={figures}
                    {...(pending
                        ? {}
                        : {
                              mix: (['open', 'quoted', 'closed'] as const).map((value) => ({
                                  key: value,
                                  value: count(value),
                                  tone: FILTER_TONES[value],
                                  dimmed: filter !== 'all' && filter !== value,
                              })),
                              mixLabel: t('business:quotations.mixLabel', {
                                  open: count('open'),
                                  quoted: count('quoted'),
                                  closed: count('closed'),
                              }),
                          })}
                    actions={
                        <Button
                            testID="quotations-new"
                            size="sm"
                            label={t('business:nav.newQuotation')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={() => {
                                router.push(CORPORATE_NEW_QUOTATION_HREF as never);
                            }}
                        />
                    }
                    search={search}
                    onSearchChange={setSearch}
                    searchLabel={t('business:quotations.searchLabel')}
                    searchPlaceholder={t('business:quotations.searchPlaceholder')}
                    tokens={
                        filterToken === null
                            ? []
                            : [
                                  {
                                      key: 'group',
                                      label: filterToken,
                                      removeLabel: t('kitchen:toolbar.removeFilter', {
                                          filter: filterToken,
                                      }),
                                      onRemove: () => {
                                          setFilter('all');
                                      },
                                  },
                              ]
                    }
                    result={
                        pending
                            ? null
                            : t('kitchen:lens.result', {
                                  shown: controls.rows.length,
                                  total: all.length,
                              })
                    }
                    clearLabel={t('kitchen:lens.clear')}
                    {...(unfiltered ? {} : { onClear: clearFilters })}
                    trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
                />

                {pending ? (
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
                    <DataTable<Quotation>
                        testID="quotations-list"
                        joined
                        label={t('business:quotations.caption')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => row.reference}
                        density="sm"
                        onRowPress={(row) => {
                            setViewingRef(row.reference);
                        }}
                        rowActionsLabel={t('business:catalogue.rowActions')}
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('business:quotations.view'),
                                icon: DATA_TABLE_ROW_ICONS.view,
                                testID: `quotation-${row.reference}-view`,
                                onSelect: () => {
                                    setViewingRef(row.reference);
                                },
                            },
                            ...(row.state === 'quoted'
                                ? [
                                      {
                                          key: 'accept',
                                          label: t('business:quotations.acceptSchedule'),
                                          icon: 'check' as const,
                                          testID: `quotation-${row.reference}-accept`,
                                          onSelect: () => {
                                              setDeciding({ kind: 'accept', quotation: row });
                                          },
                                      },
                                      {
                                          key: 'decline',
                                          label: t('business:overview.decline'),
                                          icon: 'close' as const,
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
            </View>

            {viewing === null ? null : (
                <QuotationSheet
                    quotation={viewing}
                    programmeName={programmeName(viewing)}
                    kitchenId={programmeOf(viewing)?.kitchenIds[0] ?? null}
                    onClose={() => {
                        setViewingRef(null);
                    }}
                    onAccept={() => {
                        setDeciding({ kind: 'accept', quotation: viewing });
                    }}
                    onDecline={() => {
                        setDeciding({ kind: 'decline', quotation: viewing });
                    }}
                />
            )}
            {dialog}
        </Cascade>
    );
}

/** The quotation's progress: asked, priced, then what became of it. */
export function quotationSteps(
    quotation: Quotation,
    t: TFunction,
    date: (value: string) => string,
): readonly StatusStep[] {
    const at = (value: string | null) => (value === null ? null : date(value));
    const asked: StatusStep = {
        key: 'asked',
        label: t('business:sheet.stepAsked'),
        at: at(quotation.requestedAt),
        state: 'done',
    };
    const priced: StatusStep = {
        key: 'priced',
        label: t('business:sheet.stepPriced'),
        at: at(quotation.quotedAt),
        state: 'done',
    };
    switch (quotation.state) {
        case 'draft':
        case 'submitted':
        case 'in_review':
            return [
                asked,
                {
                    key: 'priced',
                    label: t('business:sheet.stepPricing'),
                    at: null,
                    state: 'partial',
                },
                {
                    key: 'decision',
                    label: t('business:sheet.stepDecision'),
                    at: null,
                    state: 'pending',
                },
            ];
        case 'quoted':
            return [
                asked,
                priced,
                {
                    key: 'decision',
                    label: t('business:sheet.stepDecision'),
                    at:
                        quotation.expiresAt === null
                            ? null
                            : t('business:sheet.decideBy', { date: date(quotation.expiresAt) }),
                    state: 'partial',
                },
            ];
        case 'accepted':
        case 'declined':
            return [
                asked,
                priced,
                {
                    key: 'decision',
                    label: t(quotationStateKey(quotation.state)),
                    at: at(quotation.decidedAt),
                    state: 'done',
                },
            ];
        case 'expired':
            return [
                asked,
                priced,
                {
                    key: 'decision',
                    label: t(quotationStateKey('expired')),
                    at: at(quotation.expiresAt),
                    state: 'pending',
                },
            ];
    }
}

/**
 * One quotation as the record sheet — the canvas's Quotation pop-up, redrawn without the green band
 * (2026-11-22).
 */
function QuotationSheet({
    quotation,
    programmeName,
    kitchenId,
    onClose,
    onAccept,
    onDecline,
}: {
    readonly quotation: Quotation;
    readonly programmeName: string;
    readonly kitchenId: Parameters<typeof useKitchenQuery>[0];
    readonly onClose: () => void;
    readonly onAccept: () => void;
    readonly onDecline: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const kitchen = useKitchenQuery(kitchenId);
    const date = (value: string) => formatter.formatDate(value, { dateStyle: 'medium' });
    const dateText = (value: string | null) => (value === null ? '—' : date(value));
    const testId = `quotation-${quotation.reference}`;
    const quoted = quotation.state === 'quoted';
    const where = [programmeName, kitchen.data?.name].filter(
        (part): part is string => part !== undefined && part !== '',
    );
    const contact =
        quotation.contactName === null
            ? null
            : quotation.contactEmail === null
              ? quotation.contactName
              : `${quotation.contactName} · ${quotation.contactEmail}`;
    const orders =
        quotation.orders.length > 0
            ? quotation.orders
                  .map((order) => order.orderNumber)
                  .filter((number): number is string => number !== null)
                  .join(t('business:common.listSeparator'))
            : (quotation.orderNumber ?? '');

    const decision =
        quotation.state === 'accepted'
            ? {
                  title: t('business:sheet.orderTitle'),
                  facts: [
                      {
                          key: 'decided',
                          label: t('business:sheet.acceptedOn'),
                          value: dateText(quotation.decidedAt),
                      },
                      ...(orders === ''
                          ? []
                          : [
                                {
                                    key: 'order',
                                    label: t('business:quotations.columnOrder'),
                                    value: orders,
                                },
                            ]),
                  ],
              }
            : quotation.state === 'declined'
              ? {
                    title: t('business:sheet.decisionTitle'),
                    facts: [
                        {
                            key: 'decided',
                            label: t('business:sheet.declinedOn'),
                            value: dateText(quotation.decidedAt),
                        },
                        {
                            key: 'reason',
                            label: t('business:sheet.whyDeclined'),
                            value: quotation.declineReason ?? t('business:sheet.noReason'),
                        },
                    ],
                }
              : null;

    return (
        <RecordViewPage
            look="sheet"
            testID={testId}
            onBack={onClose}
            eyebrow={t('business:quotations.viewKind')}
            title={quotation.reference}
            kind={
                quotation.recurring
                    ? t('business:quotations.recurring')
                    : t('business:quotations.oneOff')
            }
            status={{
                label: t(quotationStateKey(quotation.state)),
                tone: quotationTone(quotation.state),
            }}
            statusLines={where.length === 0 ? [] : [where.join(' · ')]}
            steps={{
                label: t('business:sheet.progress'),
                steps: quotationSteps(quotation, t, date),
            }}
            figureKeys={['total', 'raised', 'delivery', 'expires']}
            figureTones={quoted ? { expires: 'warning' } : {}}
            fields={[
                {
                    key: 'total',
                    label:
                        quotation.state === 'accepted'
                            ? t('business:sheet.acceptedTotal')
                            : t('business:quotations.columnTotal'),
                    value:
                        quotation.requestedTotal === null
                            ? t('business:quotations.awaitingPriceShort')
                            : formatMoney(formatter, quotation.requestedTotal),
                },
                {
                    key: 'raised',
                    label: t('business:quotations.columnRaised'),
                    value: dateText(quotation.requestedAt),
                    mono: true,
                },
                {
                    key: 'delivery',
                    label: t('business:quotations.columnDelivery'),
                    value: dateText(quotation.requestedDeliveryDate),
                    mono: true,
                },
                {
                    key: 'expires',
                    label: t('business:quotations.columnExpires'),
                    value: dateText(quotation.expiresAt),
                    mono: true,
                },
            ]}
            linesWide
            headIcon="fileText"
            linesCount={t('business:overview.lines', { count: quotation.lines.length })}
            linesTitle={t('business:quotations.linesTitle')}
            lines={<QuotationLines quotation={quotation} />}
            sections={[
                {
                    key: 'request',
                    title: t('business:sheet.requestTitle'),
                    content: (
                        <SheetFacts
                            testID={`${testId}-request`}
                            facts={[
                                {
                                    key: 'programme',
                                    label: t('business:quotations.columnProgramme'),
                                    value: programmeName,
                                },
                                {
                                    key: 'schedule',
                                    label: t('business:quotations.columnSchedule'),
                                    value: quotation.recurring
                                        ? t('business:quotations.recurring')
                                        : t('business:quotations.oneOff'),
                                },
                                {
                                    key: 'delivery',
                                    label: t('business:quotations.columnDelivery'),
                                    value: dateText(quotation.requestedDeliveryDate),
                                    empty: quotation.requestedDeliveryDate === null,
                                },
                                {
                                    key: 'contact',
                                    label: t('business:sheet.replyTo'),
                                    value: contact ?? '—',
                                    empty: contact === null,
                                },
                                {
                                    key: 'note',
                                    label: t('business:quotations.columnNote'),
                                    value: quotation.note ?? '—',
                                    empty: quotation.note === null,
                                },
                            ]}
                        />
                    ),
                },
            ]}
            rail={
                decision === null
                    ? []
                    : [
                          {
                              key: 'decision',
                              title: decision.title,
                              content: (
                                  <SheetFacts
                                      testID={`${testId}-decision`}
                                      facts={decision.facts}
                                  />
                              ),
                          },
                      ]
            }
            {...(quoted
                ? {
                      primaryAction: {
                          testID: `${testId}-accept`,
                          label: t('business:quotations.acceptSchedule'),
                          icon: 'check' as const,
                          onPress: onAccept,
                      },
                      actions: [
                          {
                              key: 'decline',
                              label: t('business:overview.decline'),
                              icon: 'close' as const,
                              tone: 'danger' as const,
                              testID: `${testId}-decline`,
                              onSelect: onDecline,
                          },
                      ],
                  }
                : {})}
        />
    );
}

/** The request's lines with the account manager's price where there is one, and their total. */
function QuotationLines({ quotation }: { readonly quotation: Quotation }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const testId = `quotation-${quotation.reference}`;
    const priced = quotation.lines.some((line) => line.quotedUnitPrice !== null);

    const columns: readonly DataTableColumn<Quotation['lines'][number]>[] = [
        {
            key: 'name',
            role: 'title',
            label: t('business:sheet.columnLine'),
            width: 240,
            grow: true,
            priority: 100,
            value: (line) => line.name,
            render: (line) => (
                <Text variant="bodyStrong" numberOfLines={1}>
                    {line.name}
                </Text>
            ),
        },
        {
            key: 'quantity',
            role: 'meta',
            label: t('business:quotations.columnQuantity'),
            width: 110,
            priority: 90,
            value: (line) => formatter.formatNumber(line.quantity),
        },
        {
            key: 'unit',
            role: 'meta',
            label: t('business:sheet.columnUnitPrice'),
            width: 130,
            priority: 85,
            value: (line) =>
                line.quotedUnitPrice === null
                    ? t('business:quotations.awaitingPriceShort')
                    : formatMoney(formatter, line.quotedUnitPrice),
            render: (line) =>
                line.quotedUnitPrice === null ? (
                    <Text tone="secondary">{t('business:quotations.awaitingPriceShort')}</Text>
                ) : (
                    <Text className="tabular-nums">
                        {formatMoney(formatter, line.quotedUnitPrice)}
                    </Text>
                ),
        },
        {
            key: 'total',
            role: 'metric',
            label: t('business:sheet.columnLineTotal'),
            width: 130,
            priority: 95,
            value: (line) =>
                line.quotedTotal === null ? '—' : formatMoney(formatter, line.quotedTotal),
            render: (line) =>
                line.quotedTotal === null ? (
                    <Text
                        tone="secondary"
                        testID={`${testId}-line-${line.catalogueItemId}-unpriced`}
                    >
                        —
                    </Text>
                ) : (
                    <Text
                        variant="bodyStrong"
                        className="tabular-nums"
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
        <View className="overflow-hidden rounded-[14px] border border-stroke-subtle">
            <DataTable
                testID={`${testId}-line-table`}
                label={t('business:quotations.linesTitle')}
                columns={columns}
                rows={quotation.lines}
                rowKey={(line) => line.catalogueItemId}
                density="sm"
                rowActionsLabel={t('business:catalogue.rowActions')}
                rowEntrance={false}
                joined
            />
            <View
                testID={`${testId}-total`}
                className="min-h-[46px] flex-row items-center justify-between gap-3 border-t border-stroke-subtle bg-surface-sunken px-4"
            >
                <Text variant="bodyStrong">
                    {quotation.state === 'accepted'
                        ? t('business:sheet.acceptedTotal')
                        : t('business:quotations.columnTotal')}
                </Text>
                {quotation.requestedTotal === null ? (
                    <Text tone="secondary">
                        {priced ? '—' : t('business:quotations.awaitingPriceShort')}
                    </Text>
                ) : (
                    <Text
                        className="font-display text-xl font-bold tabular-nums text-content-on-brand-subtle"
                        testID={contractPriceTestId(`quoted-total-${quotation.reference}-view`)}
                    >
                        {formatMoney(formatter, quotation.requestedTotal)}
                    </Text>
                )}
            </View>
        </View>
    );
}
