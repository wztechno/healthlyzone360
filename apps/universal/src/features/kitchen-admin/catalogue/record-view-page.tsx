import {
    Badge,
    Button,
    Callout,
    Card,
    Cascade,
    Icon,
    Inline,
    RecordWindowFieldGrid,
    Stack,
    TagRow,
    Text,
    useContentWidth,
} from '@healthy360/design-system';
import type { BadgeTone, IconName, RecordWindowField, TagRowItem } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { RECORD_RAIL_MIN, RECORD_SPLIT_MIN } from '../desk-layout.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { CataloguePageHeader } from './catalogue-page-header.tsx';

/**
 * The read-only record page behind every kitchen-admin row's View — `IngredientView.dc.html`.
 *
 * ```
 * Kitchen workspace › Ingredients › Tahini paste            <- the shell's trail, and the way back
 * Tahini paste  ING-0142 [ Live ]
 * ┌ Identification ─────────────────────┐  ┌ Record status ───────┐
 * │ REFERENCE        DESIGNATION        │  │ [ Live ]             │
 * │ …                                   │  │ Updated … by …       │
 * └─────────────────────────────────────┘  │ [ Edit ingredient  ] │
 * ┌ section ────────────────────────────┐  └──────────────────────┘
 * └─────────────────────────────────────┘  ┌ Allergens & diets ───┐
 *                                          └──────────────────────┘
 *              2.1fr                                 1fr
 * ```
 *
 * ## It replaces the window, not the list's state
 *
 * Every View used to open a 640px `RecordWindow` over the list. The design draws the record as a
 * page instead: a wide column of cards, and a rail that states the record's status and carries its
 * one way into the editor. A caller renders this **in place of** its list while it holds a record,
 * so Back is a state change — the list's page, sort and filters are still in the hook above it —
 * rather than a navigation that would drop them.
 *
 * ## Back is a button and a crumb, and Edit is drawn once
 *
 * `onBack` is handed to the shell's trail (`useKitchenTrailLeaf`), which draws
 * `… › Ingredients › Tahini paste` with **Ingredients** as the link that closes the record — so the
 * trail means the same thing here as on a record that is a route of its own. Readers missed the
 * crumb, so the header's inline end carries a `‹ Back` button that does the same (`-back`). Edit
 * lives in the status card, beside the facts that decide whether to press it, and only there.
 *
 * ## One shape for every module
 *
 * The props are `RecordWindow`'s, so a screen moves across by swapping the element and turning
 * `onClose` into `onBack`. The test-id suffixes that suites already name — `-title`, `-kind`,
 * `-status`, `-note`, `-field-{key}`, `-chips`, `-body`, `-primary` — are kept; `-primary` (or the
 * action's own `testID`) now names the status card's Edit, the only one there is. What a module adds
 * beyond the field grid goes into `sections` (main column) and `rail` (beside it); the ingredient
 * page is the reference for both.
 *
 * Below `xl` the rail drops under the main column. The design's rail is `minmax(280px, 1fr)` beside
 * a `2.1fr` column; with the 224px admin sidebar open, `lg` leaves the rail narrower than a field.
 */

/** One read-only pair in the field grid. The Catalogue's name for `RecordWindowField`. */
export type CatalogueViewField = RecordWindowField;

export interface RecordViewSection {
    readonly key: string;
    /** Translated. */
    readonly title: string;
    readonly subtitle?: string | undefined;
    readonly tone?: 'raised' | 'brand' | 'warning' | undefined;
    readonly content: ReactNode;
}

