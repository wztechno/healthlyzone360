import { useLocalSearchParams } from 'expo-router';

import { SubscriptionConfiguratorScreen } from '../../../src/features/commerce/screens/subscription-configurator-screen.tsx';

/**
 * `/customer/subscriptions/new?plan={plan}&variant={variant}` — the eight-step configurator.
 *
 * A static segment sitting beside `[subscription].tsx`: Expo Router prefers the static match, so
 * `new` is never read as a subscription identifier. Both parameters are validated in the screen, so
 * a hand-typed link produces the designed not-found state rather than a repository failure.
 */
export default function NewSubscription() {
    const { plan, variant } = useLocalSearchParams<{ plan?: string; variant?: string }>();
    return <SubscriptionConfiguratorScreen planId={plan} variantId={variant} />;
}
