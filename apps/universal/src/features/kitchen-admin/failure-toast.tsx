import { useToast } from '@healthy360/design-system';
import { useEffect } from 'react';

/**
 * A write that was refused, said as a toast rather than a red box left on the page (Toasts /
 * pop-ups / banners canvas, Inventory board: "Callout after a failed write → Toast").
 *
 * The box stayed after the moment had passed — above a form the reader had already fixed, or
 * behind the dialog it was about. A failure is news about what just happened, which is what a
 * toast is for; anything still wrong after it is said under its own field.
 *
 * Drawn where the box was, and draws nothing itself: when `failure` turns up (or changes what it
 * says) it shows one danger toast with `testID`. A retry that fails again says so again, because
 * a new attempt clears the old failure first.
 */
export function FailureToast({
    failure,
    title,
    body,
    testID,
}: {
    readonly failure: unknown;
    readonly title: string;
    readonly body?: string | null | undefined;
    readonly testID: string;
}) {
    const toast = useToast();
    const failed = failure !== null && failure !== undefined;
    const said = failed ? `${title}\n${body ?? ''}` : null;

    useEffect(() => {
        if (said === null) return;
        toast.show({
            testID,
            tone: 'danger',
            ...(body === null || body === undefined || body === ''
                ? { message: title }
                : { title, message: body }),
        });
        // Once per failure said: the toast API and the strings are read when it changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [said]);

    return null;
}
