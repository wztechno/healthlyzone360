import { Button, Card, Heading, Stack, Text } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { PrototypeScreen } from '../../src/screens/prototype-screen.tsx';

/**
 * Platform administration is a prototype like every other unbuilt area — but it *does* own one
 * real screen, the design-system showcase, so the index links to it rather than leaving the only
 * functional page in the area unreachable.
 */
export default function PlatformAdminIndex() {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <Stack space="lg">
            <Card padding="md" testID="platform-admin-tools">
                <Heading level={2}>{t('common:nav.showcase')}</Heading>
                <Text tone="secondary">{t('designSystem:showcase.subtitle')}</Text>
                <Button
                    testID="platform-admin-showcase-link"
                    label={t('common:nav.showcase')}
                    onPress={() => {
                        router.push('/platform-admin/showcase');
                    }}
                />
            </Card>

            <PrototypeScreen area="platform-admin" testID="prototype-platform-admin" />
        </Stack>
    );
}
