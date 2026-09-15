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
    readonly children: ReactNode;
    readonly testID: string;
}

export function EditorFrame({
    title,
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
    actionsPlacement = 'footer',
    headerVariant = 'band',
    rail,
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

    useKitchenTrailLeaf(title);

    /*
     * The Catalogue editor's opening (Commercial handoff §2.3): the title with Cancel and Save at its
     * inline end, then one record-facts line — status, unsaved, last changed. No band, no subtitle
     * (§3y), no footer bar: an editor's Cancel and Save are one decision at one height, drawn where
     * the ingredient editor draws them. The test ids did not move, and `actionsPlacement` /
     * `headerVariant` are accepted and ignored, because there is now one treatment.
     */
    void actionsPlacement;
    void headerVariant;

    return (
        <PageTransition testID={testID} transitionKey={testID}>
            <Stack space="md">
                <Stack space="xs">
                    <CataloguePageHeader
                        testID={`${testID}-header`}
                        titleTestID={`${testID}-title`}
                        title={title}
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
                                <Button
                                    testID={`${testID}-back`}
                                    variant="secondary"
                                    label={backLabel}
                                    onPress={() => {
                                        guard.intercept(onBack);
                                    }}
                                />
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
                        }
                    />
                    {summary === undefined ? null : summary}
                    {summary !== undefined && !guard.isDirty ? null : (
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
                    )}
                </Stack>

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
                        <Text
                            testID={`${testID}-conflict-detail`}
                            tone="secondary"
                            variant="caption"
                        >
                            {concurrency.conflict.failure.message}
                        </Text>
                    )}
                </Dialog>
            </Stack>
        </PageTransition>
    );
}
