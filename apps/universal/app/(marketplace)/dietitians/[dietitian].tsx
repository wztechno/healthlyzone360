import { useLocalSearchParams } from 'expo-router';

import { DietitianProfileScreen } from '../../../src/features/marketplace/screens/dietitian-profile-screen.tsx';

/** `/dietitians/{dietitian}` — one professional's public profile. */
export default function DietitianProfile() {
    const { dietitian } = useLocalSearchParams<{ dietitian?: string }>();
    return <DietitianProfileScreen dietitianId={dietitian} />;
}
