import { Card, Heading, Text } from '@healthy360/design-system';
import type { OrderDeskTodayAmount } from '@healthy360/api-client/contracts';
import type { BranchId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Can, useCan } from '../../access/gate.tsx';
import { useOrderDeskTodayQuery } from '../../data/order-desk-hooks.ts';
import { formatMoney } from '../marketplace/format.ts';
import { CatalogueStatCards } from './catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from './catalogue/catalogue-stat-cards.tsx';
import { ORDER_MANAGE_PERMISSION, ORDER_SETTLE_CASH_PERMISSION } from './entity-registry.ts';
import { ordersHref } from './orders/orders-url.ts';

/**
 * The kitchen home's Today card (owner, 3 Nov): sales and orders, cash to collect, late orders and
 * cancellations, on the cash report's local day. Behind the cash report's own code: `Can`, not the
 * route `Gate`, so somebody without it sees the rest of the home and no card.
 *
 * The frame is the home's Go to card; the figures are `CatalogueStatCards`. Polls every minute.
 */
export function TodayCard({ branchId }: { readonly branchId: BranchId | null }) {
    return (
        <Can permission={ORDER_MANAGE_PERMISSION}>
            <TodayFigures branchId={branchId} />
        </Can>
    );
}

function TodayFigures({ branchId }: { readonly branchId: BranchId | null }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    // The till count is the settle-cash tab; without that grant the figure stays a figure.
    const canCountTill = useCan(ORDER_SETTLE_CASH_PERMISSION);
    const today = useOrderDeskTodayQuery(branchId);
    const data = today.data;

    /** One figure per currency, side by side; never one sum across two. */
    const money = (amounts: readonly OrderDeskTodayAmount[] | undefined) =>
        amounts === undefined || amounts.length === 0
            ? '—'
            : amounts
                  .map((row) =>
                      formatMoney(formatter, {
                          amount: row.amountMinor,
                          currency: row.currencyCode,
                      }),
                  )
                  .join(' · ');
    const count = (value: number | undefined) =>
        value === undefined ? '—' : formatter.formatNumber(value);
    const cancelled = data?.cancelled;
    const late = data?.overdue ?? 0;

    const cards: CatalogueStatCard[] = [
        {
            key: 'sales',
            label: t('kitchen:hub.today.sales'),
            value: money(data?.sales),
            caption: t('kitchen:hub.today.orders', { value: count(data?.orders) }),
            mark: 'receipt',
        },
        {
            key: 'cash',
            label: t('kitchen:hub.today.cash'),
            value: money(data?.cashExpected),
            caption: t('kitchen:hub.today.counted', { amount: money(data?.cashCounted) }),
            mark: 'coins',
            ...(canCountTill
                ? {
                      accessibilityLabel: t('kitchen:hub.today.openClose'),
                      onPress: () => {
                          router.push('/kitchen/order-desk/cash?tab=close' as never);
                      },
                  }
                : {}),
        },
        {
            key: 'late',
            label: t('kitchen:hub.today.late'),
            value: count(data?.overdue),
            caption: t('kitchen:hub.today.pastDue', { value: count(data?.pastDue) }),
            mark: 'clock',
            tone: late > 0 ? 'warning' : 'default',
            accessibilityLabel: t('kitchen:hub.today.openPastDue'),
            onPress: () => {
                router.push(ordersHref({ tab: 'all', quick: 'late' }) as never);
            },
        },
        {
            key: 'cancelled',
            label: t('kitchen:hub.today.cancelled'),
            value:
                cancelled === undefined
                    ? '—'
                    : formatter.formatNumber(
                          cancelled.returned + cancelled.wasted + cancelled.other,
                      ),
            caption:
                cancelled === undefined
                    ? undefined
                    : t('kitchen:hub.today.cancelledSplit', {
                          returned: formatter.formatNumber(cancelled.returned),
                          wasted: formatter.formatNumber(cancelled.wasted),
                          other: formatter.formatNumber(cancelled.other),
                      }),
            mark: 'ban',
        },
    ];

    return (
        <Card
            testID="kitchen-home-today"
            padding="sm"
            tone="raised"
            className="min-w-0 gap-2 border-stroke-subtle"
        >
            <Heading level={2}>{t('kitchen:hub.today.title')}</Heading>
            {today.isError && data === undefined ? (
                <Text tone="secondary" testID="kitchen-home-today-error">
                    {t('kitchen:hub.countUnavailable')}
                </Text>
            ) : null}
            <CatalogueStatCards
                testID="kitchen-home-today-figures"
                cards={cards}
                pending={today.isPending}
            />
        </Card>
    );
}
