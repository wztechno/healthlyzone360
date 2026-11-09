import type { KitchenSetupStep } from '@healthy360/api-client/contracts';
import { Stack, Text } from '@healthy360/design-system';
import { View } from 'react-native';

import { SetupRoad } from '../features/kitchen-admin/setup/setup-road.tsx';

const steps = (done: number): readonly KitchenSetupStep[] =>
    (['hours', 'delivery', 'menu', 'prices'] as const).map((key, index) => ({
        key,
        required: true,
        done: index < done,
    }));

const noop = () => undefined;

/** `/showcase-setup-road` — the road to opening, in each state it can be in. */
export function SetupRoadShowcaseScreen() {
    return (
        <View className="mx-auto w-full max-w-5xl p-6">
            <Stack space="lg">
                <Text variant="title">Two steps left</Text>
                <SetupRoad steps={steps(2)} isLive={false} onOpen={noop} testID="road-progress" />
                <Text variant="title">Ready to open</Text>
                <SetupRoad steps={steps(4)} isLive={false} onOpen={noop} testID="road-ready" />
                <Text variant="title">Open</Text>
                <SetupRoad steps={steps(4)} isLive onOpen={noop} testID="road-live" />
            </Stack>
        </View>
    );
}
