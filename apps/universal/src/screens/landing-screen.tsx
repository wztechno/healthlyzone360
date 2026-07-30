import { Card, ErrorState, Heading, Spinner, Stack, Text } from '@healthy360/design-system';
import { apiFailure } from '@healthy360/api-client';
import { resolveLandingRoute } from '@healthy360/permissions';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAccessState, useSession } from '../session/session-provider.tsx';

/**
 * The `/` route: session restoration, then a redirect.
 *
 * Where a launching application should land is decided by `resolveLandingRoute` in
 * `@healthy360/permissions` — the same ordering the gates use, so the splash and the guards can
 * never disagree about, say, whether an unverified user should see the organisation picker.
 *
 * A repository *construction* failure is rendered here rather than swallowed. In practice that
 * means the mock-in-production guard (plan §18 gate #2), and a build that trips it must say so
 * loudly on its very first screen.
 */
export function LandingScreen() {
    const { t } = useTranslation();
    const accessState = useAccessState();
    const { repositoryError } = useSession();

    if (repositoryError !== null) {
        return (
            <Stack testID="landing-screen" space="lg" className="p-4">
                <Heading level={1}>{t('errors:generic.title')}</Heading>
                <ErrorState
                    testID="repository-error"
                    failure={apiFailure('server', { message: repositoryError.message })}
                />
            </Stack>
        );
    }

    const landing = resolveLandingRoute(accessState);

    if (landing.reason === 'session_restoring') {
        return (
            <Stack
                testID="landing-screen"
                space="md"
                align="center"
                justify="center"
                className="flex-1 p-8"
            >
                <Card padding="lg" tone="raised">
                    <Spinner
                        testID="session-restoring"
                        size="large"
                        showLabel
                        label={t('common:state.restoringSession')}
                    />
                    <Text tone="secondary" align="center">
                        {t('common:app.name')}
                    </Text>
                </Card>
            </Stack>
        );
    }

    return <Redirect href={landing.href as never} />;
}
