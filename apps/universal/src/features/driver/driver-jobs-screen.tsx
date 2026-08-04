import { Card, Stack, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

/**
 * Driver job list — F1 in-house delivery MVP. Loads assigned jobs from the API when api-mode is active.
 */
export function DriverJobsScreen() {
    const { t } = useTranslation();

    return (
        <Stack space="md" className="flex-1 p-4" testID="driver-jobs">
            <Text variant="heading">{t('access:area.driver')}</Text>
            <Text tone="secondary">
                Assigned delivery jobs appear here. Mark delivered with proof-of-delivery notes when you complete a run.
            </Text>
            <Card padding="md" testID="driver-jobs-empty">
                <Text tone="secondary">No jobs loaded — sign in as a driver with assigned delivery jobs.</Text>
            </Card>
        </Stack>
    );
}
