import { Tag } from '@healthy360/design-system';
import type { TagTone } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import { isBlockingReason, reviewReasonKey } from '../review-queue.ts';
import type { ReviewReason } from '../review-queue.ts';

/**
 * One review reason as a pill (Workbench handoff §2.3). The tone is **derived, never passed**.
 *
 * - `danger` — a blocking reason, as `review-queue.ts` defines blocking: `quarantined` and
 *   `inconsistentPrices`. The handoff's §3.2 lists the price rule as a warning; the queue's own
 *   docblock says the publish gate refuses it for the same kind of reason as a quarantine, and the
 *   section's `N blocked` badge already counts it as blocked. A warning chip on a row counted as
 *   blocked would be the screen contradicting itself, so the model wins.
 * - `info` — `dataQuality`: import findings are information to act on, not a gap in the record.
 * - `warning` — everything else: work to finish.
 *
 * Every chip carries the reason's full sentence. The tone is never the message.
 */
function reasonTone(reason: ReviewReason): TagTone {
    if (isBlockingReason(reason.code)) return 'danger';
    if (reason.code === 'dataQuality') return 'info';
    return 'warning';
}

export function ReviewReasonChip({
    reason,
    testID,
}: {
    readonly reason: ReviewReason;
    readonly testID?: string | undefined;
}) {
    const { t } = useTranslation();

    return (
        <Tag
            testID={testID}
            tone={reasonTone(reason)}
            label={t(reviewReasonKey(reason.code), { count: reason.count ?? 1 })}
        />
    );
}
