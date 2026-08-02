import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/customer/subscriptions/{subscription}` — one subscription, and the five ways to change it. */
const SubscriptionDetailScreen = lazyScreen(
    'subscription-detail-loading',
    async () =>
        (await import('../../../src/features/commerce/screens/index.ts')).SubscriptionDetailScreen,
);

export default function SubscriptionDetail() {
    const { subscription } = useLocalSearchParams<{ subscription?: string }>();
    return <SubscriptionDetailScreen subscriptionId={subscription} />;
}
