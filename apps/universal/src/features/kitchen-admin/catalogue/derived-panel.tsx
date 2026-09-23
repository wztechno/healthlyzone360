import { Card, Text, cx } from '@healthy360/design-system';
import { cardWidth, neutral } from '@healthy360/design-tokens';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Text as RNText, TextInput, View } from 'react-native';

/**
 * A read-only confirmation panel for figures that resolve from somewhere else — handoff §6.2.
 *
 * ```
 * COMPOSITION & ALLERGENS   FROM DATABASE
 * Nutrients and allergen classes resolve from the reference food database…
 * ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
 * │ ENERGY        │ │ FAT           │ │ CARBS         │ │ PROTEIN       │
 * │ 680           │ │ 74.8          │ │ 1.4           │ │ 1.1           │
 * │ kcal / 100 g  │ │ g / 100 g     │ │ g / 100 g     │ │ g / 100 g     │
 * └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘
 * ( Egg ) ( Mustard )
 * ```
 *
 * §6.2 makes the same panel serve the ingredient editor's composition and the recipe editor's
 * rolled-up allergens, so it lives here rather than in either screen. The two differ only in what
 * they put in `figures` and `chips`: an ingredient reads its own `per100g`, a recipe reads a
 * mass-weighted roll-up over its lines and labels each chip with the raw material it came from.
 *
 * ## Everything about it says "not yours to type"
 *
 * The sunken fill, the secondary ink on the figure and the badge in the section header all carry
 * the same message, and they are deliberately redundant: a reader who does not notice the fill is
 * told in words by the description line, and a reader who does not read the description sees a
 * value that is not sitting in an input frame. There is no disabled control anywhere in here,
 * because a disabled control is a claim that it would be editable under some other circumstance —
 * and it would not. A correction happens on the ingredient, never here.
 *
 * The figure keeps `secondary` ink rather than `primary` for the same reason. That is the one
 * choice in this component a reader might argue with — it is real information, so why is it
 * quietened? Because the panel's job is confirmation, not reading: the numbers are here so somebody
 * can notice a wrong one before saving, and the fields above are where the work is. Size and ink
 * are separate levers, and this spends them in opposite directions on purpose: large enough to
 * scan four tiles at a glance, grey enough that it never competes with the fields above.
 *
 * ## The figure is the one place here that reaches past `Text`
 *
 * The design sets it at 16px 600 in IBM Plex Mono. The ramp has no 16px mono step — §1.2 gives mono
 * exactly one size (the `body` step, 12px) — and CLAUDE.md forbids adding half-steps to the scale.
 * Rendering it at 12px would leave the figure the same size as the unit beneath it and collapse the
 * tile's whole shape; so it takes `role-display`, the ramp's one large step, in the mono family.
 *
 * That combination cannot come from `Text`: its variant classes are emitted ahead of a caller's
 * `className` and which of two same-specificity utilities wins is decided by stylesheet order, so
 * `<Text variant="display" className="tabular-nums">` is a coin toss. `Text`'s own docblock names this
 * exact case — "a display-face price" — and points at React Native's `Text` with the classes stated
 * where nothing competes with them. `CatalogueStatCards` reaches for `display` on the same shape of
 * thing for the same reason; this is that decision with the mono family the tokens now carry.
 *
 * ## The cards are always drawn; a missing figure is an em dash, never a zero
 *
 * The panel keeps its four tiles whether or not the record has facts behind them, because the row
 * of cards *is* the section — a paragraph reading "no reference facts are recorded" in the space
 * where four figures belong tells the reader the panel is broken rather than that the data is
 * absent, and it makes the section change height as you move between records.
 *
 * What is never drawn is a `0`. A zero is a nutritional claim and this panel is the last thing
 * somebody looks at before a label goes out, so an absent figure renders as `emptyValue` — an em
 * dash — which says "not recorded" in the one place a reader is already looking.
 */

