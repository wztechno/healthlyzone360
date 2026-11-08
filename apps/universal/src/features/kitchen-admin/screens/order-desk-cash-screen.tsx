import { Stack, Tabs } from '@healthy360/design-system';
import type { TabItem } from '@healthy360/design-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { ORDER_MANAGE_PERMISSION, ORDER_SETTLE_CASH_PERMISSION } from '../entity-registry.ts';
import { OrderDeskCashReportScreen } from './order-desk-cash-report-screen.tsx';
import { OrderDeskCloseScreen } from './order-desk-close-screen.tsx';
import { OrderDeskSettlementScreen } from './order-desk-settlement-screen.tsx';

type CashTab = 'taken' | 'handins' | 'close';

/**
 * `/kitchen/order-desk/cash` — the day's money on one page: what was taken, what came back from the
 * road, and the till count. `?tab=` picks the tab; each tab is the old screen, unchanged, behind its
 * own `<Gate>`. A tab the session may not open is not offered, and asking for it by URL lands on the
 * first one it may.
 */
export function OrderDeskCashScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ anyOf: [ORDER_MANAGE_PERMISSION, ORDER_SETTLE_CASH_PERMISSION] }}
            testID="kitchen-order-desk-cash"
        >
            <OrderDeskCash />
        </Gate>
    );
}

function OrderDeskCash() {
    const { t } = useTranslation();
    const router = useRouter();
    const params = useLocalSearchParams<{ tab?: string }>();
    const canManage = useCan(ORDER_MANAGE_PERMISSION);
    const canSettle = useCan(ORDER_SETTLE_CASH_PERMISSION);

    const items: TabItem<CashTab>[] = [
        ...(canManage
            ? [
                  {
                      value: 'taken' as const,
                      label: t('kitchen:cash.tab.taken'),
                      testID: 'kitchen-cash-tab-taken',
                  },
              ]
            : []),
        ...(canSettle
            ? [
                  {
                      value: 'handins' as const,
                      label: t('kitchen:cash.tab.handins'),
                      testID: 'kitchen-cash-tab-handins',
                  },
                  {
                      value: 'close' as const,
                      label: t('kitchen:cash.tab.close'),
                      testID: 'kitchen-cash-tab-close',
                  },
              ]
            : []),
    ];
    // The gate guarantees at least one item.
    const tab = items.find((item) => item.value === params.tab)?.value ?? items[0]?.value;

    return (
        <Stack space="md" testID="kitchen-cash-screen">
            <Tabs<CashTab>
                label={t('kitchen:families.cash.name')}
                value={tab ?? 'taken'}
                onChange={(value) => {
                    router.setParams({ tab: value });
                }}
                items={items}
            />
            {tab === 'taken' ? <OrderDeskCashReportScreen /> : null}
            {tab === 'handins' ? <OrderDeskSettlementScreen /> : null}
            {tab === 'close' ? <OrderDeskCloseScreen /> : null}
        </Stack>
    );
}
