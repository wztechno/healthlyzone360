import { Button, Rating } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { findAmount } from '@healthy360/nutrition';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { EntityImage, MediaChip } from '../../media/entity-image.tsx';
import { BrowseCard } from '../../ui/browse-card.tsx';

import { formatMoney, nutrientValue } from './format.ts';

/**
 * A meal on a kitchen's menu.
 *
 * The shape is {@link BrowseCard}, shared with the kitchen card. What is left here is the mapping
 * and the two things that are particular to a meal: the safety line and the price.
 *
 * ## Nutrition on the card
 *
 * Energy and protein are on the card, not behind a tap. Neither reference product does this
 * (doc 17, IA-12 and MKT-05 record it as a deliberate divergence, and as a differentiator): in a
 * nutrition-led product, hiding the calorie figure until the detail page works against the entire
 * proposition. Allergens present in the meal are named on the card for the same reason — someone
 * scanning a menu for something they can safely eat should not have to open twelve of them.
 *
 * Until the Wellness Green pass that claim was only half true: energy and protein were rendered as
 * two neutral badges in the middle of the card, where they read as tags rather than as figures.
 * That pass made them four labelled columns in the footer — kcal, protein, carbs, fat.
 *
 * The HealthZone pass narrows them to one row, and that row now carries all four again — energy,
 * protein, carbohydrate and fat — rather than as four labelled columns. The columns were what could
 * not share a 250-unit card with a price *and* an Add control. The rating moved up to the title's
 * baseline to free that width, and a figure appears only when the kitchen published that nutrient.
 *
 * The four are drawn as four equal tiles rather than as one run of joined text — each a bold figure
 * stacked over its name, with a fill and a real gap between them, energy tinted because it is the
 * figure being scanned for. Stacking is what pays for the names: `42g P` was an abbreviation forced
 * by four labels sharing one line, and a tile headed `Protein` needs neither the letter nor the
 * unit. It is also what the card can afford, since a tile is as wide as its longer line rather than
 * as wide as both.
 *
 * ## Why the footer is pinned, and why it draws its own rule
 *
 * The price is the one number a shopper compares *across* cards, and in a grid of cards whose
 * heights follow their own content it lands at a different height in every one. `Card`'s `footer`
 * pins it: the body takes the slack and every footer in a row shares one baseline, however long the
 * description, and whether or not this meal has an allergen to declare.
 *
 * That is also why this card passes `footerRule={false}`. The safety line and the figures belong in
 * the pinned block, *above* the rule, with only the price and its control below it — so the rule
 * sits further down than the one `BrowseCard` draws by default rather than at the top of the block.
 *
 * ## Two species, one skeleton
 *
 * The grid renders `meal` and `product` items together, and a product has no description, no diet
 * classifications and no nutrition. It gets the same card with those parts absent and **the price
 * in the same place**, because a row that mixes the two still has to let the eye run along one
 * line of prices.
 *
 * ## Where pressing it goes
 *
 * Wherever the parent says. Until the catalogue wave landed there was no `/meals/{meal}` to link
 * to, so the menu answered a press with an in-place drawer; now the record exists, every caller
 * navigates to it and the drawer is gone. The card itself never knew the difference — `onPress` is
 * the whole contract, which is why the handoff cost this component nothing but a paragraph.
 *
 * The whole card is one target **only while there is nothing inside it to press**. Supplying
 * `onAdd` changes that: a focusable thing inside a `button` is an axe `nested-interactive` failure,
 * so a card with an Add control makes its title the link instead — `BrowseCard`'s `titleAction`.
 * See `onAdd` for the full note.
 *
 * The diet classifications are no longer on the card at all — neither the cluster that sat under
 * the description nor the badge that briefly replaced it. The photograph carries one chip, the
 * kitchen, because a grid of pictures wearing two pills each reads as clutter. The classifications
 * filter the catalogue and are listed on the meal's own page, which is where a press lands anyway.
 */
