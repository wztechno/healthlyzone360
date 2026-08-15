import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/customer/subscriptions` — every subscription this person has, live or finished. */
const SubscriptionsScreen = lazyScreen(
    'subscriptions-loading',
    async () =>
        (await import('../../../src/features/commerce/screens/index.ts')).SubscriptionsScreen,
);

export default function CustomerSubscriptions() {
    return <SubscriptionsScreen />;
}
