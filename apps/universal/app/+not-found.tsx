import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { NotFoundScreen } from '../src/screens/not-found-screen.tsx';

/**
 * An address no route matches. The page itself — in the shop's chrome, with Back and the
 * marketplace home — is `NotFoundScreen` (AUTH-18).
 */
export default function NotFound() {
    const { t } = useTranslation();

    return (
        <>
            <Stack.Screen options={{ title: t('access:notFound.title') }} />
            <NotFoundScreen />
        </>
    );
}
