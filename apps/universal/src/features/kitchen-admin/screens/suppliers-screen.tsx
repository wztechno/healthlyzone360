import type { Supplier } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorState,
    FilterChip,
    Inline,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useSuppliersQuery } from '../../../data/kitchen-ops-hooks.ts';
import { INVENTORY_MANAGE_PERMISSION, INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
import { supplierRowTestId } from '../ops-format.ts';

/**
 * `/kitchen/suppliers` — who this kitchen buys from (SUP1).
 *
 * ## Search is client-side, and that is a decision rather than a shortcut
 *
 * `listSuppliers` publishes no query parameter and no pagination, because a kitchen's supplier book
 * is a bounded set a person maintains by hand — tens of rows, not thousands. The whole book is
 * already in memory, so filtering it here is one pass over an array rather than a round trip, and it
 * searches **all three** of the English name, the Arabic name and the code. Searching only the
 * displayed name would hide a supplier from an Arabic-reading manager typing the English name they
 * see on the invoice, which is exactly the person most likely to be typing it.
 *
 * ## The archive is a filter, not a second list
 *
 * Archived suppliers are excluded by the server unless asked for, so the chip is a real refetch
 * rather than a client-side hide. It reads "Show archived" rather than "Archived", because it widens
 * the book rather than replacing it: a person looking for the supplier they retired last month wants
 * to see it *among* the live ones, so they can tell which is which.
 *
 * ## The supplied-items count is a count, not a list
 *
 * SUP2 added supplier↔item links, and the column that shows them shows a **number** taken from the
 * list row's own `suppliedItemCount`. The links themselves live on the supplier's page: fetching
 * every link of every supplier to render a book would be exactly the N+1 the contact summary
 * beside it already exists to avoid.
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
            <Stack space="none" testID={`${testID}-contact`}>
                <Text>{general}</Text>
                <Text variant="caption" tone="secondary">
                    {t('kitchen:ops.suppliers.generalContact')}
                </Text>
            </Stack>
        );
    }

    return (
        <Stack space="none" testID={`${testID}-contact`}>
            <Text variant="bodyStrong" testID={`${testID}-contact-name`}>
                {contact.name}
            </Text>
            <Text variant="caption" tone="secondary">
                {contact.phone ?? t('kitchen:ops.suppliers.noContactPhone')}
            </Text>
        </Stack>
    );
}

function SuppliersList() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);

    const [query, setQuery] = useState('');
    const [includeArchived, setIncludeArchived] = useState(false);

    const filter = useMemo(
        () => (includeArchived ? { includeArchived: true } : {}),
        [includeArchived],
    );
    const suppliers = useSuppliersQuery(filter);
    const rows = suppliers.data;

    const trimmed = query.trim().toLocaleLowerCase(locale);
    const filtered = useMemo(() => {
        if (trimmed === '') return rows ?? [];
        return (rows ?? []).filter((row) =>
            [row.name.en, row.name.ar, row.code].some((field) =>
                field.toLocaleLowerCase(locale).includes(trimmed),
            ),
        );
    }, [rows, trimmed, locale]);

    const columns: readonly TableColumn<Supplier>[] = [
        {
            key: 'name',
            header: t('kitchen:ops.suppliers.columnName'),
            rowHeader: true,
            flex: 2,
            render: (row) => {
                const testID = supplierRowTestId(String(row.id));
                const name = displayName(row.name, locale);
                return (
                    <Stack space="none">
                        <Text variant="bodyStrong" testID={`${testID}-name`}>
                            {name.value}
                        </Text>
                        <Text variant="caption" tone="secondary" testID={`${testID}-code`}>
                            {row.code}
                        </Text>
                        {row.archivedAt === null ? null : (
                            <Badge
                                testID={`${testID}-archived`}
                                tone="neutral"
                                label={t('kitchen:ops.suppliers.archivedBadge')}
                            />
                        )}
                    </Stack>
                );
            },
        },
        {
            key: 'contact',
            header: t('kitchen:ops.suppliers.columnContact'),
            flex: 2,
            render: (row) => <ContactCell row={row} />,
        },
        {
            key: 'suppliedItems',
            header: t('kitchen:ops.suppliers.columnItems'),
            numeric: true,
            render: (row) => (
                <Text
                    tone={row.suppliedItemCount === 0 ? 'secondary' : 'primary'}
                    testID={`${supplierRowTestId(String(row.id))}-supplied-items`}
                >
                    {row.suppliedItemCount === 0
                        ? t('kitchen:ops.suppliers.noItemsLinked')
                        : t('kitchen:ops.suppliers.itemCount', { count: row.suppliedItemCount })}
                </Text>
            ),
        },
        {
            key: 'terms',
            header: t('kitchen:ops.suppliers.columnTerms'),
            flex: 2,
            render: (row) => {
                const testID = supplierRowTestId(String(row.id));
                return (
                    <Stack space="none">
                        <Text testID={`${testID}-terms`}>
                            {row.paymentTerms ?? t('kitchen:ops.suppliers.noTerms')}
                        </Text>
                        <Text variant="caption" tone="secondary" testID={`${testID}-lead-time`}>
                            {row.leadTimeDays === null
                                ? t('kitchen:ops.suppliers.noLeadTime')
                                : t('kitchen:ops.suppliers.leadTimeDays', {
                                      count: row.leadTimeDays,
                                  })}
                        </Text>
                    </Stack>
                );
            },
        },
    ];

    const failure = toFailure(suppliers.error);
    const unfiltered = trimmed === '';

    return (
        <Stack space="lg" testID="kitchen-suppliers-screen">
            <KitchenPageHeader
                testID="kitchen-suppliers-header"
                title={t('kitchen:ops.suppliers.title')}
                subtitle={t('kitchen:ops.suppliers.subtitle')}
                titleTestID="kitchen-suppliers-title"
                subtitleTestID="kitchen-suppliers-subtitle"
            />

            {/*
             * Hand-rolled rather than `ListToolbar`: that component is typed on `PublishableStatus`
             * and a supplier has no publication lifecycle. Widening a component seven catalogue
             * screens depend on, to carry a status this family does not have, would be the wrong
             * direction of change.
             */}
            <Inline
                space="sm"
                align="end"
                justify="between"
                wrap
                testID="kitchen-suppliers-toolbar"
            >
                <TextInputField
                    testID="kitchen-suppliers-search"
                    label={t('kitchen:ops.suppliers.searchLabel')}
                    hint={t('kitchen:ops.suppliers.searchHint')}
                    value={query}
                    autoCapitalize="none"
                    onChangeText={setQuery}
                />

                <Inline space="sm" align="center" wrap>
                    <FilterChip
                        testID="kitchen-suppliers-archived-filter"
                        label={t('kitchen:ops.suppliers.showArchived')}
                        selected={includeArchived}
                        onChange={setIncludeArchived}
                    />
                    {canManage ? (
                        <Button
                            testID="kitchen-suppliers-create"
                            label={t('kitchen:ops.suppliers.create')}
                            onPress={() => {
                                router.push('/kitchen/suppliers/new' as never);
                            }}
                        />
                    ) : null}
                </Inline>
            </Inline>

            {suppliers.isPending ? (
                <Stack space="sm" testID="kitchen-suppliers-loading">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`kitchen-suppliers-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                            </Stack>
                        </Card>
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
            ) : filtered.length === 0 ? (
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
                <Table<Supplier>
                    testID="kitchen-suppliers-table"
                    caption={t('kitchen:ops.suppliers.caption')}
                    captionHidden
                    columns={columns}
                    rows={filtered}
                    rowKey={(row) => String(row.id)}
                    rowAction={{
                        header: t('kitchen:list.actionHeader'),
                        render: (row) => (
                            <Inline space="xs" wrap justify="end">
                                <Button
                                    testID={`${supplierRowTestId(String(row.id))}-open`}
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:list.open')}
                                    onPress={() => {
                                        router.push(
                                            `/kitchen/suppliers/${String(row.id)}` as never,
                                        );
                                    }}
                                />
                            </Inline>
                        ),
                    }}
                />
            )}
        </Stack>
    );
}
