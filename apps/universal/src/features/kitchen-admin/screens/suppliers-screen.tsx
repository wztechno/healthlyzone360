import type { Supplier } from '@healthy360/api-client/contracts';
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
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useSuppliersQuery } from '../../../data/kitchen-ops-hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { INVENTORY_MANAGE_PERMISSION, INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { supplierRowTestId } from '../ops-format.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';

/**
 * `/kitchen/suppliers` — who this kitchen buys from (SUP1), on the Catalogue list (Operations
 * design, `suppliers`).
 *
 * ```
 * ┌ SHOWN ┐ ┌ ACTIVE ┐ ┌ ARCHIVED ┐
 * [ ⌕ search ]  [ Active | With archived ]  [ New supplier ]
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

export function SuppliersScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-suppliers"
        >
            <SuppliersList />
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

function SuppliersList() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);

    const [query, setQuery] = useState('');
    const [segment, setSegment] = useState<ArchiveSegment>('active');
    const [viewing, setViewing] = useState<Supplier | null>(null);

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

    const openRecord = (row: Supplier) => {
        setViewing(null);
        router.push(`/kitchen/suppliers/${String(row.id)}` as never);
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
            render: (row) => <ContactCell row={row} />,
        },
        {
            key: 'terms',
            label: t('kitchen:ops.suppliers.columnTerms'),
            width: 190,
            priority: 60,
            value: (row) => termsText(row, t),
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
    const unfiltered = trimmed === '' && segment === 'active';

    const segments: readonly CatalogueStatusSegment<ArchiveSegment>[] = [
        { value: 'active', label: t('kitchen:ops.suppliers.segmentActive') },
        { value: 'withArchived', label: t('kitchen:ops.suppliers.segmentWithArchived') },
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
        <Stack space="md" testID="kitchen-suppliers-screen">
            {suppliers.isPending || failure !== null ? null : (
                <CatalogueStatCards
                    testID="kitchen-suppliers-stats"
                    cards={statCards(controls.rows, unfiltered, t, () => {
                        setQuery('');
                        setSegment('active');
                    })}
                />
            )}

            <CatalogueToolbar<ArchiveSegment>
                testID="kitchen-suppliers-toolbar"
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:ops.suppliers.searchLabel')}
                searchPlaceholder={t('kitchen:ops.suppliers.searchHint')}
                statusLabel={t('kitchen:ops.suppliers.segmentLabel')}
                statusSegments={segments}
                status={segment}
                onStatusChange={(next) => {
                    setSegment(next);
                    setViewing(null);
                }}
            >
                {canManage ? (
                    <Button
                        testID="kitchen-suppliers-toolbar-create"
                        label={t('kitchen:ops.suppliers.create')}
                        onPress={() => {
                            router.push('/kitchen/suppliers/new' as never);
                        }}
                    />
                ) : null}
            </CatalogueToolbar>

            {suppliers.isPending ? (
                <Stack space="xs" testID="kitchen-suppliers-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-suppliers-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
                    ))}
                </Stack>
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
                                setViewing(row);
                            },
                        },
                        {
                            key: 'open',
                            label: t('kitchen:list.open'),
                            icon: CATALOGUE_ROW_ICONS.edit,
                            testID: `${supplierRowTestId(String(row.id))}-open`,
                            onSelect: () => {
                                openRecord(row);
                            },
                        },
                    ]}
                />
            )}
        </Stack>
    );
}

/** Counted over the rows in hand: shown, active, archived (only ever non-zero with archived on). */
function statCards(
    rows: readonly Supplier[],
    unfiltered: boolean,
    t: TFunction,
    clear: () => void,
): readonly CatalogueStatCard[] {
    const archived = rows.filter((row) => row.archivedAt !== null).length;
    const active = rows.length - archived;
    return [
        {
            key: 'shown',
            label: t('kitchen:list.statShown'),
            value: String(rows.length),
            unit: t('kitchen:list.statShownUnit', { total: rows.length }),
            caption: unfiltered
                ? t('kitchen:list.statShownUnfiltered')
                : t('kitchen:list.statShownFiltered'),
            mark: 'calendar',
            tone: 'brand',
            onPress: clear,
            accessibilityLabel: t('kitchen:list.statShownAction'),
        },
        {
            key: 'active',
            label: t('kitchen:ops.suppliers.segmentActive'),
            value: String(active),
            unit: t('kitchen:ops.suppliers.statUnit'),
            caption: t('kitchen:ops.suppliers.statActiveCaption'),
            mark: 'check',
        },
        {
            key: 'archived',
            label: t('kitchen:ops.suppliers.archivedBadge'),
            value: String(archived),
            unit: t('kitchen:ops.suppliers.statUnit'),
            caption: t('kitchen:ops.suppliers.statArchivedCaption'),
            mark: 'eyeOff',
        },
    ];
}
