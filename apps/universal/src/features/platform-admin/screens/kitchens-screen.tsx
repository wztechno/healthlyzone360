import type { KitchenTenantStatus, PlatformKitchenSummary } from '@healthy360/api-client/contracts';
import { KITCHEN_TENANT_STATUSES } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Select,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { usePlatformKitchensQuery } from '../../../data/platform-admin-hooks.ts';
import { kitchenRowTestId, tenantStatusKey, tenantStatusTone } from '../format.ts';

/**
 * `/platform-admin` — every kitchen on the platform.
 *
 * ## The gate is the area's, not this screen's
 *
 * Unlike the kitchen workspace's lists, which tighten their area baseline with a per-screen
 * permission, this screen adds nothing: `platform-admin`'s baseline already names
 * `organisation.manage_platform`, and there is no narrower authority inside the console to express.
 * The `<Gate>` is still here rather than left to the layout so that a direct render of the screen
 * in a test refuses the same way the route does.
 *
 * ## Filtering is server-side and sorting is not offered
 *
 * `status` and `query` go to the API, so a filtered list is a filtered *list* rather than a filtered
 * page. Sorting is deliberately absent: the endpoint answers newest-first and a client-side sort
 * over a cursor page would silently mean "sorted within what you have fetched", which the ingredient
 * list has to live with because it inherited it and this one does not have to inherit.
 *
 * ## A kitchen with no owner is called out on the row
 *
 * Not in a footnote. It is the single most actionable thing this list can tell an operator — a
 * kitchen nobody can open — and burying it inside a `0` in an owners column is how it goes unnoticed
 * for a month.
 */
export function PlatformKitchensScreen() {
    return (
        <Gate area="platform-admin" testID="platform-admin-kitchens">
            <KitchensList />
        </Gate>
    );
}

