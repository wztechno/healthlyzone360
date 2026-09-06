import { useTranslation } from 'react-i18next';

import { Button } from '../actions/button.tsx';
import { Dialog } from './dialog.tsx';

/**
 * ConfirmationDialog — one destructive question, asked the same way every time.
 *
 * It replaces the ad-hoc confirms scattered through the admin (§3). Those differ in the ways that
 * matter most: some put the destructive action first, some label it `OK`, and at least one asks
 * "Are you sure?" without naming what is about to happen. A person who archives twenty ingredients
 * a week reads none of them — which is exactly when a mislabelled button costs a record.
 *
 * So the shape is fixed and only the words move:
 *
 * - **The confirming action is last** and carries the tone. Cancel comes first, matching `Dialog`'s
 *   own "confirming action last" rule, so the muscle memory built here transfers to every other
 *   dialog in the product.
 * - **The confirm label names the verb**, never `OK`. `Archive ingredient` is a sentence a person
 *   can check against their intention; `OK` is a sentence about the dialog.
 * - **Escape and the backdrop cancel.** Dismissal always resolves to the safe branch — there is no
 *   configuration for a confirm that fires on dismissal, because that dialog should not exist.
 *
 * `destructive` picks the danger variant *and* nothing else: the label already says what happens,
 * and a red button whose text says `Save` would be the colour carrying meaning on its own.
 */

export interface ConfirmationDialogProps {
    readonly open: boolean;
    /** Cancel, Escape and the backdrop all land here. */
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
    readonly title: string;
    /** What will happen, in a sentence. Name the record — "Archive Tahini paste?" not "this item". */
    readonly description?: string | undefined;
    /** Names the verb. Defaults to `common:action.confirm`, which is right only for the generic case. */
    readonly confirmLabel?: string | undefined;
    readonly cancelLabel?: string | undefined;
    readonly destructive?: boolean | undefined;
    /** Keeps the dialog open and the confirm button busy while the mutation is in flight. */
    readonly busy?: boolean | undefined;
    readonly testID?: string | undefined;
}

export function ConfirmationDialog({
    open,
    onCancel,
    onConfirm,
    title,
    description,
    confirmLabel,
    cancelLabel,
    destructive = false,
    busy = false,
    testID,
}: ConfirmationDialogProps) {
    const { t } = useTranslation();

    return (
        <Dialog
            open={open}
            onClose={onCancel}
            title={title}
            {...(description === undefined ? {} : { description })}
            {...(testID === undefined ? {} : { testID })}
            // A confirmation is dismissible by backdrop precisely *because* dismissal is the safe
            // branch. Blocking it would make the destructive path the only way out of the dialog.
            dismissOnBackdrop={!busy}
            actions={
                <>
                    <Button
                        label={cancelLabel ?? t('common:action.cancel')}
                        variant="secondary"
                        size="md"
                        disabled={busy}
                        onPress={onCancel}
                        {...(testID === undefined ? {} : { testID: `${testID}-cancel` })}
                    />
                    <Button
                        label={confirmLabel ?? t('common:action.confirm')}
                        variant={destructive ? 'danger' : 'primary'}
                        size="md"
                        loading={busy}
                        onPress={onConfirm}
                        {...(testID === undefined ? {} : { testID: `${testID}-confirm` })}
                    />
                </>
            }
        />
    );
}
