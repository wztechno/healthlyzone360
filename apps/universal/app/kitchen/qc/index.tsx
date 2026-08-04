import { Stack, Text } from '@healthy360/design-system';

export default function KitchenQc() {
    return (
        <Stack space="md" className="p-4" testID="kitchen-qc">
            <Text variant="heading">Quality control</Text>
            <Text tone="secondary">Hold and release checks on receipts and batches.</Text>
        </Stack>
    );
}
