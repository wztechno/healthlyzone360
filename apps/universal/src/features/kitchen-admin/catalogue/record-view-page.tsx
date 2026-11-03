import {
    Badge,
    Button,
    Callout,
    Cascade,
    Icon,
    InfoTip,
    RecordWindowFieldGrid,
    Stack,
    TagRow,
    useContentWidth,
} from '@healthy360/design-system';
import type { BadgeTone, IconName, RecordWindowField, TagRowItem } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { RECORD_RAIL_MIN, RECORD_SPLIT_MIN } from '../desk-layout.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { RecordCanopy } from './record-canopy.tsx';
import type { RecordCanopyCaption, RecordCanopyTone } from './record-canopy.tsx';
import { RecordTile } from './record-tiles.tsx';

/**
 * The read-only record page behind every kitchen-admin row's View — option C of the
 * `Minimal view page` canvas: the record canopy over a column of tiles and a rail beside it.
 *
 * ```
 * Kitchen workspace › Ingredients › Tahini paste            <- the shell's trail, and the way back
 * ┌ canopy ─────────────────────────────────────────────────────────────────────────────┐
 * │ [‹ Back] Tahini paste ● Published                                        [✎ Edit]   │
 * │          ING-0142 · Ingredient                                                       │
 * │          Updated … by … · Version 7                                                  │
 * └──────────────────────────────────────────────────────────────────────────────────────┘
 * ┌ [≡] Details ─────────────────────────┐  ┌ [photo] ─────────────┐
 * ┌ [◇] section ─────────────────────────┐  ┌ [◈] Allergens & diets┐
 *              2.1fr                                 1fr
 * ```
 *
 * The canopy took over the old header and the Record status card: the status, its caption lines
 * and the one Edit are on the band now, so the rail holds only what a record adds — its picture,
 * its chips, its own cards. `statusContent` — a fact the action depends on — is the rail's first
 * tile, under the band that carries the action.
 *
 * ## It replaces the window, not the list's state
 *
 * Every View used to open a 640px `RecordWindow` over the list. The design draws the record as a
 * page instead: the canopy, a wide column of tiles, and a rail beside it. A caller renders this
 * **in place of** its list while it holds a record,
 * so Back is a state change — the list's page, sort and filters are still in the hook above it —
 * rather than a navigation that would drop them.
 *
 * ## Back is a button and a crumb, and Edit is drawn once
 *
 * `onBack` is handed to the shell's trail (`useKitchenTrailLeaf`), which draws
 * `… › Ingredients › Tahini paste` with **Ingredients** as the link that closes the record — so the
 * trail means the same thing here as on a record that is a route of its own. Readers missed the
 * crumb, so the canopy opens with a `‹ Back` button that does the same (`-back`). Edit is drawn
 * once, at the canopy's inline end beside the status it depends on.
 *
 * ## One shape for every module
 *
 * The props are `RecordWindow`'s, so a screen moves across by swapping the element and turning
 * `onClose` into `onBack`. The test-id suffixes that suites already name — `-title`, `-kind`,
 * `-status`, `-note`, `-field-{key}`, `-chips`, `-body`, `-primary` — are kept; `-primary` (or the
 * action's own `testID`) names the canopy's Edit, the only one there is. What a module adds
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
    /** Behind an (i) beside the title — no sentence is drawn on the page. */
    readonly subtitle?: string | undefined;
    readonly tone?: 'raised' | 'brand' | 'warning' | undefined;
    /** The tile's glyph. `layers` when omitted. */
    readonly icon?: IconName | undefined;
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

