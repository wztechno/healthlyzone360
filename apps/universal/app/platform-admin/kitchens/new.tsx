import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/platform-admin/kitchens/new` — bring a kitchen onto the platform.
 *
 * A static segment beside `[kitchen].tsx`, which expo-router resolves in favour of the static one,
 * so no kitchen may ever have the slug `new` — a constraint worth naming rather than discovering.
 */
const CreateKitchenScreen = lazyScreen(
    'platform-admin-create-loading',
    async () =>
        (await import('../../../src/features/platform-admin/screens/index.ts')).CreateKitchenScreen,
);

export default function PlatformAdminCreateKitchen() {
    return <CreateKitchenScreen />;
}
