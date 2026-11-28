import { useTranslation } from 'react-i18next';

import { Button } from '../actions/button.tsx';
import { Text } from '../primitives/text.tsx';
import { Dialog } from './dialog.tsx';

/**
 * The two pop-ups every admin form guards itself with — leaving with unsaved edits, and saving over
 * somebody else's — drawn once, under the ids the editors always gave them
 * (`{testID}-unsaved-dialog`, `{testID}-conflict-dialog` and their buttons).
 *
 * A pop-up asks a decision (Toasts / pop-ups / banners canvas): the title is the question, one line
 * under it, Stay beside the red way out.
 */

/** What `LeaveDialog` reads from the app's unsaved-changes guard. */
export interface LeaveGuard {
    /** True while the question is open. */
    readonly isPrompting: boolean;
    /** Closes the question and stays put. */
    readonly cancelDiscard: () => void;
    /** Drops the edits and goes where the reader was going. */
    readonly confirmDiscard: () => void;
    /** The form keeps a draft: offer "Keep for later" beside Discard and Stay. */
    readonly canKeep?: boolean | undefined;
    /** Keeps the work for later and goes. Required with `canKeep`. */
    readonly confirmKeep?: (() => void) | undefined;
}

/**
 * "Leave without saving?" — or, on a form that keeps a draft, "Leave this page?" with Keep for
 * later. "Stay" rather than "Keep editing" beside a Keep button, so the two Keeps are never
 * confused.
 */
export function LeaveDialog({
    guard,
    title,
    body,
    testID,
}: {
    readonly guard: LeaveGuard;
    /** Translated. The question in the form's own words ("Discard this receipt?"). */
    readonly title?: string | undefined;
    /** Translated. The line under it, with what would be lost. */
    readonly body?: string | undefined;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const keepable = guard.canKeep === true && guard.confirmKeep !== undefined;

    return (
        <Dialog
            look="card"
            testID={`${testID}-unsaved-dialog`}
            open={guard.isPrompting}
            onClose={guard.cancelDiscard}
            title={
                title ??
                t(keepable ? 'designSystem:leave.keepableTitle' : 'designSystem:leave.title')
            }
            description={
                body ?? t(keepable ? 'designSystem:leave.keepableBody' : 'designSystem:leave.body')
            }
            actions={
                <>
                    <Button
                        testID={`${testID}-unsaved-keep`}
                        variant="quiet"
                        label={t(
                            keepable ? 'designSystem:leave.stay' : 'designSystem:leave.keepEditing',
                        )}
                        onPress={guard.cancelDiscard}
                    />
                    <Button
                        testID={`${testID}-unsaved-discard`}
                        variant="danger"
                        label={t('designSystem:leave.discard')}
                        onPress={guard.confirmDiscard}
                    />
                    {keepable ? (
                        <Button
                            testID={`${testID}-unsaved-keep-for-later`}
                            variant="primary"
                            label={t('designSystem:leave.keepForLater')}
                            onPress={guard.confirmKeep}
                        />
                    ) : null}
                </>
            }
        />
    );
}

/**
 * "Someone else changed this record" — a save the server refused because the record moved under
 * the form. Reload takes their version; Keep editing leaves the form as it is so the reader can copy
 * their changes out first. Never closed by a press outside it: either answer is a decision.
 */
export function ConflictDialog({
    open,
    detail,
    onKeepEditing,
    onReload,
    testID,
}: {
    readonly open: boolean;
    /** The server's own words, under the explanation. */
    readonly detail?: string | null | undefined;
    readonly onKeepEditing: () => void;
    readonly onReload: () => void;
    readonly testID: string;
}) {
    const { t } = useTranslation();

    return (
        <Dialog
            look="card"
            testID={`${testID}-conflict-dialog`}
            open={open}
            onClose={onKeepEditing}
            dismissOnBackdrop={false}
            title={t('designSystem:conflict.title')}
            description={t('designSystem:conflict.body')}
            actions={
                <>
                    <Button
                        testID={`${testID}-conflict-keep`}
                        variant="quiet"
                        label={t('designSystem:conflict.keepEditing')}
                        onPress={onKeepEditing}
                    />
                    <Button
                        testID={`${testID}-conflict-reload`}
                        variant="danger"
                        label={t('designSystem:conflict.reload')}
                        onPress={onReload}
                    />
                </>
            }
        >
            {detail === null || detail === undefined ? null : (
                <Text testID={`${testID}-conflict-detail`} tone="secondary" variant="caption">
                    {detail}
                </Text>
            )}
        </Dialog>
    );
}
