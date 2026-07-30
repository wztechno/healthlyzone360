import { useLocalSearchParams } from 'expo-router';

import { KitchenProfileScreen } from '../../../../src/features/marketplace/screens/kitchen-profile-screen.tsx';

/**
 * `/kitchens/{kitchen}` — one kitchen's profile.
 *
 * No `generateStaticParams`: pre-rendering a subset would bake fixture identifiers into the export,
 * and the static server already falls back to the application shell for extension-less paths, so a
 * deep link resolves client-side. The route parameter is validated in the screen rather than here —
 * an unparseable identifier is a data state, not a routing error.
 */
export default function KitchenProfile() {
    const { kitchen } = useLocalSearchParams<{ kitchen?: string }>();
    return <KitchenProfileScreen kitchenId={kitchen} />;
}
