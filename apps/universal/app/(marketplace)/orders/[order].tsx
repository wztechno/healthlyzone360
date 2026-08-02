import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/orders/{order}` — a guest order confirmation, by its human reference.
 *
 * Public, because the person reading it has no account by definition. What protects it is the
 * reference, which the real generator makes unguessable; the mock's sequential one is a fixture
 * convenience and says so in `mock/guest/ids.ts`.
 *
 * The parameter is the **reference** (`H360-G1000`), not the identifier: it is what a person is
 * given, writes down and reads over a phone, and a URL carrying a UUID would be one nobody can
 * repeat.
 */
const GuestOrderScreen = lazyScreen(
    'guest-order-loading',
    async () => (await import('../../../src/features/guest/screens/index.ts')).GuestOrderScreen,
);

export default function GuestOrder() {
    const { order } = useLocalSearchParams<{ order?: string }>();
    return <GuestOrderScreen reference={order} />;
}
