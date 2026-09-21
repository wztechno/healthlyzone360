import {
    Badge,
    Button,
    Callout,
    Card,
    Icon,
    Inline,
    PageTransition,
    RecordWindowFieldGrid,
    Stack,
    TagRow,
    Text,
} from '@healthy360/design-system';
import type { BadgeTone, IconName, RecordWindowField, TagRowItem } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

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
 * ## The trail is the way back, and Edit is drawn once
 *
 * The header used to carry `‹ Back to list` and an Edit button, and the status card carried a second
 * Edit — two identical controls on one screen, and a Back that repeated the trail's own job. Both
 * are gone from the header. `onBack` is handed to the shell's trail instead
 * (`useKitchenTrailLeaf`), which draws `… › Ingredients › Tahini paste` with **Ingredients** as the
 * link that closes the record — so the trail means the same thing here as on a record that is a
 * route of its own. Edit lives in the status card, beside the facts that decide whether to press it.
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
     * The page's one way into the editor, drawn in the status card. Omit on a record nobody may
     * change here.
     */
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

    return (
        <PageTransition testID={testID} transitionKey={testID}>
            <Stack space="md">
                <CataloguePageHeader
                    testID={`${testID}-header`}
                    titleTestID={`${testID}-title`}
                    title={title}
                    titleAside={
                        <Inline space="xs" align="center" wrap>
                            <Badge tone="neutral" label={kind} testID={`${testID}-kind`} />
                            {reference === undefined ? null : (
                                <Text
                                    variant="mono"
                                    tone="secondary"
                                    testID={`${testID}-reference`}
                                >
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

                <View
                    testID={`${testID}-body`}
                    className="flex-col gap-base xl:flex-row xl:items-start"
                >
                    <View
                        testID={`${testID}-main`}
                        className="min-w-0 flex-col gap-base xl:flex-[21]"
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
                        className="min-w-0 flex-col gap-base xl:flex-[10]"
                    >
                        {hasStatusCard ? (
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
                                        <Text
                                            testID={`${testID}-foot-note`}
                                            variant="caption"
                                            tone="secondary"
                                        >
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
                                    )}
                                </Stack>
                            </Card>
                        ) : null}

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
            </Stack>
        </PageTransition>
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
