import {
    Badge,
    Callout,
    Cascade,
    InfoTip,
    RecordWindowFieldGrid,
    Stack,
    TagRow,
    Text,
} from '@healthy360/design-system';
import type { BadgeTone, IconName, RecordWindowField, TagRowItem } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { RECORD_RAIL_MIN } from '../desk-layout.ts';
import { RecordCanopy, RecordCanopyHero } from './record-canopy.tsx';
import { RecordPopup, useRecordSplit } from './record-popup.tsx';
import type { RecordAction, RecordPrimaryAction } from './record-popup.tsx';
import type { RecordCanopyCaption, RecordCanopyTone } from './record-canopy.tsx';
import { RecordTile } from './record-tiles.tsx';

/**
 * The read-only record behind every kitchen-admin row's View — the record canopy over a column of
 * tiles and a rail beside it, opened as a pop-up over the list (`View as a pop-up`, 2026-11-07).
 *
 * ```
 * Kitchen workspace › Ingredients › Tahini paste            <- the shell's trail; the list crumb closes
 * ┌ window ───────────────────────────────────────────────────────── 880 ┐
 * │ INGREDIENT                                                  [⋯] [✕] │
 * │ ┌ canopy ─ Tahini paste ● Published · ING-0142 · Ingredient ───────┐ │
 * │ ┌ [≡] Details ──────────────────┐  ┌ [photo] ─────────────┐         │
 * │ ┌ [◇] section ──────────────────┐  ┌ [◈] Allergens & diets┐         │
 * └──────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## The list stays
 *
 * A caller renders its list as always and this beside it while it holds a record. Closing is a
 * state change — the list's page, sort and filters were never left.
 *
 * ## Every action is behind ⋯
 *
 * `primaryAction` (Edit, usually) is the menu's first entry, in brand ink, `-primary` by default;
 * `actions` follow it. Nothing on the canopy or in a tile is a button any more — what used to sit
 * in a tile (Record a payment, Assign a driver) is an entry here, and one that opens a dialog of its
 * own opens it over the window. `statusContent` still says the fact an action depends on.
 *
 * ## One shape for every module
 *
 * The test-id suffixes suites name — `-title`, `-kind`, `-status`, `-note`, `-field-{key}`,
 * `-chips`, `-body`, `-primary` — are kept; the window adds `-close`, `-actions` (the ⋯),
 * `-backdrop` and `-eyebrow`. What a module adds beyond the field grid goes into `sections` (main
 * column) and `rail` (beside it).
 *
 * The rail drops under the main column where the window is narrower than two columns need
 * (`useRecordSplit`).
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
    /** Closes the record — ✕, the backdrop, Escape, and the shell trail's list crumb. */
    readonly onBack: () => void;
    /** One info banner above the columns, saying what this page cannot do or why it matters. */
    readonly note?: string | undefined;
    /**
     * A refusal the reader must see — a write the server turned down — above the note. A page's
     * issue tray would sit behind the pop-up's backdrop, so a record's own failures are drawn here.
     */
    readonly banner?: ReactNode | undefined;
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
    /**
     * The record's primary — Edit, usually — listed first in the ⋯ menu, in brand ink. `-primary`
     * (or its own `testID`) names it. Omit on a record nobody may change here.
     */
    readonly primaryAction?: RecordPrimaryAction | undefined;
    /** Every other action the record has, behind ⋯ after the primary, in order. */
    readonly actions?: readonly RecordAction[] | undefined;
    /**
     * `board` is the Catalogue boards' drawing: the large canopy with the status as a pill, tiles
     * with a title and no glyph, and fields as label-and-value rows. Every other View page keeps
     * the default until its own boards are applied.
     */
    readonly look?: 'default' | 'board' | undefined;
    /** Translated. The window's upper label, where it is not the record's `kind`. */
    readonly eyebrow?: string | undefined;
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
    banner,
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
    actions,
    look = 'default',
    eyebrow,
    testID,
}: RecordViewPageProps) {
    const { t } = useTranslation();
    const board = look === 'board';

    const separator = t('kitchen:recordView.metaSeparator');
    const hasChips =
        chipsLabel !== undefined && (chips !== undefined || chipsContent !== undefined);
    const hasRail =
        media !== undefined || statusContent !== undefined || hasChips || rail.length > 0;
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

    const chipsBadge =
        chipsSourceBadge === undefined ? undefined : (
            <Badge
                tone="neutral"
                icon={board ? null : undefined}
                label={chipsSourceBadge}
                testID={`${testID}-chips-source`}
            />
        );
    const chipsTip =
        chipsCaption === undefined || chipsLabel === undefined ? undefined : (
            <InfoTip label={chipsLabel} text={chipsCaption} />
        );

    return (
        <RecordPopup
            title={title}
            kind={eyebrow ?? kind}
            onClose={onBack}
            primaryAction={primaryAction}
            actions={actions}
            testID={testID}
        >
            <Cascade space="md" testID={testID}>
                {board ? (
                    <RecordCanopyHero
                        testID={`${testID}-header`}
                        titleTestID={`${testID}-title`}
                        statusTestID={`${testID}-status`}
                        referenceTestID={`${testID}-reference`}
                        kindTestID={`${testID}-kind`}
                        title={title}
                        reference={reference}
                        kind={kind}
                        {...(status === undefined
                            ? {}
                            : {
                                  statusChip: {
                                      label: status.label,
                                      tone: canopyTone(status.tone),
                                  },
                              })}
                        captionLines={[
                            ...statusLines.map((line, index) => ({
                                text: line,
                                testID: `${testID}-status-line-${String(index)}`,
                            })),
                            ...(footNote === undefined
                                ? []
                                : [{ text: footNote, testID: `${testID}-foot-note` }]),
                        ]}
                    />
                ) : (
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
                        noValue={t('kitchen:list.noValue')}
                    />
                )}

                {banner}

                {note === undefined ? null : (
                    <Callout testID={`${testID}-note`} tone="info" role="note" title={note} />
                )}

                {/*
                 * Two columns where the *window* has room for both, the rail under the main column
                 * below that. Read inside the window (`SplitBody`), where the width is its own.
                 */}
                <SplitBody testID={`${testID}-body`}>
                    {(split) => (
                        <>
                            <View
                                testID={`${testID}-main`}
                                className="z-auto min-w-0 flex-col gap-base"
                                style={split ? { flex: hasRail ? 21 : 1 } : undefined}
                            >
                                <RecordTile
                                    testID={`${testID}-details`}
                                    {...(board ? {} : { icon: 'list' as const })}
                                    title={detailsTitle}
                                    trailing={
                                        fieldsSubtitle === undefined ? undefined : (
                                            <InfoTip label={detailsTitle} text={fieldsSubtitle} />
                                        )
                                    }
                                >
                                    {board ? (
                                        <BoardFieldRows
                                            fields={fields}
                                            testID={`${testID}-field`}
                                        />
                                    ) : (
                                        <RecordWindowFieldGrid
                                            fields={fields}
                                            testID={`${testID}-field`}
                                        />
                                    )}
                                </RecordTile>

                                {sections.map((section) => (
                                    <SectionTile
                                        key={section.key}
                                        section={section}
                                        board={board}
                                        testID={testID}
                                    />
                                ))}

                                {lines === undefined ? null : (
                                    <RecordTile
                                        testID={`${testID}-lines`}
                                        {...(board ? {} : { icon: 'layers' as const })}
                                        title={linesTitle}
                                    >
                                        {lines}
                                    </RecordTile>
                                )}
                            </View>

                            {hasRail ? (
                                <View
                                    testID={`${testID}-rail`}
                                    className="z-auto min-w-0 flex-col gap-base"
                                    style={
                                        split ? { flex: 10, minWidth: RECORD_RAIL_MIN } : undefined
                                    }
                                >
                                    {media}

                                    {statusContent === undefined ? null : (
                                        <RecordTile
                                            testID={`${testID}-record-status`}
                                            {...(board ? {} : { icon: 'infoCircle' as const })}
                                            title={t('kitchen:recordView.statusTitle')}
                                        >
                                            {statusContent}
                                        </RecordTile>
                                    )}

                                    {hasChips ? (
                                        <RecordTile
                                            testID={`${testID}-chips`}
                                            {...(board ? {} : { icon: 'tag' as const })}
                                            title={chipsLabel}
                                            // The board has the (i) beside the title and the source
                                            // badge at the end; the default has them the other way.
                                            aside={board ? chipsTip : chipsBadge}
                                            trailing={board ? chipsBadge : chipsTip}
                                        >
                                            <Stack space="sm">
                                                {chipsContent ??
                                                    (chips === undefined ||
                                                    chips.length === 0 ? null : (
                                                        <TagRow
                                                            items={chips}
                                                            testID={`${testID}-chip-row`}
                                                        />
                                                    ))}
                                            </Stack>
                                        </RecordTile>
                                    ) : null}

                                    {rail.map((section) => (
                                        <SectionTile
                                            key={section.key}
                                            section={section}
                                            board={board}
                                            testID={testID}
                                        />
                                    ))}
                                </View>
                            ) : null}
                        </>
                    )}
                </SplitBody>
            </Cascade>
        </RecordPopup>
    );
}

