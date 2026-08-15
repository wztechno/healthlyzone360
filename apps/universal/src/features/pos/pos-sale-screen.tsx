import { Button, Card, Heading, Stack, Text } from '@healthy360/design-system';
import { useState } from 'react';

/**
 * Online-only POS MVP (ADR-0012). COD and sandbox card — no offline queue.
 */
export function PosSaleScreen() {
    const [status, setStatus] = useState<string | null>(null);

    return (
        <Stack space="md" className="flex-1 p-4" testID="pos-sale">
            <Heading level={1}>Point of sale</Heading>
            <Text tone="secondary">
                Online counter sale. Choose cash on delivery or card sandbox when recording a sale
                through the kitchen API.
            </Text>
            <Card padding="md">
                <Stack space="sm">
                    <Button
                        testID="pos-cod-hint"
                        label="Cash on delivery"
                        onPress={() => setStatus('cod')}
                    />
                    <Button
                        testID="pos-card-hint"
                        label="Card sandbox"
                        onPress={() => setStatus('card')}
                    />
                </Stack>
            </Card>
            {status !== null ? <Text testID="pos-selected-method">Selected: {status}</Text> : null}
        </Stack>
    );
}
