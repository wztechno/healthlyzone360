import { Stack, Text } from '@healthy360/design-system';

export default function KitchenStock() {
    return (
        <Stack space="md" className="p-4" testID="kitchen-stock">
            <Text variant="heading">Stock</Text>
            <Text tone="secondary">Branch stock levels and adjustments — served from the inventory API.</Text>
        </Stack>
    );
}
