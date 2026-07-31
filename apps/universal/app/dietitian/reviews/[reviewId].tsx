import { useLocalSearchParams } from 'expo-router';

import { ReviewDetailScreen } from '../../../src/features/professional/screens/review-detail-screen.tsx';

/** `/dietitian/reviews/{review}` — everything needed before deciding, and the decision. */
export default function DietitianReview() {
    const { reviewId } = useLocalSearchParams<{ reviewId?: string }>();
    return <ReviewDetailScreen reviewId={reviewId} />;
}