/**
 * The body's row or column. A component of its own so `useRecordSplit` is read under the pop-up's
 * providers — called in `RecordViewPage` itself, it would measure the page behind the window.
 */
function SplitBody({
    testID,
    children,
}: {
    readonly testID: string;
    readonly children: (split: boolean) => ReactNode;
}) {
    const split = useRecordSplit();
    return (
        <View
            testID={testID}
            className={split ? 'z-auto flex-row items-start gap-base' : 'z-auto flex-col gap-base'}
        >
            {children(split)}
        </View>
    );
}

/** Past this a value is a sentence, not a figure: it takes the whole line. */
const LONG_VALUE_LENGTH = 48;

/** The board's fields: a muted label and a bold value on one line, two to a row where they fit. */
function BoardFieldRows({
    fields,
    testID,
}: {
    readonly fields: readonly RecordWindowField[];
    readonly testID: string;
}) {
    return (
        <View testID={testID} className="flex-row flex-wrap gap-x-6">
            {fields.map((field) => (
                <View
                    key={field.key}
                    testID={`${testID}-${field.key}`}
                    className="min-h-8 min-w-0 flex-row items-center justify-between gap-snug"
                    style={{
                        flexBasis: field.value.length > LONG_VALUE_LENGTH ? '100%' : '45%',
                        // eslint-disable-next-line no-restricted-syntax -- one read-only pair in a wrapping run: two to a line at most, and a sentence takes the whole line.
                        flexGrow: 1,
                    }}
                >
                    <View className="shrink-0">
                        <Text
                            variant="body"
                            tone="secondary"
                            testID={`${testID}-${field.key}-label`}
                        >
                            {field.label}
                        </Text>
                    </View>
                    <View className="min-w-0 shrink">
                        <Text
                            variant="strong"
                            className="tabular-nums text-end"
                            testID={`${testID}-${field.key}-value`}
                        >
                            {field.value}
                        </Text>
                    </View>
                </View>
            ))}
        </View>
    );
}

function SectionTile({
    section,
    board = false,
    testID,
}: {
    readonly section: RecordViewSection;
    readonly board?: boolean | undefined;
    readonly testID: string;
}) {
    return (
        <RecordTile
            testID={`${testID}-section-${section.key}`}
            {...(board ? {} : { icon: section.icon ?? ('layers' as const) })}
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
