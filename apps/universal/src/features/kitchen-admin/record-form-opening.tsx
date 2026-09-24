import {
    Badge,
    Button,
    Dialog,
    FormIssueBanner,
    Inline,
    Stack,
    Tabs,
    Text,
} from '@healthy360/design-system';
import type { FormIssueItem, TabItem } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { CataloguePageHeader } from './catalogue/catalogue-page-header.tsx';
import type { OptimisticConcurrency } from './use-optimistic-concurrency.ts';
import type { UnsavedGuard } from './use-unsaved-guard.ts';

/**
 * The opening of a Catalogue Forms record page, for the forms that do not draw their own.
 *
 * ```
 * New supplier  DRAFT  SUP-014  ⚠ Unsaved                         [ Cancel ]  [ Save ]
 * ✖ 2 required  [ Name (EN) ] [ Email ]                              <- once Save is pressed
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │(1) Details │(2) Contacts 3 │(3) Supplied items 12 ①                           │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * The ingredient, recipe, resale and plan editors each compose this by hand, and each was the
 * first of its kind; this is the same composition for the next ones, so a delivery zone, a supplier,
 * a supply order and a batch open the way those four do rather than on a banded header, a panel
 * and a footer of Previous and Next.
 *
 * - **The title** with what the record is beside it — its status, its handle, an unsaved marker —
 *   and the page's actions at the inline end, Cancel first and the commit last.
 * - **The banners**, when there is something to say: the danger one names what stops the save and
 *   each chip takes the reader to it; the warning one names what does not stop it but should be
 *   seen. Neither is drawn empty.
 * - **The steps**, when the form has more than one: numbered tabs on a sunken track, each with its
 *   count and — when something on it needs attention — a pill. The row is the map; the page draws
 *   `TabStepNavigation` under its form as the way through. Without steps a hairline closes the
 *   opening instead.
 *
 * It owns no form state. The trail's last crumb is the caller's to name (`useKitchenTrailLeaf`),
 * because only the caller knows when its record has loaded.
 */
export interface RecordFormOpeningProps<Step extends string> {
    readonly title: string;
    /** Beside the title: status, handle, a kind chip. The unsaved marker is added after them. */
    readonly badges?: ReactNode | undefined;
    readonly dirty: boolean;
    /** At the inline end — Cancel, then any lifecycle act, then the commit. */
    readonly actions?: ReactNode | undefined;
    readonly errors?:
        { readonly summary: string; readonly items: readonly FormIssueItem[] } | undefined;
    readonly warnings?:
        { readonly summary: string; readonly items: readonly FormIssueItem[] } | undefined;
    readonly steps?:
        | {
              readonly label: string;
              readonly items: readonly TabItem<Step>[];
              readonly value: Step;
              readonly onChange: (step: Step) => void;
          }
        | undefined;
    /** The page's id. The parts are `-header`, `-title`, `-meta`, `-dirty`, `-issues-*`, `-tabs`. */
    readonly testID: string;
}

export function RecordFormOpening<Step extends string>({
    title,
    badges,
    dirty,
    actions,
    errors,
    warnings,
    steps,
    testID,
}: RecordFormOpeningProps<Step>) {
    const { t } = useTranslation();

    const showErrors = errors !== undefined && errors.items.length > 0;
    const showWarnings = warnings !== undefined && warnings.items.length > 0;

    return (
        <Stack space="sm">
            <CataloguePageHeader
                testID={`${testID}-header`}
                titleTestID={`${testID}-title`}
                title={title}
                titleAside={
                    <Inline space="xs" align="center" wrap testID={`${testID}-meta`}>
                        {badges}
                        {dirty ? (
                            <Badge
                                variant="label"
                                testID={`${testID}-dirty`}
                                tone="warning"
                                icon="warning"
                                label={t('kitchen:editor.unsaved')}
                            />
                        ) : null}
                    </Inline>
                }
                primaryAction={
                    actions === undefined ? undefined : (
                        <Inline
                            space="xs"
                            align="center"
                            wrap
                            justify="end"
                            testID={`${testID}-actions`}
                        >
                            {actions}
                        </Inline>
                    )
                }
            />

            {!showErrors && !showWarnings ? null : (
                <Inline space="xs" wrap testID={`${testID}-issues`}>
                    {showErrors ? (
                        <FormIssueBanner
                            testID={`${testID}-issues-errors`}
                            tone="danger"
                            summary={errors.summary}
                            items={errors.items}
                        />
                    ) : null}
                    {showWarnings ? (
                        <FormIssueBanner
                            testID={`${testID}-issues-warnings`}
                            tone="warning"
                            summary={warnings.summary}
                            items={warnings.items}
                        />
                    ) : null}
                </Inline>
            )}

            {steps === undefined || steps.items.length <= 1 ? (
                <View className="border-b border-stroke" />
            ) : (
                <Tabs<Step>
                    testID={`${testID}-tabs`}
                    label={steps.label}
                    items={steps.items}
                    value={steps.value}
                    onChange={steps.onChange}
                    variant="steps"
                />
            )}
        </Stack>
    );
}

/**
 * The two dialogs every record page guards itself with — leaving with unsaved edits, and saving
 * over somebody else's — drawn under the ids the frames always gave them (`-unsaved-dialog`,
 * `-conflict-dialog` and their buttons), so a page that leaves a frame keeps its suite.
 */
export function EditorGuardDialogs({
    guard,
    concurrency,
    testID,
}: {
    readonly guard: UnsavedGuard;
    readonly concurrency?: OptimisticConcurrency | undefined;
    readonly testID: string;
}) {
    const { t } = useTranslation();

    return (
        <>
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

            {concurrency === undefined ? null : (
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
                        <Text
                            testID={`${testID}-conflict-detail`}
                            tone="secondary"
                            variant="caption"
                        >
                            {concurrency.conflict.failure.message}
                        </Text>
                    )}
                </Dialog>
            )}
        </>
    );
}
