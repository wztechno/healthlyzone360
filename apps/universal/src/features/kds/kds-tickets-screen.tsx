import { Card, Stack, Text } from '@healthy360/design-system';

/**
 * KDS ticket rail — online-only (ADR-0012). Tickets bump through new → preparing → ready → bumped.
 */
export function KdsTicketsScreen() {
    return (
        <Stack space="md" className="flex-1 p-4" testID="kds-tickets">
            <Text variant="heading">Kitchen display</Text>
            <Text tone="secondary">Live tickets from orders and production batches. Requires network connectivity.</Text>
            <Card padding="md">
                <Text tone="secondary" testID="kds-tickets-empty">No tickets in queue.</Text>
            </Card>
        </Stack>
    );
}