function KitchensList() {
    const { t } = useTranslation();
    const router = useRouter();

    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<KitchenTenantStatus | null>(null);

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(status === null ? {} : { status }),
        }),
        [trimmed, status],
    );

    const kitchens = usePlatformKitchensQuery(filter);
    const rows = useMemo(
        () => (kitchens.data?.pages ?? []).flatMap((page) => page.items),
        [kitchens.data?.pages],
    );

    const columns: readonly TableColumn<PlatformKitchenSummary>[] = [
        {
            key: 'kitchen',
            header: t('platformAdmin:kitchens.column.kitchen'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Stack space="none">
                    <Text variant="bodyStrong" testID={`${kitchenRowTestId(row.id)}-name`}>
                        {row.name}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {row.slug}
                    </Text>
                </Stack>
            ),
        },
        {
            key: 'status',
            header: t('platformAdmin:kitchens.column.status'),
            render: (row) => (
                <Badge
                    testID={`${kitchenRowTestId(row.id)}-status`}
                    tone={tenantStatusTone(row.status)}
                    label={t(tenantStatusKey(row.status))}
                />
            ),
        },
        {
            key: 'owners',
            header: t('platformAdmin:kitchens.column.owners'),
            render: (row) =>
                row.ownerCount === 0 ? (
                    <Badge
                        testID={`${kitchenRowTestId(row.id)}-no-owner`}
                        tone="warning"
                        icon="warning"
                        label={t('platformAdmin:kitchens.noOwner')}
                    />
                ) : (
                    <Text testID={`${kitchenRowTestId(row.id)}-owners`}>
                        {t('platformAdmin:kitchens.ownerCount', { count: row.ownerCount })}
                    </Text>
                ),
        },
        {
            key: 'branches',
            header: t('platformAdmin:kitchens.column.branches'),
            render: (row) => (
                <Text testID={`${kitchenRowTestId(row.id)}-branches`} tone="secondary">
                    {t('platformAdmin:kitchens.branchCount', { count: row.branchCount })}
                </Text>
            ),
        },
        {
            key: 'catalogue',
            header: t('platformAdmin:kitchens.column.catalogue'),
            render: (row) => (
                <Text testID={`${kitchenRowTestId(row.id)}-published`} tone="secondary">
                    {t('platformAdmin:kitchens.publishedCount', { count: row.catalogue.published })}
                </Text>
            ),
        },
    ];

    const failure = toFailure(kitchens.error);
    const filtered = trimmed !== '' || status !== null;

    return (
        <Stack space="lg" testID="platform-admin-kitchens-screen">
            <Stack space="xs">
                <Heading level={1} testID="platform-admin-kitchens-title">
                    {t('platformAdmin:kitchens.title')}
                </Heading>
                <Text tone="secondary" testID="platform-admin-kitchens-subtitle">
                    {t('platformAdmin:kitchens.subtitle')}
                </Text>
            </Stack>

            <Card padding="md" testID="platform-admin-kitchens-toolbar">
                <Stack space="sm">
                    <TextInputField
                        testID="platform-admin-kitchens-search"
                        label={t('platformAdmin:kitchens.searchLabel')}
                        placeholder={t('platformAdmin:kitchens.searchPlaceholder')}
                        value={query}
                        onChangeText={setQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />

                    <Select<KitchenTenantStatus>
                        testID="platform-admin-kitchens-status"
                        label={t('platformAdmin:kitchens.statusLabel')}
                        placeholder={t('platformAdmin:kitchens.statusAny')}
                        value={status}
                        options={KITCHEN_TENANT_STATUSES.map((value) => ({
                            value,
                            label: t(tenantStatusKey(value)),
                        }))}
                        onChange={(next) => {
                            // Selecting the value that is already applied clears it. `Select` has no
                            // "none" option and adding one would put a sentinel string into a typed
                            // union; toggling is the smaller lie and the more useful behaviour.
                            setStatus((current) => (current === next ? null : next));
                        }}
                    />

                    <Inline space="sm" wrap>
                        <Button
                            testID="platform-admin-kitchens-create"
                            label={t('platformAdmin:kitchens.create')}
                            onPress={() => {
                                router.push('/platform-admin/kitchens/new' as never);
                            }}
                        />
                        {filtered ? (
                            <Button
                                testID="platform-admin-kitchens-clear"
                                variant="ghost"
                                label={t('platformAdmin:kitchens.statusAny')}
                                onPress={() => {
                                    setQuery('');
                                    setStatus(null);
                                }}
                            />
                        ) : null}
                    </Inline>
                </Stack>
            </Card>

            {kitchens.isPending ? (
                <Stack space="sm" testID="platform-admin-kitchens-loading">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`platform-admin-kitchens-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="platform-admin-kitchens-error"
                    failure={failure}
                    onRetry={() => {
                        void kitchens.refetch();
                    }}
                    retrying={kitchens.isFetching}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    testID="platform-admin-kitchens-empty"
                    title={t('platformAdmin:kitchens.emptyTitle')}
                    body={t('platformAdmin:kitchens.emptyBody')}
                    actions={
                        <Button
                            testID="platform-admin-kitchens-empty-clear"
                            variant="secondary"
                            label={t('platformAdmin:kitchens.statusAny')}
                            onPress={() => {
                                setQuery('');
                                setStatus(null);
                            }}
                        />
                    }
                />
            ) : (
                <Stack space="sm">
                    <Table<PlatformKitchenSummary>
                        testID="platform-admin-kitchens-table"
                        caption={t('platformAdmin:kitchens.title')}
                        captionHidden
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => String(row.id)}
                        rowAction={{
                            header: t('platformAdmin:kitchens.column.kitchen'),
                            render: (row) => (
                                <Button
                                    testID={`${kitchenRowTestId(row.id)}-open`}
                                    size="sm"
                                    variant="secondary"
                                    label={t('platformAdmin:kitchens.open', { name: row.name })}
                                    onPress={() => {
                                        router.push(
                                            `/platform-admin/kitchens/${row.slug}` as never,
                                        );
                                    }}
                                />
                            ),
                        }}
                    />

                    {kitchens.hasNextPage ? (
                        <Button
                            testID="platform-admin-kitchens-more"
                            variant="secondary"
                            label={t('platformAdmin:kitchens.loadMore')}
                            loading={kitchens.isFetchingNextPage}
                            onPress={() => {
                                void kitchens.fetchNextPage();
                            }}
                        />
                    ) : null}
                </Stack>
            )}
        </Stack>
    );
}