export interface RecordViewPageProps {
    /** Translated record name. Also names the shell trail's leaf. */
    readonly title: string;
    /** Translated kind — "Ingredient", "Supplier". Drawn as a neutral badge beside the title. */
    readonly kind: string;
    /** The record's own reference, mono, beside the title. */
    readonly reference?: string | undefined;
    readonly status?: { readonly label: string; readonly tone: BadgeTone } | undefined;
    /** A status the caller already renders as a node — a list's own badge. Beside `status`. */
    readonly titleAside?: ReactNode | undefined;
    /** Closes the record. Handed to the shell's trail, whose list crumb is the way back. */
    readonly onBack: () => void;
    /** One info banner above the columns, saying what this page cannot do or why it matters. */
    readonly note?: string | undefined;
    /** Translated heading over the field grid. Defaults to "Details". */
    readonly fieldsTitle?: string | undefined;
    readonly fieldsSubtitle?: string | undefined;
    readonly fields: readonly RecordWindowField[];
    /** Main-column cards after the field grid. */
    readonly sections?: readonly RecordViewSection[] | undefined;
    /** Anything the fields cannot hold — a line list. Its own card in the main column. */
    readonly lines?: ReactNode | undefined;
    readonly linesTitle?: string | undefined;
    /** The chip run — allergens, areas, channels. Its own rail card, titled `chipsLabel`. */
    readonly chips?: readonly TagRowItem[] | undefined;
    /** A pre-rendered chip run, for a caller whose chips are not plain tags. */
    readonly chipsContent?: ReactNode | undefined;
    readonly chipsLabel?: string | undefined;
    readonly chipsCaption?: string | undefined;
    readonly chipsSourceBadge?: string | undefined;
    /** Caption lines in the status card — "Updated … by …", "Version 7". */
    readonly statusLines?: readonly string[] | undefined;
    /** One caption at the foot of the status card. */
    readonly footNote?: string | undefined;
    /**
     * Anything the status card says that is not a caption line — a fact the action depends on, or
     * the action's own refusal — drawn above its button, where the reader is about to press.
     */
    readonly statusContent?: ReactNode | undefined;
    /** Rail cards after status and chips. */
    readonly rail?: readonly RecordViewSection[] | undefined;
    /**
     * The record's photograph — a `RecordPhoto` — first in the rail, above the status card.
     *
     * Its own slot rather than `titleAside`, which sits on the title line among the badges and is
     * sized for one, or a `rail` section, which draws after status and chips. A picture is what
     * the eye lands on first in a record page, so it leads the rail; below `xl`, where the rail
     * drops under the main column, it leads that.
     */
    readonly media?: ReactNode | undefined;
    /** The page's one way into the editor. Omit on a record nobody may change here. */
    readonly primaryAction?:
        | {
              readonly label: string;
              readonly onPress: () => void;
              /** `pen` by default — the design's Edit. `null` for an action that is not an edit. */
              readonly icon?: IconName | null | undefined;
              /** Overrides `{testID}-primary`, for a caller whose suite already names the action. */
              readonly testID?: string | undefined;
              /** For an action that writes: both copies spin and neither can be pressed twice. */
              readonly loading?: boolean | undefined;
              readonly disabled?: boolean | undefined;
          }
        | undefined;
    readonly testID: string;
}

