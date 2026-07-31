import { useLocalSearchParams } from 'expo-router';

import { SubscriptionDetailScreen } from '../../../src/features/commerce/screens/subscription-detail-screen.tsx';

/** `/customer/subscriptions/{subscription}` — one subscription, and the five ways to change it. */
export default function SubscriptionDetail() {
    const { subscription } = useLocalSearchParams<{ subscription?: string }>();
    return <SubscriptionDetailScreen subscriptionId={subscription} />;
}
