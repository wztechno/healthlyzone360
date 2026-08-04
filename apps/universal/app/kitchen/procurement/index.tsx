import { Stack, Text } from '@healthy360/design-system';

export default function KitchenProcurement() {
    return (
        <Stack space="md" className="p-4" testID="kitchen-procurement">
            <Text variant="heading">Procurement</Text>
            <Text tone="secondary">Suppliers and goods receipts that post into stock.</Text>
        </Stack>
    );
}