function canopyTone(tone: BadgeTone): RecordCanopyTone {
    if (tone === 'success' || tone === 'brand') return 'success';
    if (tone === 'warning' || tone === 'danger') return tone;
    return 'neutral';
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

    const separator = t('kitchen:recordView.metaSeparator');
    const hasChips =
        chipsLabel !== undefined && (chips !== undefined || chipsContent !== undefined);
    const hasRail =
        media !== undefined || statusContent !== undefined || hasChips || rail.length > 0;
    const split = useContentWidth().atLeast(RECORD_SPLIT_MIN);
    const detailsTitle = fieldsTitle ?? t('kitchen:recordView.details');

    const captions: RecordCanopyCaption[] = [
        {
            separator,
            parts: [
                ...(reference === undefined
                    ? []
                    : [{ text: reference, testID: `${testID}-reference` }]),
                { text: kind, testID: `${testID}-kind` },
            ],
        },
        ...(statusLines.length === 0
            ? []
            : [
                  {
                      separator,
                      parts: statusLines.map((line, index) => ({
                          text: line,
                          testID: `${testID}-status-line-${String(index)}`,
                      })),
                  },
              ]),
        ...(footNote === undefined ? [] : [{ text: footNote, testID: `${testID}-foot-note` }]),
    ];

    return (
        <Cascade space="md" testID={testID}>
            <RecordCanopy
                testID={`${testID}-header`}
                titleTestID={`${testID}-title`}
                statusTestID={`${testID}-status`}
                title={title}
                {...(status === undefined
                    ? {}
                    : { status: { label: status.label, tone: canopyTone(status.tone) } })}
                titleBadges={titleAside}
                captions={captions}
                back={
                    <Button
                        testID={`${testID}-back`}
                        variant="secondary"
                        size="sm"
                        label={t('kitchen:common.back')}
                        iconStart={<Icon name="chevronStart" size="sm" />}
                        onPress={onBack}
                    />
                }
                {...(primaryAction === undefined
                    ? {}
                    : {
                          actions: (
                              <Button
                                  testID={primaryAction.testID ?? `${testID}-primary`}
                                  variant="secondary"
                                  size="sm"
                                  label={primaryAction.label}
                                  {...(primaryAction.icon === null
                                      ? {}
                                      : {
                                            iconStart: (
                                                <Icon
                                                    name={primaryAction.icon ?? 'pen'}
                                                    size="sm"
                                                />
                                            ),
                                        })}
                                  loading={primaryAction.loading}
                                  disabled={primaryAction.disabled}
                                  onPress={primaryAction.onPress}
                              />
                          ),
                      })}
                noValue={t('kitchen:list.noValue')}
            />

            {note === undefined ? null : (
                <Callout testID={`${testID}-note`} tone="info" role="note" title={note} />
            )}

            {/*
             * Two columns where the *page* has room for both, not where the window is wide: on a
             * laptop the window clears `xl` while the content column is ~920px. One column below
             * that, the rail under the main column — the action lives on the canopy above both.
             */}
            <View
                testID={`${testID}-body`}
                className={
                    split ? 'z-auto flex-row items-start gap-base' : 'z-auto flex-col gap-base'
                }
            >
                <View
                    testID={`${testID}-main`}
                    className="z-auto min-w-0 flex-col gap-base"
                    style={split ? { flex: hasRail ? 21 : 1 } : undefined}
                >
                    <RecordTile
                        testID={`${testID}-details`}
                        icon="list"
                        title={detailsTitle}
                        trailing={
                            fieldsSubtitle === undefined ? undefined : (
                                <InfoTip label={detailsTitle} text={fieldsSubtitle} />
                            )
                        }
                    >
                        <RecordWindowFieldGrid fields={fields} testID={`${testID}-field`} />
                    </RecordTile>

                    {sections.map((section) => (
                        <SectionTile key={section.key} section={section} testID={testID} />
                    ))}

                    {lines === undefined ? null : (
                        <RecordTile testID={`${testID}-lines`} icon="layers" title={linesTitle}>
                            {lines}
                        </RecordTile>
                    )}
                </View>

                {hasRail ? (
                    <View
                        testID={`${testID}-rail`}
                        className="z-auto min-w-0 flex-col gap-base"
                        style={split ? { flex: 10, minWidth: RECORD_RAIL_MIN } : undefined}
                    >
                        {media}

                        {statusContent === undefined ? null : (
                            <RecordTile
                                testID={`${testID}-record-status`}
                                icon="infoCircle"
                                title={t('kitchen:recordView.statusTitle')}
                            >
                                {statusContent}
                            </RecordTile>
                        )}

                        {hasChips ? (
                            <RecordTile
                                testID={`${testID}-chips`}
                                icon="tag"
                                title={chipsLabel}
                                aside={
                                    chipsSourceBadge === undefined ? undefined : (
                                        <Badge
                                            tone="neutral"
                                            label={chipsSourceBadge}
                                            testID={`${testID}-chips-source`}
                                        />
                                    )
                                }
                                trailing={
                                    chipsCaption === undefined ? undefined : (
                                        <InfoTip label={chipsLabel} text={chipsCaption} />
                                    )
                                }
                            >
                                <Stack space="sm">
                                    {chipsContent ??
                                        (chips === undefined || chips.length === 0 ? null : (
                                            <TagRow items={chips} testID={`${testID}-chip-row`} />
                                        ))}
                                </Stack>
                            </RecordTile>
                        ) : null}

                        {rail.map((section) => (
                            <SectionTile key={section.key} section={section} testID={testID} />
                        ))}
                    </View>
                ) : null}
            </View>
        </Cascade>
    );
}

function SectionTile({
    section,
    testID,
}: {
    readonly section: RecordViewSection;
    readonly testID: string;
}) {
    return (
        <RecordTile
            testID={`${testID}-section-${section.key}`}
            icon={section.icon ?? 'layers'}
            title={section.title}
            tone={section.tone ?? 'raised'}
            trailing={
                section.subtitle === undefined ? undefined : (
                    <InfoTip label={section.title} text={section.subtitle} />
                )
            }
        >
            {section.content}
        </RecordTile>
    );
}
