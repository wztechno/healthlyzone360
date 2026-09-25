import type { AdminEntityMeta, AdminRecordMeta } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Dialog,
    Inline,
    PageTransition,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { BadgeTone } from '@healthy360/design-system';

import { statusKey, statusTone } from './format.ts';
import { CataloguePageHeader } from './catalogue/catalogue-page-header.tsx';
import { EditorStepNavigation, EditorStepProgress } from './editor-steps.tsx';
import type { EditorStepsProps } from './editor-steps.tsx';
import { useKitchenTrailLeaf } from './kitchen-ops-shell.tsx';
import type { OptimisticConcurrency } from './use-optimistic-concurrency.ts';
import type { UnsavedGuard } from './use-unsaved-guard.ts';

/**
 * The chrome every record editor in this workspace shares.
 *
 * Drawn as the Catalogue editor draws its opening — `CataloguePageHeader` with Cancel and Save, the
 * record-facts line, the form on the page. Still owns no form state — screens pass data and
 * callbacks.
 */

export interface EditorFrameProps {
    readonly title: string;
    /**
     * Keeps `title` for the breadcrumb leaf but draws no heading. For a create form whose tabs and
     * fields already say what it is, so a "New …" heading would only repeat the trail.
     */
    readonly hideTitle?: boolean | undefined;
    /**
     * The one upper chip beside the title (§3y) — the kind of surface this is, never a count.
     * "One record per branch" on the opening hours.
     */
    readonly titleChip?: { readonly label: string; readonly tone: BadgeTone } | undefined;
    /**
     * The header's summary slot, under the title (§3y): the count cards on a single-record editor
     * whose facts are counts. When given, it replaces the record-facts line — a record with no
     * lifecycle has no status to state, and the cards already say what the line would.
     */
    readonly summary?: ReactNode | undefined;
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
    /**
     * Hide the draft-save control entirely.
     *
     * Use when the record cannot be written here at all (for example a platform-library
     * ingredient): a permanently disabled save button is furniture, and the allergen section
     * already carries its own save.
     */
    readonly hideSave?: boolean | undefined;
    /** Extra controls beside the save button — archive, publish, whatever the slice owns. */
    readonly primaryAction?: ReactNode | undefined;
    /** Rendered between the header and the children — callouts, quarantine notices, errors. */
    readonly banner?: ReactNode | undefined;
    readonly onBack: () => void;
    readonly backLabel: string;
    /** Hide the back control — for an editor whose own flow owns the way out (the zone wizard). */
    readonly hideBack?: boolean | undefined;
    /**
     * Drop the header block and the record-facts line entirely, leaving the form on the page.
     *
     * For an editor that states its own identity: the delivery-zone wizard's breadcrumb already
     * names the record, and its step buttons are the only controls, so the title row would be an
     * empty band above the first field.
     */
    readonly chromeless?: boolean | undefined;
    /**
     * Where the save and back controls sit.
     *
     * `footer` is the treatment eight of the nine editors ship: a bar at the end of the flow, for
     * the reason the bar's own note gives. `header` puts the same two controls right-aligned on the
     * title row instead — the meal editor's handoff draws them there, beside the status the save
     * changes. Opt-in rather than a switch, so adopting it is a decision each editor makes with its
     * own design in hand.
     */
    readonly actionsPlacement?: 'footer' | 'header' | undefined;
    /**
     * `band` wraps the title, status and actions in their own raised panel — the treatment eight of
     * the nine editors ship. `plain` drops the panel and its padding, leaving the same content on
     * the page canvas: a header card above a form card is two rectangles for one page, and on a desk
     * surface it costs a fifth of the viewport before a single field is visible.
     */
    readonly headerVariant?: 'band' | 'plain' | undefined;
    /**
     * A right-hand column beside the form on wide screens — the meal editor's publication gate.
     * Stacks after the form below `lg`, so the reading order is the same at every width.
     */
    readonly rail?: ReactNode | undefined;
    /**
     * Draw the form as steps: the progress row under the header, the step footer under the form.
     * `children` is then the open step only. The last step's commit defaults to this frame's own
     * Save, which then leaves the header and keeps its `{testID}-save` id; pass `finalAction` to
     * draw something else there.
     */
    readonly steps?: Omit<EditorStepsProps<string>, 'testID'> | undefined;
    /**
     * Drawn inside another page rather than as a page — a cooked item's Selling tab, whose page is
     * the recipe it is made from.
     *
     * The host already has a title, a trail and a way back, so none of those are drawn and `onBack`
     * is never offered. What stays is everything that belongs to *this* record: its status, who last
     * changed it and whether it is dirty, its banner, its form and rail, its own save, and the two
     * dialogs that guard it.
     */
    readonly embedded?: boolean | undefined;
    readonly children: ReactNode;
    readonly testID: string;
}