export interface MealCardProps {
    readonly meal: MarketplaceMeal;
    readonly onPress: () => void;
    /**
     * Adds the meal to the basket straight from the grid.
     *
     * Supplying it **changes what the card is**. A control inside a pressable card is an axe
     * `nested-interactive` failure, unreachable by keyboard and ambiguous on touch — the reason
     * `plan-card.tsx` is deliberately not one big target. So a card with an Add button stops being
     * one: the title becomes the link to the meal, and Add is a second, separate control.
     *
     * Omit it and the card keeps today's behaviour, one pressable target and no nested control.
     */
    readonly onAdd?: (() => void) | undefined;
    readonly testID?: string | undefined;
}

export function MealCard({ meal, onPress, onAdd, testID }: MealCardProps) {
    const { t } = useTranslation();
    const formatter: Formatter = useFormatter();
    const resolvedTestID = testID ?? `meal-card-${meal.slug}`;

    const energy = nutrientValue(meal.nutrition, 'energy');
    const protein = nutrientValue(meal.nutrition, 'protein');
    const isMeal = meal.itemType === 'meal';
    const hasNutrition = isMeal && meal.nutrition.amounts.length > 0;
    const hasAllergens = meal.allergens.length > 0;

    /*
     * The four figures, and only the ones the kitchen actually published.
     *
     * `findAmount` returns null for a nutrient the set does not carry, where `nutrientValue` returns
     * zero — and "0 fat" is a claim about the food, not an absence of one. A meal that publishes
     * only energy and protein therefore shows two figures rather than two real ones and two
     * fictions.
     *
     * The value and its name are two strings, not one. They were one — `menu.statLine`'s
     * `{{value}}g P` — because the four had to share a single line, and squeezing them onto one
     * meant abbreviating the name to a letter and pinning the unit to the number. Stacked, there is
     * room to say `Protein` in full, and `menu.stats` already held those four names from the
     * four-column pass that preceded the compact line. `statLine` is retired with the line it was
     * shaped for.
     */
    const figures = (['energy', 'protein', 'carbohydrate', 'fat'] as const)
        .filter((nutrientId) => findAmount(meal.nutrition, nutrientId) !== null)
        .map((nutrientId) => ({
            key: nutrientId,
            value: formatter.formatNumber(nutrientValue(meal.nutrition, nutrientId)),
            label: t(`marketplace:menu.stats.${nutrientId}`),
        }));

    /*
     * A card with an Add button is not itself a button.
     *
     * `nested-interactive`: a control inside a pressable is unreachable by keyboard and ambiguous
     * on touch, which is exactly why `plan-card.tsx` refuses to be one big target. So the whole
     * card is pressable only while there is nothing inside it to press — otherwise the title
     * carries the link and Add stands beside it as a peer.
     */
    const wholeCardIsPressable = onAdd === undefined;
    const openLabel = t('marketplace:menu.cardLabel', {
        meal: meal.name,
        energy,
        protein,
    });

    const footer = (
        <View className="flex-col gap-3">
            {/*
             * Only when there is something to declare.
             *
             * This line used to be drawn either way — "the kitchen declares no allergens" at a fixed
             * height, so the figures below could not shift between neighbouring cards. Two reasons
             * it goes: a row of cards each announcing what they do *not* contain is noise on the
             * scan the grid exists for, and the price no longer depends on it staying — `Card`'s
             * footer pins that to the foot of the card whatever the body does.
             *
             * The claim itself is not dropped. `menu.noDeclaredAllergens` is still stated in full on
             * the meal's own page, which is where somebody deciding whether they can safely eat
             * something reads rather than guesses.
             */}
            {hasAllergens ? (
                <View className="flex-row items-center gap-2">
                    <View className="h-1.5 w-1.5 rounded-full bg-warning" />
                    <RNText
                        testID={`${resolvedTestID}-allergens`}
                        numberOfLines={1}
                        className="flex-1 text-xs text-warning-on-subtle text-start"
                    >
                        {t('marketplace:menu.containsAllergens', {
                            allergens: meal.allergens
                                .map((code) => t(`marketplace:allergens.${code}`))
                                .join(t('marketplace:common.listSeparator')),
                        })}
                    </RNText>
                </View>
            ) : null}

            {/*
             * All four macros, each one a figure stacked over its name.
             *
             * Energy, protein, carbohydrate and fat — the four this product exists to publish. They
             * were one uppercase `Text` with the figures joined by two spaces, because as bare text
             * siblings under `gap-x-3` React Native Web collapsed the gap and rendered
             * `500 CAL50G PROTEIN` — a single nonsense number at a glance. Padding the separator
             * into the string fixed the collision but not the reading: four figures set in one
             * weight, one colour and one run of text is a string to decode rather than four facts
             * to scan.
             *
             * **The stack is what buys the width.** Side by side, a name and its number have to
             * share one card-width line four times over, which is what forced `42g P` — the name
             * abbreviated to a letter and the unit welded to the number. Stacked, each tile is only
             * as wide as the longer of the two lines, so the name can be `Protein` in full and the
             * number can be a number. That is also why the `g` is gone rather than moved: a tile
             * headed `Protein` does not need its number to repeat what unit protein is measured in,
             * and dropping it leaves the figure a clean bold numeral, which is the thing being
             * compared across a row of cards.
             *
             * The tiles `grow` and the row wraps; they are deliberately not `flex-1`. Equal
             * thirds-of-the-row read better in English and truncated `كربوهيدرات` to `كـ…` in
             * Arabic, where the four names are two to three times longer — which would have thrown
             * away the whole point of stacking them. `grow` with the default `flex-shrink: 0` makes
             * the content width a floor rather than a target: the tiles still stretch to fill the
             * row and still come out even when they fit, and in Arabic the row breaks to a second
             * line instead of cutting a word in half.
             *
             * Energy takes the brand tint because on a nutrition-led card the calorie figure is the
             * one being scanned for; the three macros stay quiet beside it.
             *
             * The rating is not on this row. It sits on the title's baseline, where the kitchen
             * card puts one.
             */}
            {hasNutrition && figures.length > 0 ? (
                <View
                    testID={`${resolvedTestID}-nutrition`}
                    className="flex-row flex-wrap items-stretch gap-1.5"
                >
                    {figures.map((figure) => (
                        <View
                            key={figure.key}
                            testID={`${resolvedTestID}-macro-${figure.key}`}
                            className={
                                figure.key === 'energy'
                                    ? 'grow items-center rounded-md border border-transparent bg-surface-brand-subtle px-2 py-1.5'
                                    : 'grow items-center rounded-md border border-stroke-subtle bg-surface-sunken px-2 py-1.5'
                            }
                        >
                            <RNText
                                numberOfLines={1}
                                className={
                                    figure.key === 'energy'
                                        ? 'text-sm font-bold leading-tight text-content-on-brand-subtle'
                                        : 'text-sm font-bold leading-tight text-content-primary'
                                }
                            >
                                {figure.value}
                            </RNText>
                            {/*
                             * `capitalize`, not `uppercase`. `Protein` set in caps at the smallest
                             * size on the scale is wider than the tile it has to fit in; sentence
                             * case is the same word two thirds the width. The catalogue holds the
                             * names in lower case for exactly this reason — the casing is a
                             * presentation choice, and Arabic, which has no case, is untouched by
                             * it.
                             */}
                            <RNText
                                numberOfLines={1}
                                className={
                                    figure.key === 'energy'
                                        ? 'text-xs capitalize leading-tight text-content-on-brand-subtle'
                                        : 'text-xs capitalize leading-tight text-content-secondary'
                                }
                            >
                                {figure.label}
                            </RNText>
                        </View>
                    ))}
                </View>
            ) : null}

            <View className="flex-row items-center justify-between gap-3 border-t border-stroke-subtle pt-3">
                {/*
                 * Ink, not brand. The design sets the price in the text colour and reserves the
                 * accent for the control beside it — on a card carrying an Add button, two
                 * emphasised things next to each other is one too many.
                 */}
                {/*
                 * The price gives up space; the button does not. React Native Web sets
                 * `flex-shrink: 0` on every view, so with both fixed the pair overflowed the card
                 * and clipped the Add control against its edge. `shrink` on the price and
                 * `shrink-0` on the control makes the number wrap or ellipsise instead of pushing
                 * the one thing on this card you can actually press off the end of it.
                 */}
                <RNText
                    testID={`${resolvedTestID}-price`}
                    numberOfLines={1}
                    className="shrink text-xl leading-tight text-content-primary text-start"
                >
                    {formatMoney(formatter, meal.price)}
                </RNText>

                {onAdd === undefined ? null : (
                    <View className="shrink-0">
                        {/*
                         * `md`, not `sm`. The control cannot go below the 44-unit touch target, so
                         * at `sm`'s 14 units of horizontal padding "Add" came out 52 wide by 44
                         * tall — near enough square that a 12-unit radius rounded it into a pill.
                         * The design's is a rectangle, wider than it is tall. `md` widens it to
                         * about 64 without touching the height, and the same radius then reads as a
                         * corner rather than as a curve.
                         */}
                        <Button
                            testID={`${resolvedTestID}-add`}
                            size="md"
                            variant="primary"
                            label={t('marketplace:menu.add')}
                            onPress={onAdd}
                        />
                    </View>
                )}
            </View>
        </View>
    );

    return (
        <BrowseCard
            testID={resolvedTestID}
            /*
             * Fills the grid cell. `Card`'s own `self-stretch` is a *cross-axis* keyword and
             * `CardGridItem` is a column, so it was only ever stretching the card's width — the
             * height still came from the content, which is why a card with a long description stood
             * taller than its neighbour. `grow` is the main-axis half of the same idea, and
             * `flexBasis` is left at `auto` deliberately: `flex-1` would set it to zero, which
             * collapses a card whose parent has no definite height (a rail, a native ScrollView)
             * rather than sizing it to its content.
             */
            className="grow"
            {...(wholeCardIsPressable
                ? { onPress, accessibilityLabel: openLabel }
                : {
                      titleAction: {
                          onPress,
                          accessibilityLabel: openLabel,
                          testID: `${resolvedTestID}-open`,
                      },
                      /*
                       * The picture opens the meal too. With an Add button on the card the card
                       * itself can no longer be the target, and the photograph is the half of it
                       * people actually aim at — the design puts an `onClick` there for the same
                       * reason. It adds no tab stop and nothing to the accessibility tree; the
                       * title beside it is the announced link.
                       */
                      mediaAction: onPress,
                  })}
            media={
                <EntityImage
                    testID={`${resolvedTestID}-image`}
                    assetId={meal.imagePlaceholderId}
                    variant="card"
                    seed={meal.slug}
                    label={t('marketplace:menu.imageLabel', { meal: meal.name })}
                    aspect="card"
                    flush
                    /*
                     * One badge on the photograph, not two.
                     *
                     * A diet chip briefly sat in the trailing corner as well, and two dark pills on
                     * opposite corners of every picture made a grid of them look busy in exactly
                     * the way the design does not — its card carries a single tag and nothing else.
                     * The kitchen is the one that stays: on a marketplace, *who cooked it* is what
                     * a card cannot omit, and the design's storefront had one kitchen so never had
                     * to say.
                     */
                    overlayStart={<MediaChip label={meal.kitchenName} />}
                />
            }
            title={meal.name}
            /*
             * The rating on the title's baseline, where the kitchen card puts one. It was on the
             * figures line, and moving it is what made room there for carbohydrate and fat. A meal
             * nobody has rated shows nothing rather than a placeholder: on a grid, an empty slot
             * beside three rated neighbours is already the information.
             */
            {...(meal.rating === null
                ? {}
                : {
                      trailing: (
                          <Rating
                              testID={`${resolvedTestID}-rating`}
                              label={t('marketplace:menu.ratingLabel', { meal: meal.name })}
                              value={meal.rating}
                              count={meal.ratingCount}
                              size="sm"
                              compact
                          />
                      ),
                  })}
            /*
             * A minimum height rather than a fixed one. Two lines is what most descriptions run to,
             * and reserving that much stops a one-line meal sitting beside a two-line one with its
             * figures a step higher — while a product, which has no description at all, collapses
             * the row entirely rather than holding an empty gap.
             */
            {...(meal.description === ''
                ? {}
                : { meta: meal.description, metaClassName: 'min-h-[40px]' })}
            footer={footer}
            footerRule={false}
        />
    );
}
