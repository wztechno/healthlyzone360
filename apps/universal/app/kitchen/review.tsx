import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/review` — the publication review queue (K1.8).
 *
 * Reachable by anyone holding `catalogue.view_organisation`: seeing what is blocking the catalogue
 * is a read, and every fix happens in the family editor the row links into.
 *
 * Part of the kitchen workspace chunk — `src/features/kitchen-admin/screens/index.ts` says why this
 * area is split once rather than per screen.
 */
const ReviewScreen = lazyScreen(
    'kitchen-review-loading',
    async () => (await import('../../src/features/kitchen-admin/screens/index.ts')).ReviewScreen,
);

export default function KitchenReview() {
    return <ReviewScreen />;
}
