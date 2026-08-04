import { Stack, Text } from '@healthy360/design-system';

export default function KitchenProduction() {
    return (
        <Stack space="md" className="p-4" testID="kitchen-production">
            <Text variant="heading">Production</Text>
            <Text tone="secondary">Production orders from recipe versions.</Text>
        </Stack>
    );
}
