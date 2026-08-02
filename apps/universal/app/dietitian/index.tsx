import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/** `/dietitian` — everything waiting for a professional decision. */
const ReviewQueueScreen = lazyScreen(
    'dietitian-reviews-loading',
    async () =>
        (await import('../../src/features/professional/screens/index.ts')).ReviewQueueScreen,
);

export default function DietitianIndex() {
    return <ReviewQueueScreen />;
}
