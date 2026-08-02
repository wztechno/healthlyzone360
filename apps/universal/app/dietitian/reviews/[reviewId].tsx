import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/dietitian/reviews/{review}` — everything needed before deciding, and the decision. */
const ReviewDetailScreen = lazyScreen(
    'dietitian-review-loading',
    async () =>
        (await import('../../../src/features/professional/screens/index.ts')).ReviewDetailScreen,
);

export default function DietitianReview() {
    const { reviewId } = useLocalSearchParams<{ reviewId?: string }>();
    return <ReviewDetailScreen reviewId={reviewId} />;
}
