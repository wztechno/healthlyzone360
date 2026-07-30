import { useLocalSearchParams } from 'expo-router';

import { KitchenMenuScreen } from '../../../../src/features/marketplace/screens/kitchen-menu-screen.tsx';

/** `/kitchens/{kitchen}/menu` — that kitchen's consumer menu. */
export default function KitchenMenu() {
    const { kitchen } = useLocalSearchParams<{ kitchen?: string }>();
    return <KitchenMenuScreen kitchenId={kitchen} />;
}