export interface DerivedFigure {
    readonly key: string;
    /** Rendered on the `micro` step — 10px. Already translated. */
    readonly label: string;
    /**
     * Already formatted to the nutrient's own precision, or `null` when the record has no figure.
     * The caller owns the numbering; this component owns what absence looks like.
     */
    readonly value: string | null;
    /** The basis, e.g. `kcal / 100 g`. Sits under the figure. */
    readonly unit: string;
    /**
     * Makes the figure typeable — `outline` only. See {@link DerivedFigureInput}. `value` is then
     * ignored: the input's own text is the figure.
     */
    readonly input?: DerivedFigureInput | undefined;
}

/**
 * The figure as an input inside its own card — the ingredient editor's nutrition, where a kitchen
 * records the per-100 g figures it reads off a supplier's label.
 *
 * The same tile as the read-only one, on purpose: the design draws the nutrition of an ingredient
 * and of a recipe as one row of cards, and a reader moving between the two should meet one shape.
 * What changes is that the figure is a borderless input and the *card* is its frame — the card's
 * hairline takes the focus ring and the error border that an input frame would otherwise carry, so
 * the tile never grows a box inside a box.
 */
export interface DerivedFigureInput {
    readonly value: string;
    readonly onChangeText: (next: string) => void;
    readonly disabled?: boolean | undefined;
    /** Draws the danger border. The message lives beside the row, not on eight cards. */
    readonly invalid?: boolean | undefined;
    /** The control's id — what a banner chip focuses. */
    readonly nativeID?: string | undefined;
    readonly testID?: string | undefined;
}

export interface DerivedPanelProps {
    /**
     * The tiles to draw, whether or not they have values.
     *
     * The caller states the full set — the four the design draws — and leaves `value` as `null` on
     * the ones the record cannot fill. See the note above on why the row does not collapse.
     */
    /**
     * One line saying where the values came from and that they cannot be edited. Optional: the
     * stepped editors leave it out and let the sunken fill say it.
     *
     * The `From database` badge is *not* a prop. It belongs beside the section title, which is
     * `FormSection`'s `aside` and not this component's business — the panel is the content, and
     * putting a second badge inside it would state the same thing twice, ten pixels apart.
     */
    readonly description?: string | undefined;
    readonly figures: readonly DerivedFigure[];
    /** Stands in for a figure the record has not got. An em dash, not a zero. */
    readonly emptyValue: string;
    /** Read-only `Tag`s — an ingredient's allergen classes. An empty set simply draws nothing. */
    readonly chips?: ReactNode | undefined;
    /**
     * `sunken` (the default) is the confirmation well described above: recessed fill, secondary
     * ink, the unit under the figure. `outline` is the Catalogue Forms tile — a raised card with a
     * hairline, the figure in primary ink and the unit beside it on the baseline — for a sheet the
     * reader opens *to read* the figures, the recipe's technical sheet, rather than to confirm them
     * on the way past. An absent figure still reads as absent: the em dash drops to secondary ink.
     */
    readonly variant?: 'sunken' | 'outline' | undefined;
    readonly testID: string;
}