export function RecordViewPage({
    title,
    kind,
    reference,
    status,
    titleAside,
    onBack,
    note,
    fieldsTitle,
    fieldsSubtitle,
    fields,
    sections = [],
    lines,
    linesTitle,
    chips,
    chipsContent,
    chipsLabel,
    chipsCaption,
    chipsSourceBadge,
    statusLines = [],
    footNote,
    statusContent,
    rail = [],
    media,
    primaryAction,
    testID,
}: RecordViewPageProps) {
    const { t } = useTranslation();

    useKitchenTrailLeaf(title, onBack);

    const hasChips =
        chipsLabel !== undefined && (chips !== undefined || chipsContent !== undefined);
    const hasStatusCard =
        status !== undefined ||
        statusLines.length > 0 ||
        footNote !== undefined ||
        statusContent !== undefined ||
        primaryAction !== undefined;
    const split = useContentWidth().atLeast(RECORD_SPLIT_MIN);

    const statusCard = !hasStatusCard ? null : (
        <Card
            testID={`${testID}-record-status`}
            tone="brand"
            padding="md"
            title={t('kitchen:recordView.statusTitle')}
        >
            <Stack space="sm">
                {status === undefined ? null : (
                    <View className="flex-row">
                        <Badge tone={status.tone} label={status.label} />
                    </View>
                )}
                {statusLines.map((line, index) => (
                    <Text
                        key={`${String(index)}-${line}`}
                        testID={`${testID}-status-line-${String(index)}`}
                        variant="caption"
                        tone="secondary"
                    >
                        {line}
                    </Text>
                ))}
                {footNote === undefined ? null : (
                    <Text testID={`${testID}-foot-note`} variant="caption" tone="secondary">
                        {footNote}
                    </Text>
                )}
                {statusContent}
                {primaryAction === undefined ? null : (
                    <Button
                        testID={primaryAction.testID ?? `${testID}-primary`}
                        size="sm"
                        block
                        label={primaryAction.label}
                        {...(primaryAction.icon === null
                            ? {}
                            : {
                                  iconStart: <Icon name={primaryAction.icon ?? 'pen'} size="sm" />,
                              })}
                        loading={primaryAction.loading}
                        disabled={primaryAction.disabled}
                        onPress={primaryAction.onPress}
                    />
                )}
            </Stack>
        </Card>
    );

    return (
        <Cascade space="md" testID={testID}>
            <CataloguePageHeader
                testID={`${testID}-header`}
                titleTestID={`${testID}-title`}
                title={title}
                // The trail's list crumb closes the record too, but a crumb is easy to miss: the
                // header names the way back as a control of its own.
                primaryAction={
                    <Button
                        testID={`${testID}-back`}
                        variant="secondary"
                        size="sm"
                        label={t('kitchen:common.back')}
                        iconStart={<Icon name="chevronStart" size="sm" />}
                        onPress={onBack}
                    />
                }
                titleAside={
                    <Inline space="xs" align="center" wrap>
                        <Badge tone="neutral" label={kind} testID={`${testID}-kind`} />
                        {reference === undefined ? null : (
                            <Text variant="mono" tone="secondary" testID={`${testID}-reference`}>
                                {reference}
                            </Text>
                        )}
                        {status === undefined ? null : (
                            <Badge
                                tone={status.tone}
                                label={status.label}
                                testID={`${testID}-status`}
                            />
                        )}
                        {titleAside}
                    </Inline>
                }
            />

            {note === undefined ? null : (
                <Callout testID={`${testID}-note`} tone="info" role="note" title={note} />
            )}

            {/*
             * Two columns where the *page* has room for both, not where the window is wide: on a
             * laptop the window clears `xl` while the content column is ~920px. One column below
             * that, with the status card — the record's state and its one action — opened ahead of
             * the fields rather than left under all of them, past the fold of a 720p screen.
             */}
            <View
                testID={`${testID}-body`}
                className={split ? 'flex-row items-start gap-base' : 'flex-col gap-base'}
            >
                {split ? null : statusCard}
                <View
                    testID={`${testID}-main`}
                    className={
                        split ? 'min-w-0 flex-[21] flex-col gap-base' : 'min-w-0 flex-col gap-base'
                    }
                >
                    <Card
                        tone="raised"
                        padding="md"
                        title={fieldsTitle ?? t('kitchen:recordView.details')}
                        subtitle={fieldsSubtitle}
                    >
                        <RecordWindowFieldGrid fields={fields} testID={`${testID}-field`} />
                    </Card>

                    {sections.map((section) => (
                        <SectionCard key={section.key} section={section} testID={testID} />
                    ))}

                    {lines === undefined ? null : (
                        <Card
                            testID={`${testID}-lines`}
                            tone="raised"
                            padding="md"
                            title={linesTitle}
                        >
                            {lines}
                        </Card>
                    )}
                </View>

                <View
                    testID={`${testID}-rail`}
                    className={
                        split ? 'min-w-0 flex-[10] flex-col gap-base' : 'min-w-0 flex-col gap-base'
                    }
                    style={split ? { minWidth: RECORD_RAIL_MIN } : undefined}
                >
                    {media}

                    {split ? statusCard : null}

                    {hasChips ? (
                        <Card
                            testID={`${testID}-chips`}
                            tone="raised"
                            padding="md"
                            title={chipsLabel}
                        >
                            <Stack space="sm">
                                {chipsSourceBadge === undefined ? null : (
                                    <View className="flex-row">
                                        <Badge
                                            tone="neutral"
                                            label={chipsSourceBadge}
                                            testID={`${testID}-chips-source`}
                                        />
                                    </View>
                                )}
                                {chipsContent ??
                                    (chips === undefined || chips.length === 0 ? null : (
                                        <TagRow items={chips} testID={`${testID}-chip-row`} />
                                    ))}
                                {chipsCaption === undefined ? null : (
                                    <Text variant="caption" tone="secondary">
                                        {chipsCaption}
                                    </Text>
                                )}
                            </Stack>
                        </Card>
                    ) : null}

                    {rail.map((section) => (
                        <SectionCard key={section.key} section={section} testID={testID} />
                    ))}
                </View>
            </View>
        </Cascade>
    );
}

function SectionCard({
    section,
    testID,
}: {
    readonly section: RecordViewSection;
    readonly testID: string;
}) {
    return (
        <Card
            testID={`${testID}-section-${section.key}`}
            tone={section.tone ?? 'raised'}
            padding="md"
            title={section.title}
            subtitle={section.subtitle}
        >
            {section.content}
        </Card>
    );
}
