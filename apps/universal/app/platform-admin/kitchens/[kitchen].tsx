import { Redirect, useLocalSearchParams } from 'expo-router';

import { platformKitchenHref } from '../../../src/features/platform-admin/platform-admin-chrome.tsx';

/**
 * `/platform-admin/kitchens/{kitchen}` — kept so old links still land. A kitchen opens as the
 * record pop-up over the Kitchens list (Platform admin canvas, 2026-11-23), so this hands over to
 * `/platform-admin?view={kitchen}`.
 */
export default function PlatformAdminKitchen() {
    const { kitchen } = useLocalSearchParams<{ kitchen?: string }>();
    return <Redirect href={platformKitchenHref(kitchen ?? '') as never} />;
}
