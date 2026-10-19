import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/account/phone` — add a mobile number, or confirm the one already on file.
 *
 * `?returnTo=` is the page that sent the person here, which the screen goes back to once the number
 * is confirmed; `?challenge=` is the code challenge in flight, so a refresh does not send a new code.
 */
const PhoneScreen = lazyScreen(
    'account-phone-loading',
    async () => (await import('../../../src/features/account/screens/index.ts')).PhoneScreen,
);

export default function CustomerAccountPhone() {
    const { returnTo, challenge } = useLocalSearchParams<{
        returnTo?: string;
        challenge?: string;
    }>();
    return <PhoneScreen returnTo={returnTo} challengeId={challenge} />;
}
