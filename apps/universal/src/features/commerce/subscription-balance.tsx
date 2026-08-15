import { Badge, Card, Heading, Inline, Stack, Table, Text } from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import type { SubscriptionBalance, SubscriptionDelivery } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { formatMoney } from '../marketplace/format.ts';

/**
 * The balance, and the ledger behind it.
 *
 * ## Why the ledger is shown at all
 *
 * A balance is a number, and a number about somebody's money is worth nothing without the rows that
 * produced it. "Six of twenty days left" invites exactly one question — *what happened to the other
 * fourteen?* — and the honest answer is a list: eleven delivered, three skipped and costing nothing.
 * The skipped rows are the point. The approved semantics say a skip consumes no balance (§1), and a
 * screen that only ever showed the total would give a person no way to check that promise was kept.
 *
 * ## The per-day price is stated, not implied
 *
 * `perDayPrice` is the effective rate after the duration discount, and it is printed beside the
 * remaining count because it is the multiplicand in any future refund. Somebody looking at a
 * cancellation dialog should be able to do the arithmetic themselves before they press the button,
 * and this card is where the two numbers they need already are.
 */

export interface SubscriptionBalanceCardProps {
    readonly balance: SubscriptionBalance;
    readonly testID?: string | undefined;
}

export function SubscriptionBalanceCard({
    balance,
    testID = 'subscription-balance',
}: SubscriptionBalanceCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Card padding="md" testID={testID}>
            <Stack space="sm">
                <Text variant="label">{t('commerce:balance.title')}</Text>

                <Inline space="lg" wrap>
                    <Stack space="xs">
                        <Heading level={3} testID={`${testID}-remaining`}>
                            {t('commerce:balance.remaining', { count: balance.days.remaining })}
                        </Heading>
                        <Text tone="secondary" variant="caption" testID={`${testID}-used`}>
                            {t('commerce:balance.used', {
                                consumed: balance.days.consumed,
                                total: balance.days.total,
                            })}
                        </Text>
                    </Stack>

                    <Stack space="xs">
                        <Text variant="bodyStrong" testID={`${testID}-per-day`}>
                            {formatMoney(formatter, balance.perDayPrice)}
                        </Text>
                        <Text tone="secondary" variant="caption">
                            {t('commerce:balance.perDay')}
                        </Text>
                    </Stack>
                </Inline>

                {/*
                 * Skipped days are surfaced beside the balance rather than only in the ledger,
                 * because "three skips cost you nothing" is the single sentence that explains why
                 * the two numbers above do not add up the way a calendar would suggest.
                 */}
                {balance.skippedDays === 0 ? null : (
                    <Text tone="secondary" variant="caption" testID={`${testID}-skipped`}>
                        {t('commerce:balance.skipped', { count: balance.skippedDays })}
                    </Text>
                )}

                <Text tone="secondary" variant="caption" testID={`${testID}-cutoff`}>
                    {t('commerce:balance.cutOffNote', { count: balance.changeCutoffHours })}
                </Text>
            </Stack>
        </Card>
    );
}

/** Ledger statuses that cost a day. Everything else is free, and the badge tone says so. */
function deliveryTone(delivery: SubscriptionDelivery): 'success' | 'warning' | 'neutral' | 'info' {
    if (delivery.status === 'delivered' || delivery.status === 'generated') return 'success';
    if (delivery.status === 'cancelled') return 'neutral';
    return delivery.status.startsWith('skipped_') ? 'warning' : 'info';
}

export interface SubscriptionDeliveriesProps {
    readonly deliveries: readonly SubscriptionDelivery[];
    readonly testID?: string | undefined;
}

export function SubscriptionDeliveries({
    deliveries,
    testID = 'subscription-deliveries',
}: SubscriptionDeliveriesProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    // `Table` renders a column's return value straight into a `View`, so a bare string would be an
    // invariant violation on native. Every cell is a `Text` or a `Badge`.
    const columns: readonly TableColumn<SubscriptionDelivery>[] = [
        {
            key: 'date',
            header: t('commerce:deliveries.columns.date'),
            rowHeader: true,
            render: (row) => <Text>{formatter.formatDate(row.date, { dateStyle: 'medium' })}</Text>,
        },
        {
            key: 'status',
            header: t('commerce:deliveries.columns.status'),
            render: (row) => (
                <Badge
                    tone={deliveryTone(row)}
                    label={t(`commerce:deliveries.statuses.${row.status}`)}
                    testID={`${testID}-status-${row.date}`}
                />
            ),
        },
        {
            key: 'consumed',
            header: t('commerce:deliveries.columns.consumed'),
            render: (row) => (
                <Text tone={row.consumed ? 'primary' : 'secondary'}>
                    {row.consumed
                        ? t('commerce:deliveries.consumedYes')
                        : t('commerce:deliveries.consumedNo')}
                </Text>
            ),
        },
    ];

    return (
        <Stack space="sm" testID={testID}>
            <Inline space="sm" align="center" justify="between">
                <Text variant="label">{t('commerce:deliveries.title')}</Text>
                <Text tone="secondary" variant="caption" testID={`${testID}-count`}>
                    {t('commerce:deliveries.count', { count: deliveries.length })}
                </Text>
            </Inline>

            {deliveries.length === 0 ? (
                <Text tone="secondary" testID={`${testID}-empty`}>
                    {t('commerce:deliveries.empty')}
                </Text>
            ) : (
                <Table
                    testID={`${testID}-table`}
                    caption={t('commerce:deliveries.caption')}
                    captionHidden
                    columns={columns}
                    rows={[...deliveries]}
                    rowKey={(row) => row.id}
                />
            )}

            {/*
             * The one sentence the whole ledger exists to make checkable. It is copy rather than a
             * computed claim: the rows above are the evidence, and this says what to look for.
             */}
            <Text tone="secondary" variant="caption" testID={`${testID}-note`}>
                {t('commerce:deliveries.skipNote')}
            </Text>
        </Stack>
    );
}

/** Shared by the balance card and the cancellation dialog, so one refund is formatted one way. */
export function formatPerDay(formatter: Formatter, balance: SubscriptionBalance): string {
    return formatMoney(formatter, balance.perDayPrice);
}
