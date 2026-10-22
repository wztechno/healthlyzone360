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
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useKitchenCustomersQuery } from '../../../data/kitchen-customers-hooks.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { ORDER_VIEW_CUSTOMER_CONTACT_PERMISSION } from '../entity-registry.ts';
import { useDebouncedValue } from '../order-desk/use-debounced-value.ts';

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

    const [query, setQuery] = useState('');
    const [segment, setSegment] = useState<TypeSegment>('all');
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

    const segments: readonly CatalogueStatusSegment<TypeSegment>[] = [
        { value: 'all', label: t('kitchen:ops.customers.segmentAll') },
        { value: 'b2c', label: t('kitchen:ops.customers.typeB2c') },
        { value: 'b2b', label: t('kitchen:ops.customers.typeB2b') },
        { value: 'guest', label: t('kitchen:ops.customers.typeGuest') },
    ];

    const openRecord = (row: KitchenCustomer) => {
        router.push(`/kitchen/customers/${row.id}` as never);
    };

    return (
        <Cascade space="md" testID="kitchen-customers-screen">
            <CatalogueToolbar<TypeSegment>
                testID="kitchen-customers-toolbar"
                search={query}
                onSearchChange={setQuery}
                searchLabel={t('kitchen:ops.customers.searchLabel')}
                searchPlaceholder={t('kitchen:ops.customers.searchHint')}
                statusLabel={t('kitchen:ops.customers.segmentLabel')}
                statusSegments={segments}
                status={segment}
                onStatusChange={setSegment}
            >
                <ColumnPicker {...controls.picker} />
            </CatalogueToolbar>

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

            {customers.isPending ? (
                <TableSkeleton testID="kitchen-customers-loading" partTestID="kitchen-customers" />
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
                <EmptyState
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
            ) : (
                <CatalogueList<KitchenCustomer>
                    testID="kitchen-customers-table"
                    label={t('kitchen:ops.customers.caption')}
                    columns={controls.columns}
                    rows={controls.rows}
                    rowKey={(row) => row.id}
                    density="sm"
                    onRowPress={openRecord}
                    rowActionsLabel={t('kitchen:list.rowActions')}
                />
            )}
        </Cascade>
    );
}
