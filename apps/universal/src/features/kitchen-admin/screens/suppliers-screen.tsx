import type { Supplier } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    Icon,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useSuppliersQuery } from '../../../data/kitchen-ops-hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { LensBar, LensScope } from '../catalogue/lens-bar.tsx';
import type { LensFigure, LensScopeOption } from '../catalogue/lens-bar.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn, SortDirection } from '../catalogue/use-column-controls.tsx';
import { INVENTORY_MANAGE_PERMISSION, INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { supplierRowTestId } from '../ops-format.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import {
    useListMemory,
    useRememberedFilter,
    useRememberedOpened,
    useRememberedQuery,
} from '../list-memory.ts';
import { useViewedRecord } from '../use-viewed-record.ts';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';

/**
 * `/kitchen/suppliers` — who this kitchen buys from (SUP1), on the Catalogue list (Operations
 * design, `suppliers`).
 *
 * ```
 * (All suppliers 14) │ ● Active 12  ● Archived 2                              [ New supplier ]
 * [Show  With archived ▾]  [ ⌕ search ]                                     14 of 14
 * SUPPLIER · CODE     MAIN CONTACT     TERMS     ITEMS SUPPLIED   INVOICES IN   ◉ ✎
 * ```
 *
 * ## Search is client-side, and that is a decision rather than a shortcut
 *
 * `listSuppliers` publishes no query parameter and no pagination, because a kitchen's supplier book
 * is a bounded set a person maintains by hand. The whole book is already in memory, so filtering it
 * here searches **all three** of the English name, the Arabic name and the code. Searching only the
 * displayed name would hide a supplier from an Arabic-reading manager typing the English name they
 * see on the invoice. No pager for the same reason: there is one page.
 *
 * ## The archive segment widens the book, it does not replace it
 *
 * Archived suppliers are excluded by the server unless asked for, so the segment is a real refetch
 * rather than a client-side hide. The design labels its second segment "Archived"; this one reads
 * "With archived" because it widens the book — a person looking for the supplier they retired last
 * month wants to see it *among* the live ones, so they can tell which is which.
 *
 * ## The supplied-items count is a count, not a list
 *
 * The column shows the list row's own `suppliedItemCount`. The links themselves live on the
 * supplier's page: fetching every link of every supplier to render a book would be an N+1.
 *
 * Stat cards are counted over the rows in hand, like every Catalogue list.
 */

export function SuppliersScreen({ view }: { readonly view?: string | undefined }) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-suppliers"
        >
            <SuppliersList view={view} />
        </Gate>
    );
}

type ArchiveSegment = 'active' | 'withArchived';

/** Who to call, from the summary the list row already carries — never a per-row fetch. */
function ContactCell({ row }: { readonly row: Supplier }) {
    const { t } = useTranslation();
    const testID = supplierRowTestId(String(row.id));
    const contact = row.primaryContact;

    if (contact === null) {
        // The general office line is the honest fallback: a supplier with no named person is not a
        // supplier with no telephone number.
        const general = row.contactPhone ?? row.contactEmail;
        return general === null ? (
            <Text testID={`${testID}-contact-none`} tone="secondary">
                {t('kitchen:ops.suppliers.noContact')}
            </Text>
        ) : (
            <Text testID={`${testID}-contact`} numberOfLines={1}>
                {`${t('kitchen:ops.suppliers.generalContact')} · ${general}`}
            </Text>
        );
    }

    return (
        <View testID={`${testID}-contact`} className="min-w-0 flex-row items-center gap-1.5">
            <Text variant="strong" numberOfLines={1} testID={`${testID}-contact-name`}>
                {contact.name}
            </Text>
            <Text tone="secondary" numberOfLines={1}>
                {contact.phone ?? t('kitchen:ops.suppliers.noContactPhone')}
            </Text>
        </View>
    );
}

function contactText(row: Supplier, t: TFunction): string {
    const contact = row.primaryContact;
    if (contact === null) {
        const general = row.contactPhone ?? row.contactEmail;
        return general === null
            ? t('kitchen:ops.suppliers.noContact')
            : `${t('kitchen:ops.suppliers.generalContact')} · ${general}`;
    }
    return `${contact.name} · ${contact.phone ?? t('kitchen:ops.suppliers.noContactPhone')}`;
}

/** What the Contact column orders by: the named person, else the general line, else nothing. */
function contactSortKey(row: Supplier): string | null {
    return row.primaryContact?.name ?? row.contactPhone ?? row.contactEmail;
}

