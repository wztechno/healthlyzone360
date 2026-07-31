import { useLocalSearchParams } from 'expo-router';

import { CorporateCatalogueScreen } from '../../../src/features/business/screens/corporate-catalogue-screen.tsx';

/**
 * `/corporate/catalogue/{programme}` — one programme's negotiated lines, priced.
 *
 * The identifier is validated in the screen, so a hand-typed link produces the designed not-found
 * state rather than a repository failure.
 */
export default function CorporateCatalogue() {
    const { programmeId } = useLocalSearchParams<{ programmeId?: string }>();
    return <CorporateCatalogueScreen programmeId={programmeId} />;
}
