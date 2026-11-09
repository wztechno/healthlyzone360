import type { KitchenCustomer, KitchenCustomerType } from '@healthy360/api-client/contracts';
import {
    Badge,
    Callout,
    Cascade,
    EmptyState,
    ErrorState,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { BadgeTone } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useKitchenCustomersQuery } from '../../../data/kitchen-customers-hooks.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { LensBar, LensScope } from '../catalogue/lens-bar.tsx';
import type { LensScopeOption } from '../catalogue/lens-bar.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { ORDER_VIEW_CUSTOMER_CONTACT_PERMISSION } from '../entity-registry.ts';
import { useDebouncedValue } from '../order-desk/use-debounced-value.ts';
import {
    useListMemory,
    useRememberedFilter,
    useRememberedOpened,
    useRememberedQuery,
} from '../list-memory.ts';

/**
 * `/kitchen/customers` — the kitchen's customer book, for reference (Access group).
 *
 * ```
 * [ ⌕ name or +E.164 ]  [ All | Consumer | Business | Guest ]           [ columns ]
 * CUSTOMER · TYPE     PHONE     EMAIL     ORDERS     LAST ORDER
 * ```
 *
 * Search and the type segments are **server-side**: the book is every customer this kitchen has
 * cooked for, written down, or holds a corporate programme with, and it is capped at the server's
 * limit with the true total beside it. When the cap bites the screen says so rather than letting a
 * short list pass for a complete one. Column sorts reorder the rows in hand.
 *
 * Read-only. A row opens the record; correcting a caller stays at the order desk.
 */

type TypeSegment = 'all' | KitchenCustomerType;

const SEARCH_DEBOUNCE_MS = 300;

export function CustomersScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_VIEW_CUSTOMER_CONTACT_PERMISSION] }}
            testID="kitchen-customers"
        >
            <CustomersList />
        </Gate>
    );
}

export function customerTypeKey(type: KitchenCustomerType): string {
    switch (type) {
        case 'b2b':
            return 'kitchen:ops.customers.typeB2b';
        case 'guest':
            return 'kitchen:ops.customers.typeGuest';
        case 'b2c':
            return 'kitchen:ops.customers.typeB2c';
    }
}

export function customerTypeTone(type: KitchenCustomerType): BadgeTone {
    return type === 'b2b' ? 'info' : type === 'guest' ? 'neutral' : 'brand';
}

export function customerName(row: KitchenCustomer, t: TFunction): string {
    return row.displayName ?? t('kitchen:ops.customers.noName');
}

function rowTestId(id: string): string {
    return `kitchen-customer-row-${id}`;
}

