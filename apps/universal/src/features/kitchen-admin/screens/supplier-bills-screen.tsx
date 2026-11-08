import { Stack, Tabs } from '@healthy360/design-system';
import type { TabItem } from '@healthy360/design-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { INVENTORY_VIEW_COSTS_PERMISSION } from '../entity-registry.ts';
import { PayablesScreen } from './payables-screen.tsx';
import { UnpricedReceiptsScreen } from './unpriced-receipts-screen.tsx';

type SupplierBillsTab = 'unpriced' | 'bills';

/**
 * `/kitchen/supplier-bills` — a delivery's paperwork from price to payment: the receipts still
 * waiting on their prices, then what is owed. `?tab=` picks the tab; each tab is the old screen,
 * unchanged, behind its own `<Gate>`. Both ask for the cost code, so there is no per-tab split, and
 * a `?tab=` this page does not know lands on the first.
 */
export function SupplierBillsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_COSTS_PERMISSION] }}
            testID="kitchen-supplier-bills"
        >
            <SupplierBills />
        </Gate>
    );
}

function SupplierBills() {
    const { t } = useTranslation();
    const router = useRouter();
    const params = useLocalSearchParams<{ tab?: string }>();

    const items: TabItem<SupplierBillsTab>[] = [
        {
            value: 'unpriced',
            label: t('kitchen:supplierBills.tab.unpriced'),
            testID: 'kitchen-supplier-bills-tab-unpriced',
        },
        {
            value: 'bills',
            label: t('kitchen:supplierBills.tab.bills'),
            testID: 'kitchen-supplier-bills-tab-bills',
        },
    ];
    const tab = params.tab === 'bills' ? 'bills' : 'unpriced';

    return (
        <Stack space="md" testID="kitchen-supplier-bills-screen">
            <Tabs<SupplierBillsTab>
                label={t('kitchen:families.supplierBills.name')}
                value={tab}
                onChange={(value) => {
                    router.setParams({ tab: value });
                }}
                items={items}
            />
            {tab === 'unpriced' ? <UnpricedReceiptsScreen /> : <PayablesScreen />}
        </Stack>
    );
}
