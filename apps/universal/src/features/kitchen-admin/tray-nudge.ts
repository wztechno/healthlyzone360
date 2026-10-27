import { useEffect } from 'react';

/**
 * Opens the page's issue tray when a refusal lands — a save, a post, an act the server turned down —
 * so the card that says why is in front of the reader rather than behind a closed sheet.
 *
 * Keyed on the error itself: React Query hands back a new one for every attempt, so a second
 * refusal after the first opens the tray again. `nudge` is the controller's (`useIssueTrayController`),
 * the same one the page hands its `IssueTrayFrame`.
 */
export function useNudgeOnRefusal(refusal: unknown, nudge: () => void): void {
    useEffect(() => {
        if (refusal !== null && refusal !== undefined) nudge();
    }, [refusal, nudge]);
}
