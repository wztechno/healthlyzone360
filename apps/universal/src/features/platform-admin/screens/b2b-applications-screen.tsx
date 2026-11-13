import type {
    PlatformApplicationStatus,
    PlatformB2bApplicationSummary,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorState,
    Heading,
    Stack,
    Table,
    TableSkeleton,
    Tabs,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { usePlatformB2bApplicationsQuery } from '../../../data/platform-b2b-hooks.ts';
import {
    applicationRowTestId,
    applicationStatusKey,
    applicationStatusTone,
} from '../b2b-review.ts';
import { platformB2bApplicationHref } from '../platform-admin-chrome.tsx';

/**
 * `/platform-admin/b2b` — the B2B onboarding queue.
 *
 * Tabs by status, **Submitted first**, because that is the work nobody has picked up. The server
 * answers oldest first: a queue is fair in the order things arrived. "All" means everything except
 * drafts, which are not a reviewer's business until they are sent.
 *
 * Gated on `b2b_application.view_platform` on top of the console's baseline: working this queue
 * is a separate authority from administering kitchens.
 */

const TABS = [
    'submitted',
    'in_review',
    'info_requested',
    'approved',
    'declined',
    'withdrawn',
    'all',
] as const;
type QueueTab = (typeof TABS)[number];

export function PlatformB2bApplicationsScreen() {
    return (
        <Gate
            area="platform-admin"
            requirement={{ allOf: ['b2b_application.view_platform'] }}
            testID="platform-b2b-applications"
        >
            <ApplicationsQueue />
        </Gate>
    );
}

function ApplicationsQueue() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const [tab, setTab] = useState<QueueTab>('submitted');
    const [query, setQuery] = useState('');
    const trimmed = query.trim();

    const filter = useMemo(
        () => ({
            ...(tab === 'all' ? {} : { status: tab as PlatformApplicationStatus }),
            ...(trimmed === '' ? {} : { query: trimmed }),
        }),
        [tab, trimmed],
    );

    const applications = usePlatformB2bApplicationsQuery(filter);
    const rows = useMemo(
        () => (applications.data?.pages ?? []).flatMap((page) => page.items),
        [applications.data?.pages],
    );
    const failure = toFailure(applications.error);

    const columns: readonly TableColumn<PlatformB2bApplicationSummary>[] = [
        {
            key: 'company',
            header: t('platformAdmin:b2b.column.company'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Stack space="none">
                    <Text variant="bodyStrong" testID={`${applicationRowTestId(row.id)}-name`}>
                        {row.legalName ?? row.tradingName ?? t('platformAdmin:b2b.unnamed')}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {row.reference}
                    </Text>
                </Stack>
            ),
        },
        {
            key: 'country',
            header: t('platformAdmin:b2b.column.country'),
            render: (row) => <Text tone="secondary">{row.countryCode ?? '—'}</Text>,
        },
        {
            key: 'submitted',
            header: t('platformAdmin:b2b.column.submitted'),
            render: (row) => (
                <Text tone="secondary" className="tabular-nums">
                    {row.submittedAt === null ? '—' : formatter.formatDate(row.submittedAt)}
                </Text>
            ),
        },
        {
            key: 'status',
            header: t('platformAdmin:b2b.column.status'),
            render: (row) => (
                <Badge
                    testID={`${applicationRowTestId(row.id)}-status`}
                    tone={applicationStatusTone(row.status)}
                    label={t(applicationStatusKey(row.status))}
                />
            ),
        },
        {
            key: 'reviewer',
            header: t('platformAdmin:b2b.column.reviewer'),
            render: (row) => (
                <Text tone="secondary">
                    {row.reviewedBy === null
                        ? t('platformAdmin:b2b.unclaimed')
                        : t('platformAdmin:b2b.claimed')}
                </Text>
            ),
        },
    ];

    return (
        <Stack space="lg" testID="platform-b2b-applications-screen">
            <Stack space="xs">
                <Heading level={1} testID="platform-b2b-applications-title">
                    {t('platformAdmin:b2b.title')}
                </Heading>
                <Text tone="secondary">{t('platformAdmin:b2b.subtitle')}</Text>
            </Stack>

            <Card padding="md" testID="platform-b2b-applications-toolbar">
                <Stack space="sm">
                    <Tabs<QueueTab>
                        testID="platform-b2b-applications-tabs"
                        label={t('platformAdmin:b2b.tabsLabel')}
                        value={tab}
                        onChange={setTab}
                        items={TABS.map((value) => ({
                            value,
                            label:
                                value === 'all'
                                    ? t('platformAdmin:b2b.tabAll')
                                    : t(applicationStatusKey(value)),
                            testID: `platform-b2b-tab-${value}`,
                        }))}
                    />
                    <TextInputField
                        testID="platform-b2b-applications-search"
                        label={t('platformAdmin:b2b.searchLabel')}
                        placeholder={t('platformAdmin:b2b.searchPlaceholder')}
                        value={query}
                        onChangeText={setQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                </Stack>
            </Card>

            {applications.isPending ? (
                <TableSkeleton
                    testID="platform-b2b-applications-loading"
                    partTestID="platform-b2b-applications"
                    rows={4}
                />
            ) : failure !== null ? (
                <ErrorState
                    testID="platform-b2b-applications-error"
                    failure={failure}
                    onRetry={() => {
                        void applications.refetch();
                    }}
                    retrying={applications.isFetching}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    testID="platform-b2b-applications-empty"
                    title={t('platformAdmin:b2b.emptyTitle')}
                    body={
                        tab === 'submitted' && trimmed === ''
                            ? t('platformAdmin:b2b.emptyQueueBody')
                            : t('platformAdmin:b2b.emptyBody')
                    }
                />
            ) : (
                <Stack space="sm">
                    <Table<PlatformB2bApplicationSummary>
                        testID="platform-b2b-applications-table"
                        caption={t('platformAdmin:b2b.title')}
                        captionHidden
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => row.id}
                        rowAction={{
                            header: t('platformAdmin:b2b.column.company'),
                            render: (row) => (
                                <Button
                                    testID={`${applicationRowTestId(row.id)}-open`}
                                    size="sm"
                                    variant="secondary"
                                    label={t('platformAdmin:b2b.open', {
                                        reference: row.reference,
                                    })}
                                    onPress={() => {
                                        router.push(platformB2bApplicationHref(row.id) as never);
                                    }}
                                />
                            ),
                        }}
                    />

                    {applications.hasNextPage ? (
                        <Button
                            testID="platform-b2b-applications-more"
                            variant="secondary"
                            label={t('platformAdmin:kitchens.loadMore')}
                            loading={applications.isFetchingNextPage}
                            onPress={() => {
                                void applications.fetchNextPage();
                            }}
                        />
                    ) : null}
                </Stack>
            )}
        </Stack>
    );
}
