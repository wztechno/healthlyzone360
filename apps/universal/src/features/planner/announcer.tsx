import { Text } from '@healthy360/design-system';
import { useCallback, useState } from 'react';

/**
 * The planner's live region.
 *
 * Every planner mutation changes something a long way from the control that caused it: locking a
 * card on Tuesday moves the week's meters, regenerating a day rewrites four cards at once, and a
 * replacement changes a card the person may not have been reading. None of that produces a
 * navigation event, so a screen-reader user gets no signal at all — which is exactly the case the
 * specification's "screen-reader announcements for planner changes" requirement covers.
 *
 * Three properties, each deliberate:
 *
 * * **`polite`, never `assertive`.** Every announcement here follows the person's own press.
 *   Interrupting the screen reader mid-sentence to confirm what they just asked for is worse than
 *   waiting for the current utterance to finish.
 * * **Mounted before the first change.** A live region created at the same moment its content
 *   appears is frequently missed by assistive technology, so the region is rendered on every planner
 *   screen from the first frame and starts empty.
 * * **The message names the slot, not the control.** "Lunch on Tuesday replaced" tells somebody what
 *   changed; "replaced" tells them only that the button worked.
 */
export const PLANNER_ANNOUNCER_TEST_ID = 'planner-announcer';

export interface PlannerAnnouncerProps {
    readonly message: string;
    readonly testID?: string | undefined;
}

export function PlannerAnnouncer({
    message,
    testID = PLANNER_ANNOUNCER_TEST_ID,
}: PlannerAnnouncerProps) {
    return (
        <Text
            testID={testID}
            role="status"
            aria-live="polite"
            accessibilityLiveRegion="polite"
            variant="caption"
            tone="secondary"
        >
            {message}
        </Text>
    );
}

export interface PlannerAnnouncement {
    readonly message: string;
    readonly announce: (message: string) => void;
}

/** Zero-width space. Invisible, and not spoken. */
const INVISIBLE = '\u200B';

interface AnnouncementState {
    readonly text: string;
    /** Flipped on every announcement so two identical messages are still two text changes. */
    readonly parity: 0 | 1;
}

/**
 * Holds the current announcement.
 *
 * The parity suffix exists because two identical successive announcements — "Tuesday lunch
 * regenerated", pressed twice — are one unchanged text node to a live region, and the second is
 * silently dropped. Alternating an invisible, unspoken character makes the node change without
 * changing a syllable of what is read out.
 */
export function usePlannerAnnouncement(): PlannerAnnouncement {
    const [state, setState] = useState<AnnouncementState>({ text: '', parity: 0 });

    const announce = useCallback((next: string) => {
        setState((current) => ({ text: next, parity: current.parity === 0 ? 1 : 0 }));
    }, []);

    return {
        message: state.text === '' ? '' : `${state.text}${state.parity === 1 ? INVISIBLE : ''}`,
        announce,
    };
}
