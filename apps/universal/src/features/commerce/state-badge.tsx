import { Badge } from '@healthy360/design-system';
import type { BadgeTone, IconName } from '@healthy360/design-system';
import type { SubscriptionState } from '@healthy360/domain-types';
import { useTranslation } from 'react-i18next';

/**
 * The subscription state, as a badge.
 *
 * All six of `SUBSCRIPTION_STATES` have an entry, and the mapping is exhaustive by type rather than
 * by a default branch: adding a seventh state to the domain vocabulary should fail the compiler
 * here, not render an unlabelled grey pill in production.
 *
 * Each state pairs a tone with an **icon and a word**, never colour alone. "Paused" and "cancelled"
 * are both non-delivering and would be indistinguishable to a reader who cannot separate amber from
 * red — and the difference between them is whether the person still has a subscription.
 */
interface StateAppearance {
    readonly tone: BadgeTone;
    readonly icon: IconName;
}

const APPEARANCE: Readonly<Record<SubscriptionState, StateAppearance>> = {
    draft: { tone: 'neutral', icon: 'dotOutline' },
    active: { tone: 'success', icon: 'success' },
    paused: { tone: 'warning', icon: 'offline' },
    skipped_today: { tone: 'info', icon: 'info' },
    cancelled: { tone: 'danger', icon: 'close' },
    expired: { tone: 'neutral', icon: 'offline' },
};

/** States in which nothing may be changed. The detail screen renders read-only for these. */
export function isTerminalSubscriptionState(state: SubscriptionState): boolean {
    return state === 'cancelled' || state === 'expired';
}

/** States the repository will accept a pause or a skip from (`store.ts`, `#transition`). */
export function canPauseOrSkip(state: SubscriptionState): boolean {
    return state === 'active' || state === 'skipped_today';
}

/** Resume is accepted from `paused` and nowhere else. */
export function canResume(state: SubscriptionState): boolean {
    return state === 'paused';
}

/** Address and slot changes are accepted from any live or paused state. */
export function canChangeDelivery(state: SubscriptionState): boolean {
    return state === 'active' || state === 'paused' || state === 'skipped_today';
}

export interface SubscriptionStateBadgeProps {
    readonly state: SubscriptionState;
    readonly testID?: string | undefined;
}

export function SubscriptionStateBadge({ state, testID }: SubscriptionStateBadgeProps) {
    const { t } = useTranslation();
    const appearance = APPEARANCE[state];

    return (
        <Badge
            testID={testID ?? `subscription-state-${state}`}
            tone={appearance.tone}
            icon={appearance.icon}
            label={t(`commerce:states.${state}`)}
        />
    );
}
