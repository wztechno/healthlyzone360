import { useLocalSearchParams } from 'expo-router';

import { LegalScreen } from '../../../src/features/legal/legal-pages.tsx';

/** `/legal/<slug>` — a published legal page. None is published yet: see `legal-pages.tsx`. */
export default function Legal() {
    const { page } = useLocalSearchParams<{ page?: string }>();
    return <LegalScreen slug={page} />;
}