export function EditorFrame({
    title,
    hideTitle = false,
    titleChip,
    summary,
    meta,
    guard,
    concurrency,
    onSaveDraft,
    saveLabel,
    saving = false,
    saveDisabled = false,
    hideSave = false,
    primaryAction,
    banner,
    onBack,
    backLabel,
    hideBack = false,
    chromeless = false,
    actionsPlacement = 'footer',
    headerVariant = 'band',
    rail,
    steps,
    embedded = false,
    children,
    testID,
}: EditorFrameProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const updatedLine = (): string => {
        // An unknown timestamp reads the same as no record at all. `/kitchen/branch-operating` is the
        // case that forced this: its endpoint publishes days and no save history, so the mapper
        // hands over `UNKNOWN_ISO_DATE_TIME` and 'Last changed  by the import' is the alternative.
        if (meta === null || meta.updatedAt === '') return t('kitchen:editor.neverSaved');
        const when = formatter.formatRelativeTime(meta.updatedAt);
        if (meta.updatedByName === null) return t('kitchen:editor.lastUpdatedBySeed', { when });
        return t('kitchen:editor.lastUpdatedBy', { when, name: meta.updatedByName });
    };

    useKitchenTrailLeaf(embedded ? null : title);

    // A form of one step draws no footer, so it keeps the header's Save.
    const stepped = steps !== undefined && steps.steps.length > 1;

    /*
     * The Catalogue editor's opening (Commercial handoff §2.3): the title with Cancel and Save at its
     * inline end, then one record-facts line — status, unsaved, last changed. No band, no subtitle
     * (§3y), no footer bar: an editor's Cancel and Save are one decision at one height, drawn where
     * the ingredient editor draws them. The test ids did not move, and `actionsPlacement` /
     * `headerVariant` are accepted and ignored, because there is now one treatment.
     */
    void actionsPlacement;
    void headerVariant;

    // The summary cards say what the status badge would, so a header carrying them drops it and
    // keeps only the dirty flag. Embedded there are no cards and nothing else states any of this.
    const metaLine = (
        <Inline space="xs" align="center" wrap testID={`${testID}-meta`}>
            {summary !== undefined ? null : meta === null ? (
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
    );

    const body = (
        <Stack space="md">
            {chromeless ? null : embedded ? (
                <Inline space="sm" align="center" wrap justify="between">
                    {metaLine}
                    <Inline
                        space="xs"
                        align="center"
                        wrap
                        justify="end"
                        testID={`${testID}-actions`}
                    >
                        {primaryAction}
                        {hideSave ? null : (
                            <Button
                                testID={`${testID}-save`}
                                label={saveLabel}
                                loading={saving}
                                disabled={saveDisabled || saving}
                                onPress={onSaveDraft}
                            />
                        )}
                    </Inline>
                </Inline>
            ) : (
                <Stack space="xs">
                    <CataloguePageHeader
                        testID={`${testID}-header`}
                        titleTestID={`${testID}-title`}
                        // A stepped form draws no heading: the top bar's trail already names
                        // the page, and the progress line is what opens the form.
                        title={hideTitle || steps !== undefined ? undefined : title}
                        titleAside={
                            titleChip === undefined ? undefined : (
                                <Badge
                                    testID={`${testID}-chip`}
                                    tone={titleChip.tone}
                                    label={titleChip.label}
                                />
                            )
                        }
                        primaryAction={
                            <Inline
                                space="xs"
                                align="center"
                                wrap
                                justify="end"
                                testID={`${testID}-actions`}
                            >
                                {hideBack ? null : (
                                    <Button
                                        testID={`${testID}-back`}
                                        variant="secondary"
                                        label={backLabel}
                                        onPress={() => {
                                            guard.intercept(onBack);
                                        }}
                                    />
                                )}
                                {primaryAction}
                                {/* A stepped form saves from its last step's Next, not up here. */}
                                {hideSave || stepped ? null : (
                                    <Button
                                        testID={`${testID}-save`}
                                        label={saveLabel}
                                        loading={saving}
                                        disabled={saveDisabled || saving}
                                        onPress={onSaveDraft}
                                    />
                                )}
                            </Inline>
                        }
                    />
                    {summary === undefined ? null : summary}
                    {summary !== undefined && !guard.isDirty ? null : metaLine}
                </Stack>
            )}

            {steps === undefined ? null : (
                <EditorStepProgress
                    form={steps.form}
                    steps={steps.steps}
                    testID={`${testID}-steps`}
                />
            )}

            {banner}

            {/*
             * The form sits on the page, not in a panel: sections carry their own hairlines
             * (`FormSection`), and a card around them was a second border saying the same thing.
             */}
            {rail === undefined ? (
                <View className="flex-col">{children}</View>
            ) : (
                <View className="flex-col gap-base lg:flex-row lg:items-start">
                    {}
                    <View className="min-w-0 flex-1 flex-col">{children}</View>
                    <View testID={`${testID}-rail`} className="lg:w-[330px] lg:shrink-0">
                        {rail}
                    </View>
                </View>
            )}

            {steps === undefined ? null : (
                <EditorStepNavigation
                    form={steps.form}
                    steps={steps.steps}
                    testID={`${testID}-steps`}
                    finalAction={
                        steps.finalAction ??
                        (hideSave ? null : (
                            <Button
                                testID={`${testID}-save`}
                                label={saveLabel}
                                loading={saving}
                                disabled={saveDisabled || saving}
                                onPress={onSaveDraft}
                            />
                        ))
                    }
                />
            )}

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
    );

    return embedded ? (
        <View testID={testID}>{body}</View>
    ) : (
        <PageTransition testID={testID} transitionKey={testID}>
            {body}
        </PageTransition>
    );
}