/** Lead times in `direction`, an unrecorded one last both ways. */
function compareLeadTime(
    left: number | null,
    right: number | null,
    direction: SortDirection,
): number {
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    return compareNumber(left, right, direction);
}

/** "net 30 · 2 days lead time" — the two facts, or the words for none. */
function termsText(row: Supplier, t: TFunction): string {
    return `${row.paymentTerms ?? t('kitchen:ops.suppliers.noTerms')} · ${
        row.leadTimeDays === null
            ? t('kitchen:ops.suppliers.noLeadTime')
            : t('kitchen:ops.suppliers.leadTimeDays', { count: row.leadTimeDays })
    }`;
}

function itemsText(row: Supplier, t: TFunction): string {
    return row.suppliedItemCount === 0
        ? t('kitchen:ops.suppliers.noItemsLinked')
        : t('kitchen:ops.suppliers.itemCount', { count: row.suppliedItemCount });
}

function SuppliersList({ view }: { readonly view?: string | undefined }) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);

    // Search, segment, page and the supplier last opened survive leaving the list for a record.
    const memory = useListMemory('kitchen.suppliers');
    const [query, setQuery] = useRememberedQuery(memory);
    const [segment, setSegment] = useRememberedFilter<ArchiveSegment>(memory, 'segment', 'active');
    const [lastOpenedId, rememberOpened] = useRememberedOpened(memory);

    const includeArchived = segment === 'withArchived';
    const filter = useMemo(
        () => (includeArchived ? { includeArchived: true } : {}),
        [includeArchived],
    );
    const suppliers = useSuppliersQuery(filter);

    const trimmed = query.trim().toLocaleLowerCase(locale);
    const searched = useMemo(() => {
        const rows = suppliers.data ?? [];
        if (trimmed === '') return rows;
        return rows.filter((row) =>
            [row.name.en, row.name.ar, row.code].some((field) =>
                field.toLocaleLowerCase(locale).includes(trimmed),
            ),
        );
    }, [suppliers.data, trimmed, locale]);
    // The open record is an address, `?view=`, so the supplier page can come back to it.
    const { viewing, viewingId, setViewing } = useViewedRecord(
        view,
        searched,
        (row) => String(row.id),
        suppliers.isSuccess && !suppliers.isFetching,
    );

    /** From the record's page, the supplier page's Cancel and trail come back to it. */
    const openRecord = (row: Supplier) => {
        const id = String(row.id);
        rememberOpened(id);
        router.push(
            withReturnTo(
                `/kitchen/suppliers/${id}`,
                viewingId === id ? withQuery('/kitchen/suppliers', { view: id }) : null,
            ) as never,
        );
    };

    const columns: readonly ControlledColumn<Supplier, CatalogueColumn<Supplier>>[] = [
        {
            key: 'name',
            role: 'title',
            label: t('kitchen:ops.suppliers.columnName'),
            width: 240,
            priority: 100,
            value: (row) => displayName(row.name, locale).value,
            sort: (left, right, direction) =>
                compareText(
                    displayName(left.name, locale).value,
                    displayName(right.name, locale).value,
                    direction,
                ),
            render: (row) => {
                const testID = supplierRowTestId(String(row.id));
                return (
                    <View
                        testID={testID}
                        className="min-w-0 flex-row flex-wrap items-center gap-1.5"
                    >
                        <Text variant="strong" numberOfLines={1} testID={`${testID}-name`}>
                            {displayName(row.name, locale).value}
                        </Text>
                        <Text variant="mono" tone="secondary" testID={`${testID}-code`}>
                            {row.code}
                        </Text>
                        {row.archivedAt === null ? null : (
                            <Badge
                                testID={`${testID}-archived`}
                                tone="neutral"
                                label={t('kitchen:ops.suppliers.archivedBadge')}
                            />
                        )}
                    </View>
                );
            },
        },
        {
            key: 'contact',
            label: t('kitchen:ops.suppliers.columnContact'),
            width: 230,
            priority: 88,
            value: (row) => contactText(row, t),
            // By who the cell names first — the person, else the office line. A supplier with
            // neither sorts last both ways rather than at the top of an ascending list.
            sort: (left, right, direction) =>
                compareText(contactSortKey(left), contactSortKey(right), direction),
            render: (row) => <ContactCell row={row} />,
        },
        {
            key: 'terms',
            label: t('kitchen:ops.suppliers.columnTerms'),
            width: 190,
            priority: 60,
            value: (row) => termsText(row, t),
            // The cell's own order: payment terms, then lead time. Either one unset sorts last.
            sort: (left, right, direction) =>
                compareText(left.paymentTerms, right.paymentTerms, direction) ||
                compareLeadTime(left.leadTimeDays, right.leadTimeDays, direction),
            render: (row) => (
                <Text
                    tone="secondary"
                    numberOfLines={2}
                    testID={`${supplierRowTestId(String(row.id))}-terms`}
                >
                    {termsText(row, t)}
                </Text>
            ),
        },
        {
            key: 'suppliedItems',
            role: 'metric',
            label: t('kitchen:ops.suppliers.columnItems'),
            width: 130,
            priority: 85,
            value: (row) => itemsText(row, t),
            sort: (left, right, direction) =>
                compareNumber(left.suppliedItemCount, right.suppliedItemCount, direction),
            render: (row) => (
                <Text
                    tone={row.suppliedItemCount === 0 ? 'secondary' : 'primary'}
                    testID={`${supplierRowTestId(String(row.id))}-supplied-items`}
                >
                    {itemsText(row, t)}
                </Text>
            ),
        },
        {
            key: 'currency',
            role: 'meta',
            label: t('kitchen:ops.suppliers.fieldCurrency'),
            width: 110,
            priority: 40,
            value: (row) => row.currencyCode ?? t('kitchen:ops.suppliers.noCurrency'),
            filter: {
                values: (rows) =>
                    [...new Set(rows.map((row) => row.currencyCode ?? ''))].map((code) => ({
                        key: code,
                        label: code === '' ? t('kitchen:ops.suppliers.noCurrency') : code,
                    })),
                match: (row, value) => (row.currencyCode ?? '') === value,
            },
            render: (row) =>
                row.currencyCode === null ? (
                    <Text tone="secondary">{t('kitchen:ops.suppliers.noCurrency')}</Text>
                ) : (
                    <Text variant="mono">{row.currencyCode}</Text>
                ),
        },
    ];

    const controls = useColumnControls(searched, columns, 'kitchen-suppliers');
    const failure = toFailure(suppliers.error);
    const unfiltered = trimmed === '' && segment === 'active' && !controls.filtered;
    // The archive switch is a scope, not a filter: Clear leaves it, as the Lens bar's scopes do.
    const searchedOrFiltered = trimmed !== '' || controls.filtered;

    const segments: readonly LensScopeOption<ArchiveSegment>[] = [
        {
            value: 'active',
            label: t('kitchen:ops.suppliers.segmentActive'),
            testID: 'kitchen-suppliers-toolbar-status-active',
        },
        {
            value: 'withArchived',
            label: t('kitchen:ops.suppliers.segmentWithArchived'),
            testID: 'kitchen-suppliers-toolbar-status-withArchived',
        },
    ];

    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-suppliers-view"
                onBack={() => {
                    setViewing(null);
                }}
                title={displayName(viewing.name, locale).value}
                kind={t('kitchen:ops.suppliers.viewKind')}
                status={
                    viewing.archivedAt === null
                        ? { label: t('kitchen:ops.suppliers.segmentActive'), tone: 'success' }
                        : { label: t('kitchen:ops.suppliers.archivedBadge'), tone: 'neutral' }
                }
                {...(viewing.archivedAt === null
                    ? {}
                    : { note: t('kitchen:ops.suppliers.archivedBody') })}
                fields={[
                    {
                        key: 'code',
                        label: t('kitchen:ops.suppliers.fieldCode'),
                        value: viewing.code,
                        mono: true,
                    },
                    {
                        key: 'contact',
                        label: t('kitchen:ops.suppliers.columnContact'),
                        value: contactText(viewing, t),
                    },
                    {
                        key: 'terms',
                        label: t('kitchen:ops.suppliers.columnTerms'),
                        value: termsText(viewing, t),
                    },
                    {
                        key: 'items',
                        label: t('kitchen:ops.suppliers.columnItems'),
                        value: itemsText(viewing, t),
                    },
                    {
                        key: 'currency',
                        label: t('kitchen:ops.suppliers.fieldCurrency'),
                        value: viewing.currencyCode ?? t('kitchen:ops.suppliers.noCurrency'),
                        mono: viewing.currencyCode !== null,
                    },
                ]}
                footNote={t('kitchen:ops.suppliers.viewFoot')}
                primaryAction={{
                    label: t('kitchen:list.open'),
                    icon: null,
                    onPress: () => {
                        openRecord(viewing);
                    },
                }}
            />
        );
    }

    return (
        <Cascade space="md" testID="kitchen-suppliers-screen">
            {/*
             * The Lens bar — the book's figures, the archive scope and the search on one object
             * over the list (`lens-bar.tsx`).
             */}
            <LensBar
                testID="kitchen-suppliers-toolbar"
                label={t('kitchen:lens.label')}
                figures={lensFigures(
                    failure === null ? (suppliers.data ?? null) : null,
                    includeArchived,
                    t,
                )}
                scope={
                    <LensScope<ArchiveSegment>
                        testID="kitchen-suppliers-toolbar-status"
                        label={t('kitchen:ops.suppliers.segmentLabel')}
                        value={segment}
                        options={segments}
                        onChange={(next) => {
                            setSegment(next);
                            setViewing(null);
                        }}
                    />
                }
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:ops.suppliers.searchLabel')}
                searchPlaceholder={t('kitchen:ops.suppliers.searchHint')}
                result={
                    suppliers.data === undefined || failure !== null
                        ? null
                        : t('kitchen:lens.result', {
                              shown: controls.rows.length,
                              total: suppliers.data.length,
                          })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(searchedOrFiltered
                    ? {
                          onClear: () => {
                              setQuery('');
                              controls.clearFilters();
                          },
                      }
                    : {})}
                trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
                actions={
                    canManage ? (
                        <Button
                            testID="kitchen-suppliers-toolbar-create"
                            label={t('kitchen:ops.suppliers.create')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={() => {
                                router.push('/kitchen/suppliers/new' as never);
                            }}
                        />
                    ) : undefined
                }
            />

            {suppliers.isPending ? (
                <TableSkeleton testID="kitchen-suppliers-loading" partTestID="kitchen-suppliers" />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-suppliers-error"
                    failure={failure}
                    onRetry={() => {
                        void suppliers.refetch();
                    }}
                    retrying={suppliers.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-suppliers-empty"
                    title={
                        unfiltered
                            ? t('kitchen:ops.suppliers.emptyTitle')
                            : t('kitchen:ops.suppliers.filteredEmptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('kitchen:ops.suppliers.emptyBody')
                            : t('kitchen:ops.suppliers.filteredEmptyBody')
                    }
                />
            ) : (
                <CatalogueList<Supplier>
                    testID="kitchen-suppliers-table"
                    label={t('kitchen:ops.suppliers.caption')}
                    columns={controls.columns}
                    rows={controls.rows}
                    rowKey={(row) => String(row.id)}
                    density="sm"
                    highlightedId={lastOpenedId}
                    initialPage={memory.initial.page}
                    onPageChange={(page) => {
                        memory.remember({ page });
                    }}
                    onRowPress={openRecord}
                    rowActionsLabel={t('kitchen:list.rowActions')}
                    // View and Open. Archive lives on the record, behind its confirmation.
                    rowActions={(row): readonly MenuItem[] => [
                        {
                            key: 'view',
                            label: t('kitchen:list.view'),
                            icon: CATALOGUE_ROW_ICONS.view,
                            testID: `${supplierRowTestId(String(row.id))}-view`,
                            onSelect: () => {
                                rememberOpened(String(row.id));
                                setViewing(row);
                            },
                        },
                        {
                            key: 'open',
                            label: t('kitchen:catalogue.edit'),
                            icon: CATALOGUE_ROW_ICONS.edit,
                            testID: `${supplierRowTestId(String(row.id))}-open`,
                            onSelect: () => {
                                openRecord(row);
                            },
                        },
                    ]}
                />
            )}
        </Cascade>
    );
}

/**
 * The Lens bar's figures: All, then Active and Archived, read-only — the archive switch is the scope
 * on the query row. Counted over the book in hand, the search aside. Archived is drawn only while the
 * archived suppliers are loaded: with them left out, a zero would be a claim nobody checked.
 */
function lensFigures(
    rows: readonly Supplier[] | null,
    includeArchived: boolean,
    t: TFunction,
): readonly LensFigure[] {
    const archived = rows?.filter((row) => row.archivedAt !== null).length ?? null;
    return [
        {
            key: 'all',
            label: t('kitchen:lens.allSuppliers'),
            value: rows?.length ?? null,
        },
        {
            key: 'active',
            label: t('kitchen:ops.suppliers.segmentActive'),
            value: rows === null || archived === null ? null : rows.length - archived,
            tone: 'success',
            separated: true,
        },
        ...(includeArchived
            ? [
                  {
                      key: 'archived',
                      label: t('kitchen:ops.suppliers.archivedBadge'),
                      value: archived,
                      tone: 'neutral' as const,
                  },
              ]
            : []),
    ];
}