function CustomersList() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();

    // Search, segment, page and the customer last opened survive leaving the list for a record.
    const memory = useListMemory('kitchen.customers');
    const [query, setQuery] = useRememberedQuery(memory);
    const [segment, setSegment] = useRememberedFilter<TypeSegment>(memory, 'segment', 'all');
    const [lastOpenedId, rememberOpened] = useRememberedOpened(memory);
    const settledQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

    const filter = useMemo(
        () => ({
            ...(settledQuery === '' ? {} : { query: settledQuery }),
            ...(segment === 'all' ? {} : { type: segment }),
        }),
        [settledQuery, segment],
    );
    const customers = useKitchenCustomersQuery(filter);

    const lastOrderText = (row: KitchenCustomer): string =>
        row.lastOrderedAt === null
            ? t('kitchen:ops.customers.neverOrdered')
            : formatter.formatDate(row.lastOrderedAt);

    const columns: readonly ControlledColumn<KitchenCustomer, CatalogueColumn<KitchenCustomer>>[] =
        [
            {
                key: 'name',
                role: 'title',
                label: t('kitchen:ops.customers.columnName'),
                width: 240,
                priority: 100,
                value: (row) => customerName(row, t),
                sort: (left, right, direction) =>
                    compareText(left.displayName, right.displayName, direction),
                render: (row) => (
                    <View
                        testID={rowTestId(row.id)}
                        className="min-w-0 flex-row flex-wrap items-center gap-1.5"
                    >
                        <Text variant="strong" numberOfLines={1}>
                            {customerName(row, t)}
                        </Text>
                        <Text variant="mono" tone="secondary">
                            {row.accountNumber}
                        </Text>
                    </View>
                ),
            },
            {
                key: 'type',
                label: t('kitchen:ops.customers.columnType'),
                width: 120,
                priority: 90,
                value: (row) => t(customerTypeKey(row.type)),
                sort: (left, right, direction) => compareText(left.type, right.type, direction),
                render: (row) => (
                    <View className="flex-row">
                        <Badge
                            icon={null}
                            testID={`${rowTestId(row.id)}-type`}
                            tone={customerTypeTone(row.type)}
                            label={t(customerTypeKey(row.type))}
                        />
                    </View>
                ),
            },
            {
                key: 'phone',
                label: t('kitchen:ops.customers.columnPhone'),
                width: 170,
                priority: 88,
                value: (row) => row.primaryPhone ?? '—',
                sort: (left, right, direction) =>
                    compareText(left.primaryPhone, right.primaryPhone, direction),
                render: (row) => (
                    <Text variant="mono" tone={row.primaryPhone === null ? 'secondary' : 'primary'}>
                        {row.primaryPhone ?? '—'}
                    </Text>
                ),
            },
            {
                key: 'email',
                label: t('kitchen:ops.customers.columnEmail'),
                width: 220,
                priority: 70,
                value: (row) => row.primaryEmail ?? '—',
                sort: (left, right, direction) =>
                    compareText(left.primaryEmail, right.primaryEmail, direction),
                render: (row) => (
                    <Text
                        numberOfLines={1}
                        tone={row.primaryEmail === null ? 'secondary' : 'primary'}
                    >
                        {row.primaryEmail ?? '—'}
                    </Text>
                ),
            },
            {
                key: 'orders',
                role: 'metric',
                label: t('kitchen:ops.customers.columnOrders'),
                width: 100,
                priority: 80,
                value: (row) => String(row.orderCount),
                sort: (left, right, direction) =>
                    compareNumber(left.orderCount, right.orderCount, direction),
                render: (row) => (
                    <Text testID={`${rowTestId(row.id)}-orders`} className="tabular-nums">
                        {String(row.orderCount)}
                    </Text>
                ),
            },
            {
                key: 'lastOrder',
                label: t('kitchen:ops.customers.columnLastOrder'),
                width: 150,
                priority: 75,
                value: lastOrderText,
                sort: (left, right, direction) =>
                    compareText(left.lastOrderedAt, right.lastOrderedAt, direction),
                render: (row) => (
                    <Text tone={row.lastOrderedAt === null ? 'secondary' : 'primary'}>
                        {lastOrderText(row)}
                    </Text>
                ),
            },
        ];

    const controls = useColumnControls(customers.data?.rows ?? [], columns, 'kitchen-customers');
    const failure = toFailure(customers.error);
    const unfiltered = settledQuery === '' && segment === 'all' && !controls.filtered;

    const segments: readonly LensScopeOption<TypeSegment>[] = (
        [
            ['all', 'kitchen:ops.customers.segmentAll'],
            ['b2c', 'kitchen:ops.customers.typeB2c'],
            ['b2b', 'kitchen:ops.customers.typeB2b'],
            ['guest', 'kitchen:ops.customers.typeGuest'],
        ] as const
    ).map(([value, key]) => ({
        value,
        label: t(key),
        testID: `kitchen-customers-toolbar-status-${value}`,
    }));

    const openRecord = (row: KitchenCustomer) => {
        rememberOpened(row.id);
        router.push(`/kitchen/customers/${row.id}` as never);
    };

    // The table closes the toolbar's card once the list has loaded.
    const joined = !customers.isPending && failure === null;

    return (
        <Cascade space="md" testID="kitchen-customers-screen">
            {customers.data?.truncated === true ? (
                <Callout
                    testID="kitchen-customers-truncated"
                    tone="info"
                    title={t('kitchen:ops.customers.truncated', {
                        shown: customers.data.rows.length,
                        total: customers.data.total,
                    })}
                />
            ) : null}

            {/* One block, so the toolbar card runs straight on into the table. */}
            <View className={joined ? 'z-10' : 'z-10 gap-4'}>
                <LensBar
                    testID="kitchen-customers-toolbar"
                    layout="split"
                    joined={joined}
                    label={t('kitchen:lens.label')}
                    figures={[]}
                    scope={
                        <LensScope<TypeSegment>
                            testID="kitchen-customers-toolbar-status"
                            label={t('kitchen:ops.customers.segmentLabel')}
                            value={segment}
                            options={segments}
                            onChange={setSegment}
                        />
                    }
                    search={query}
                    onSearchChange={setQuery}
                    searchLabel={t('kitchen:ops.customers.searchLabel')}
                    searchPlaceholder={t('kitchen:ops.customers.searchHint')}
                    result={
                        customers.data === undefined || failure !== null
                            ? null
                            : t('kitchen:lens.result', {
                                  shown: controls.rows.length,
                                  total: customers.data.rows.length,
                              })
                    }
                    clearLabel={t('kitchen:lens.clear')}
                    {...(unfiltered
                        ? {}
                        : {
                              onClear: () => {
                                  setQuery('');
                                  setSegment('all');
                                  controls.clearFilters();
                              },
                          })}
                    trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
                />

                {customers.isPending ? (
                    <TableSkeleton
                        testID="kitchen-customers-loading"
                        partTestID="kitchen-customers"
                    />
                ) : failure !== null ? (
                    <ErrorState
                        testID="kitchen-customers-error"
                        failure={failure}
                        onRetry={() => {
                            void customers.refetch();
                        }}
                        retrying={customers.isFetching}
                    />
                ) : controls.rows.length === 0 ? (
                    <CatalogueList
                        testID="kitchen-customers-empty-list"
                        label={t('kitchen:lens.label')}
                        columns={controls.columns}
                        rows={[]}
                        rowKey={() => ''}
                        density="sm"
                        joined
                        frameEmpty
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        emptyState={
                            <EmptyState
                                shape="table"
                                testID="kitchen-customers-empty"
                                title={
                                    unfiltered
                                        ? t('kitchen:ops.customers.emptyTitle')
                                        : t('kitchen:ops.customers.filteredEmptyTitle')
                                }
                                body={
                                    unfiltered
                                        ? t('kitchen:ops.customers.emptyBody')
                                        : t('kitchen:ops.customers.filteredEmptyBody')
                                }
                            />
                        }
                    />
                ) : (
                    <CatalogueList<KitchenCustomer>
                        testID="kitchen-customers-table"
                        joined
                        label={t('kitchen:ops.customers.caption')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => row.id}
                        density="sm"
                        highlightedId={lastOpenedId}
                        initialPage={memory.initial.page}
                        onPageChange={(page) => {
                            memory.remember({ page });
                        }}
                        onRowPress={openRecord}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                    />
                )}
            </View>
        </Cascade>
    );
}
