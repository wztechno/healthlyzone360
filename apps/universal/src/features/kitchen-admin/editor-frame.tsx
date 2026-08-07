import type { AdminEntityMeta, AdminRecordMeta } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Dialog,
    Heading,
    Inline,
    PageTransition,
    Stack,
    Text,
} from '@healthy360/design-system';
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
 * Moodboard Option 02 surfaces: soft white header band, status pills, sticky-feeling action bar
 * with brand-tinted border. Still owns no form state — screens pass data and callbacks.
 */

export interface EditorFrameProps {
    readonly title: string;
    /**
     * The record's meta, or `null` for one that has never been saved.
     *
     * Widened by K1.7 to accept a plain {@link AdminRecordMeta} as well. A branch's operating week
     * is an operational setting rather than a publishable record — the contract gives it no status
     * on purpose, because a `draft` week would invent a lifecycle the branch does not have — and the
     * header therefore draws no status badge for one rather than inventing a value to put in it.
     * Everything else the header states (who changed it, when, and whether it is dirty) is identical
     * for both, which is why this is one frame rather than two.
     */
    readonly meta: AdminEntityMeta | AdminRecordMeta | null;
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
        <PageTransition testID={testID} transitionKey={testID}>
            <Stack space="lg">
                <View className="rounded-2xl border border-brand-100 bg-surface-raised p-4 shadow-elevation-1">
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
                            ) : 'status' in meta ? (
                                <Badge
                                    testID={`${testID}-status`}
                                    tone={statusTone(meta.status)}
                                    label={t(statusKey(meta.status))}
                                />
                            ) : null}
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
                </View>

                {banner}

                <View className="rounded-2xl border border-brand-100 bg-surface-raised p-4 md:p-5">
                    {children}
                </View>

                {/*
                 * The bar is a normal block at the end of the flow rather than a fixed overlay: a
                 * position-fixed footer covers the last field of a form on a short screen, and on the
                 * web it also fights the software keyboard. Brand-tinted border keeps it reachable
                 * visually without stealing viewport height.
                 */}
                <View
                    testID={`${testID}-actions`}
                    className="flex-row flex-wrap items-center justify-end gap-2 rounded-xl border border-brand-100 bg-surface-raised p-3 shadow-elevation-1"
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
                                variant="quiet"
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
                                variant="quiet"
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
        </PageTransition>
    );
}
