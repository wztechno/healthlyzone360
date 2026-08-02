import type { AdminEntityMeta } from '@healthy360/api-client/contracts';
import { Badge, Button, Dialog, Heading, Inline, Stack, Text } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { statusKey, statusTone } from './format.ts';
import type { OptimisticConcurrency } from './use-optimistic-concurrency.ts';
import type { UnsavedGuard } from './use-unsaved-guard.ts';

/**
 * The chrome every record editor in this workspace shares.
 *
 * It exists because three things have to be identical on every one of them, and "identical" is not
 * something eight screens achieve by remembering:
 *
 * 1. **The header states what the record *is* right now** — its publication status and who last
 *    changed it. An editor that showed only the form leaves "am I editing the published version or
 *    a draft?" unanswerable, which is precisely the question the publication lifecycle exists to
 *    make answerable (plan §4.7).
 * 2. **The save controls are always reachable.** They sit in a bar at the foot of the frame rather
 *    than at the bottom of a long form, because an allergen mapping editor with a dozen rows is
 *    taller than a laptop screen and a save button below the fold is a save button people do not
 *    press.
 * 3. **Leaving and colliding are handled the same way everywhere.** The unsaved-changes question and
 *    the optimistic-locking conflict are rendered here, from the two hooks that own their state, so
 *    no screen can ship one without the other.
 *
 * The frame deliberately owns no form state and no mutation. It renders what it is given and calls
 * back; everything about *what* is being edited stays in the screen.
 */

export interface EditorFrameProps {
    readonly title: string;
    /** The record's meta, or `null` for one that has never been saved. */
    readonly meta: AdminEntityMeta | null;
    readonly guard: UnsavedGuard;
    readonly concurrency: OptimisticConcurrency;
    readonly onSaveDraft: () => void;
    readonly saveLabel: string;
    readonly saving?: boolean | undefined;
    readonly saveDisabled?: boolean | undefined;
    /** Extra controls beside the save button — archive, publish, whatever the slice owns. */
    readonly primaryAction?: ReactNode | undefined;
    /** Rendered between the header and the children — callouts, quarantine notices, errors. */
    readonly banner?: ReactNode | undefined;
    readonly onBack: () => void;
    readonly backLabel: string;
    readonly children: ReactNode;
    readonly testID: string;
}

export function EditorFrame({
    title,
    meta,
    guard,
    concurrency,
    onSaveDraft,
    saveLabel,
    saving = false,
    saveDisabled = false,
    primaryAction,
    banner,
    onBack,
    backLabel,
    children,
    testID,
}: EditorFrameProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const updatedLine = (): string => {
        if (meta === null) return t('kitchen:editor.neverSaved');
        const when = formatter.formatRelativeTime(meta.updatedAt);
        if (meta.updatedByName === null) return t('kitchen:editor.lastUpdatedBySeed', { when });
        return t('kitchen:editor.lastUpdatedBy', { when, name: meta.updatedByName });
    };

    return (
        <Stack space="lg" testID={testID}>
            <Stack space="sm">
                <Button
                    testID={`${testID}-back`}
                    variant="ghost"
                    size="sm"
                    label={backLabel}
                    onPress={() => {
                        guard.intercept(onBack);
                    }}
                />

                <Heading level={1} testID={`${testID}-title`}>
                    {title}
                </Heading>

                <Inline space="sm" align="center" wrap testID={`${testID}-meta`}>
                    {meta === null ? (
                        <Badge
                            testID={`${testID}-status`}
                            tone="neutral"
                            icon="dot"
                            label={t('kitchen:status.draft')}
                        />
                    ) : (
                        <Badge
                            testID={`${testID}-status`}
                            tone={statusTone(meta.status)}
                            label={t(statusKey(meta.status))}
                        />
                    )}
                    {guard.isDirty ? (
                        <Badge
                            testID={`${testID}-dirty`}
                            tone="warning"
                            icon="warning"
                            label={t('kitchen:editor.unsaved')}
                        />
                    ) : null}
                    <Text testID={`${testID}-updated`} tone="secondary" variant="caption">
                        {updatedLine()}
                    </Text>
                </Inline>
            </Stack>

            {banner}

            {children}

            {/*
             * The bar is a normal block at the end of the flow rather than a fixed overlay: a
             * position-fixed footer covers the last field of a form on a short screen, and on the
             * web it also fights the software keyboard. `border-t` and the raised surface give it
             * the separation a sticky bar was wanted for without taking a strip of the viewport
             * away from the record being edited.
             */}
            <View
                testID={`${testID}-actions`}
                className="flex-row flex-wrap items-center justify-end gap-2 rounded-lg border-t border-stroke-subtle bg-surface-raised p-3"
            >
                {primaryAction}
                <Button
                    testID={`${testID}-save`}
                    label={saveLabel}
                    loading={saving}
                    disabled={saveDisabled || saving}
                    onPress={onSaveDraft}
                />
            </View>

            <Dialog
                testID={`${testID}-unsaved-dialog`}
                open={guard.isPrompting}
                onClose={guard.cancelDiscard}
                title={t('kitchen:unsaved.title')}
                description={t('kitchen:unsaved.body')}
                actions={
                    <>
                        <Button
                            testID={`${testID}-unsaved-keep`}
                            variant="secondary"
                            label={t('kitchen:unsaved.keepEditing')}
                            onPress={guard.cancelDiscard}
                        />
                        <Button
                            testID={`${testID}-unsaved-discard`}
                            variant="danger"
                            label={t('kitchen:unsaved.discard')}
                            onPress={guard.confirmDiscard}
                        />
                    </>
                }
            />

            {/*
             * `dismissOnBackdrop={false}` and no-op `onClose`: a conflict has two resolutions and
             * "carry on regardless" is not one of them — see `use-optimistic-concurrency.ts`.
             * Escape still closes the platform modal, which is deliberate: never trap a keyboard
             * user, and the question is re-asked the moment they press save again.
             */}
            <Dialog
                testID={`${testID}-conflict-dialog`}
                open={concurrency.conflict !== null}
                onClose={concurrency.keepEditing}
                dismissOnBackdrop={false}
                title={t('kitchen:conflict.title')}
                description={t('kitchen:conflict.body')}
                actions={
                    <>
                        <Button
                            testID={`${testID}-conflict-keep`}
                            variant="secondary"
                            label={t('kitchen:conflict.keepEditing')}
                            onPress={concurrency.keepEditing}
                        />
                        <Button
                            testID={`${testID}-conflict-reload`}
                            variant="danger"
                            label={t('kitchen:conflict.reload')}
                            onPress={concurrency.reload}
                        />
                    </>
                }
            >
                {concurrency.conflict === null ? null : (
                    <Text testID={`${testID}-conflict-detail`} tone="secondary" variant="caption">
                        {concurrency.conflict.failure.message}
                    </Text>
                )}
            </Dialog>
        </Stack>
    );
}