export function DerivedPanel({
    description,
    figures,
    emptyValue,
    chips,
    variant = 'sunken',
    testID,
}: DerivedPanelProps) {
    return (
        <View testID={testID} className="flex-col gap-snug">
            {description === undefined ? null : (
                <Text testID={`${testID}-description`} variant="caption" tone="secondary">
                    {description}
                </Text>
            )}

            {figures.length === 0 ? null : (
                /*
                 * A wrapping row of fixed 200px tiles rather than `CardGrid`, for the reason
                 * `CatalogueStatCards` states: `CardGrid`'s track is `minmax(200px, 260px)` and
                 * with room to spare it resolves to the *max*, which is not the row the design
                 * draws. Pinning `cardWidth.min` gives the design's `repeat(4, 200px)` and wraps
                 * to three-plus-one on a narrow port instead of squeezing four.
                 */
                <View testID={`${testID}-figures`} className="flex-row flex-wrap gap-tight">
                    {figures.map((figure) =>
                        variant === 'outline' ? (
                            <OutlineTile
                                key={figure.key}
                                figure={figure}
                                emptyValue={emptyValue}
                                testID={`${testID}-figure-${figure.key}`}
                            />
                        ) : (
                            <View key={figure.key} style={{ width: cardWidth.min }}>
                                <Card
                                    testID={`${testID}-figure-${figure.key}`}
                                    tone="sunken"
                                    padding="sm"
                                >
                                    <Text variant="micro" tone="secondary">
                                        {figure.label}
                                    </Text>
                                    <RNText
                                        testID={`${testID}-figure-${figure.key}-value`}
                                        className="text-role-display tabular-nums text-content-secondary text-start"
                                    >
                                        {figure.value ?? emptyValue}
                                    </RNText>
                                    {/*
                                     * `caption`, not `micro`. The design sets this line at 10px,
                                     * which is `micro`'s size — but `micro` is the column-label step,
                                     * 600 weight, and `kcal / 100 g` is a unit rather than a label for
                                     * the figure above it. 11px at regular weight is what a unit is.
                                     */}
                                    <Text variant="caption" tone="secondary">
                                        {figure.unit}
                                    </Text>
                                </Card>
                            </View>
                        ),
                    )}
                </View>
            )}

            {chips === undefined ? null : (
                <View testID={`${testID}-chips`} className="flex-row flex-wrap gap-control-sm">
                    {chips}
                </View>
            )}
        </View>
    );
}

/**
 * One `outline` card. A component of its own because an editable one holds its focus state, and the
 * card's border is where that state is drawn.
 */
function OutlineTile({
    figure,
    emptyValue,
    testID,
}: {
    readonly figure: DerivedFigure;
    readonly emptyValue: string;
    readonly testID: string;
}) {
    const [focused, setFocused] = useState(false);
    const input = figure.input;

    return (
        <View
            testID={testID}
            style={{ width: cardWidth.min }}
            className={cx(
                'flex-col gap-hair rounded-md border px-snug py-tight',
                input?.disabled === true ? 'bg-surface-sunken' : 'bg-surface-raised',
                input?.invalid === true
                    ? 'border-danger-border'
                    : focused
                      ? 'border-stroke-focus'
                      : 'border-stroke-subtle',
            )}
        >
            <Text variant="micro" tone="secondary">
                {figure.label}
            </Text>
            <View className="flex-row items-baseline gap-hair">
                {input === undefined ? (
                    <RNText
                        testID={`${testID}-value`}
                        className={
                            figure.value === null
                                ? 'text-role-display tabular-nums text-content-secondary text-start'
                                : 'text-role-display tabular-nums text-content-primary text-start'
                        }
                    >
                        {figure.value ?? emptyValue}
                    </RNText>
                ) : (
                    <TextInput
                        testID={input.testID}
                        nativeID={input.nativeID}
                        value={input.value}
                        onChangeText={input.onChangeText}
                        editable={input.disabled !== true}
                        // The label and unit are two separate texts on the card; the control
                        // carries both, because "Energy" alone does not say kilocalories.
                        accessibilityLabel={`${figure.label} (${figure.unit})`}
                        aria-invalid={input.invalid === true}
                        inputMode="decimal"
                        keyboardType="decimal-pad"
                        placeholder={emptyValue}
                        placeholderTextColor={neutral[600]}
                        onFocus={() => {
                            setFocused(true);
                        }}
                        onBlur={() => {
                            setFocused(false);
                        }}
                        // `min-w-0` releases a web `<input>`'s intrinsic width, or the unit is
                        // pushed out past the card's edge.
                        className={cx(
                            // eslint-disable-next-line no-restricted-syntax -- the card is a fixed 200px tile; the input fills what its unit leaves.
                            'min-w-0 flex-1 border-0 bg-transparent p-0 text-role-display tabular-nums text-start outline-none',
                            input.disabled === true
                                ? 'text-content-secondary'
                                : 'text-content-primary',
                        )}
                    />
                )}
                <Text variant="caption" tone="secondary">
                    {figure.unit}
                </Text>
            </View>
        </View>
    );
}
