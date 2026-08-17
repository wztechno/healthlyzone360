import {
    Badge,
    Button,
    Dialog,
    Heading,
    Inline,
    PageTransition,
    Stack,
} from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { UnsavedGuard } from './use-unsaved-guard.ts';

/**
 * The chrome an **ops** record editor shares — {@link EditorFrame} minus the two things an ops row
 * does not have.
 *
 * ## Why this is a second frame rather than a third widening of the first
 *
 * `EditorFrame` was already widened once, from `AdminEntityMeta` to "or a plain `AdminRecordMeta`",
 * and both of those carry `updatedAt` and `updatedByName`. An ops record carries **neither**: the
 * backend does not stamp a supplier with who touched it last, and it does not version one either.
 * Passing `meta: null` to the existing frame would not degrade gracefully — it renders a
 * `status: draft` badge and the words "never saved" for a null meta, which on a supplier that has
 * existed for two years would be a **false Draft badge on a live record**. That is not a cosmetic
 * difference; it is the frame stating something untrue.
 *
 * So this keeps everything an ops editor genuinely needs — back, title, dirty marker, a section for
 * banners, the action bar and the unsaved-changes dialog — and drops the meta line, the status badge
 * and the optimistic-concurrency conflict dialog. No lock version means no conflict to report: two
 * people saving one supplier is a last-write-wins, and a dialog offering to reload would be
 * furniture for a race the server never signals.
 *
 * The testID suffix contract is deliberately identical to `EditorFrame`'s — `-back`, `-title`,
 * `-dirty`, `-actions`, `-save`, `-unsaved-dialog`, `-unsaved-keep`, `-unsaved-discard` — so the
 * Playwright and jest selector idioms carry over unchanged.
 */

export interface OpsRecordFrameProps {
    readonly title: string;
    readonly guard: UnsavedGuard;
    readonly onSave: () => void;
    readonly saveLabel: string;
    readonly saving?: boolean | undefined;
    readonly saveDisabled?: boolean | undefined;
    /** Hide the save control entirely — a record this caller may read but not write. */
    readonly hideSave?: boolean | undefined;
    /** Extra controls beside save — archive, restore, whatever the slice owns. */
    readonly primaryAction?: ReactNode | undefined;
    /** Rendered between the header and the children — callouts, notices, errors. */
    readonly banner?: ReactNode | undefined;
    readonly onBack: () => void;
    readonly backLabel: string;
    readonly children: ReactNode;
    readonly testID: string;
}

export function OpsRecordFrame({
    title,
    guard,
    onSave,
    saveLabel,
    saving = false,
    saveDisabled = false,
    hideSave = false,
    primaryAction,
    banner,
    onBack,
    backLabel,
    children,
    testID,
}: OpsRecordFrameProps) {
    const { t } = useTranslation();

    return (
        <PageTransition testID={testID} transitionKey={testID}>
            <Stack space="lg">
                <View className="rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-1">
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

                        {guard.isDirty ? (
                            <Inline space="sm" align="center" wrap>
                                <Badge
                                    testID={`${testID}-dirty`}
                                    tone="warning"
                                    icon="warning"
                                    label={t('kitchen:editor.unsaved')}
                                />
                            </Inline>
                        ) : null}
                    </Stack>
                </View>

                {banner}

                <View className="rounded-panel border border-brand-100 bg-surface-raised p-4 md:p-5">
                    {children}
                </View>

                <View
                    testID={`${testID}-actions`}
                    className="flex-row flex-wrap items-center justify-end gap-2 rounded-xl border border-brand-100 bg-surface-raised p-3 shadow-elevation-1"
                >
                    {primaryAction}
                    {hideSave ? null : (
                        <Button
                            testID={`${testID}-save`}
                            label={saveLabel}
                            loading={saving}
                            disabled={saveDisabled || saving}
                            onPress={onSave}
                        />
                    )}
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
            </Stack>
        </PageTransition>
    );
}
