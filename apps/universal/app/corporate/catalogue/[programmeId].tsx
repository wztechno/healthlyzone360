import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/corporate/catalogue/{programme}` — one programme's negotiated lines, priced.
 *
 * The identifier is validated in the screen, so a hand-typed link produces the designed not-found
 * state rather than a repository failure.
 */
const CorporateCatalogueScreen = lazyScreen(
    'corporate-catalogue-loading',
    async () =>
        (await import('../../../src/features/business/screens/index.ts')).CorporateCatalogueScreen,
);

export default function CorporateCatalogue() {
    const { programmeId } = useLocalSearchParams<{ programmeId?: string }>();
    return <CorporateCatalogueScreen programmeId={programmeId} />;
}
