import {
    Badge,
    Button,
    Dialog,
    FormIssueBanner,
    Inline,
    Stack,
    Tabs,
    Text,
    useIssueGroup,
} from '@healthy360/design-system';
import type { FormIssueItem, IssueCardItem, TabItem } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { toFailure } from '../../data/hooks.ts';
import { CataloguePageHeader } from './catalogue/catalogue-page-header.tsx';
import { focusField } from './field-focus.ts';
import { serverFieldErrors } from './server-field-errors.ts';
import type { ServerFieldTarget } from './server-field-errors.ts';
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
 * - **The problems**, as cards in the page's issue tray (`useIssueGroup`): what stops the save under
 *   "Blocks save", each card's Fix taking the reader to the field; what does not stop it but should
 *   be seen under "Check". They are the map, never the only place a problem is said: every field
 *   still says it under itself. A page with no `IssueTrayFrame` around it gets the old banners.
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
    /**
     * Under the title row: what the record *is* and cannot change here — the price list's currency,
     * kitchen and channels. Facts of the record rather than fields of the form.
     */
    readonly details?: ReactNode | undefined;
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
    details,
    actions,
    errors,
    warnings,
    steps,
    testID,
}: RecordFormOpeningProps<Step>) {
    const { t } = useTranslation();

    const cards = (
        items: readonly FormIssueItem[] | undefined,
        tone: 'danger' | 'warning',
        part: 'errors' | 'warnings',
    ): IssueCardItem[] =>
        (items ?? []).map((item) => ({
            key: item.key,
            tone,
            label: item.label,
            action: { onPress: item.onPress },
            testID: `${testID}-issues-${part}-${item.key}`,
        }));
    // Registered empty too, so a card the reader has fixed ticks off rather than vanishing.
    const inTray = useIssueGroup({
        key: 'save',
        title: t('kitchen:tray.groupSave'),
        items: cards(errors?.items, 'danger', 'errors'),
        testID: `${testID}-issues-errors`,
    });
    useIssueGroup({
        key: 'check',
        title: t('kitchen:tray.groupCheck'),
        items: cards(warnings?.items, 'warning', 'warnings'),
        testID: `${testID}-issues-warnings`,
    });

    const showErrors = !inTray && errors !== undefined && errors.items.length > 0;
    const showWarnings = !inTray && warnings !== undefined && warnings.items.length > 0;

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

            {details === undefined ? null : <View testID={`${testID}-details`}>{details}</View>}

            {/*
             * Only outside a tray. One strip above the other, each the full width: side by side
             * they squeezed each other into columns a few words wide, and the chips piled up.
             */}
            {!showErrors && !showWarnings ? null : (
                <Stack space="xs" testID={`${testID}-issues`}>
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
                </Stack>
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

/**
 * After a save the server refused field by field, the reader is taken to the first field it named —
 * what a Save over a blank already does for the form's own checks, so a refusal is never only a
 * strip at the top of a long page.
 *
 * `targets` is the form's description of its fields, the shape `serverFieldErrors` reads, written
 * **in the order the form draws them**: the first one refused is the one focused. A screen whose
 * banner names a whole table by one wildcard can pass a finer map here — one entry per row and
 * column — so the cursor lands in the cell rather than on the table.
 *
 * Answers whether there was a field to go to. A refusal that names none stays with the callout.
 */
export function focusFirstRefusal(
    error: unknown,
    targets: Readonly<Record<string, ServerFieldTarget>>,
): boolean {
    const refused = serverFieldErrors(toFailure(error), targets);
    if (!refused.isValidation) return false;
    const first = Object.entries(targets).find(([field]) => refused.errorFor(field) !== undefined);
    if (first === undefined) return false;
    focusField(first[1].fieldId);
    return true;
}
