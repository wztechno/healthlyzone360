import { Badge, Inline, Text } from '@healthy360/design-system';
import type { VdSessionState } from '@healthy360/domain-types';
import { useTranslation } from 'react-i18next';

import { VD_STATE_BADGE_TONE, VD_STATE_ICON } from './state-presentation.ts';

/**
 * The session's current state, as a badge and as a live region.
 *
 * A conversational surface changes what is on screen without the reader moving, so a screen-reader
 * user gets no navigation event to tell them the page is now something else. The live region is the
 * substitute: its text is derived from the state, so a transition *is* a text change and the change
 * is what gets announced.
 *
 * `polite`, not `assertive`. These transitions follow the person's own action — they pressed send,
 * or accept, or generate — so interrupting whatever the screen reader is currently saying would cut
 * off the very control they just used.
 *
 * The region is rendered on every state, including the first, so the element exists before the first
 * transition. A live region created at the same moment its content appears is frequently missed by
 * assistive technology.
 */
export interface StateAnnouncerProps {
    readonly state: VdSessionState;
}

export const VD_STATE_ANNOUNCER_TEST_ID = 'vd-state-announcer';

export function StateAnnouncer({ state }: StateAnnouncerProps) {
    const { t } = useTranslation();

    const label = t(`virtualDietitian:states.${state}.label`);
    const summary = t(`virtualDietitian:states.${state}.summary`);

    return (
        <Inline space="sm" align="center" testID="vd-state-header">
            <Badge
                testID="vd-state-badge"
                tone={VD_STATE_BADGE_TONE[state]}
                icon={VD_STATE_ICON[state]}
                label={label}
            />
            <Text
                testID={VD_STATE_ANNOUNCER_TEST_ID}
                role="status"
                aria-live="polite"
                accessibilityLiveRegion="polite"
                variant="caption"
                tone="secondary"
                className="flex-1"
            >
                {t('virtualDietitian:session.announcement', { state: label, summary })}
            </Text>
        </Inline>
    );
}
