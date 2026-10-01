import { Icon, IconButton } from '@healthy360/design-system';
import type { CartItem } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useMealQuery } from '../../data/catalogue-hooks.ts';
import { EntityImage } from '../../media/entity-image.tsx';
import { TextLink } from './checkout-frame.tsx';

/**
 * One basket line, as HealthZone's `cart` draws it: the 88px photograph, the name with its line
 * total level beside it, the modifiers line, then the quantity stepper and the line's two text
 * actions in one row.
 *
 * ## The second line reads "No changes"
 *
 * The design's grey line lists a line's modifiers, and says "No changes" when there are none. A
 * `CartItem` has no modifiers — the contract carries a meal, a quantity and two prices — so every
 * line is honestly the design's own no-modifier case.
 *
 * ## "View meal", not "Edit options"
 *
 * The design's underlined link opens the meal to change its options. There are no options to
 * change, so the same link, in the same place, says what it does: it opens the dish.
 *
 * ## The photograph is the meal's, fetched by id
 *
 * `CartItem` names the meal but carries no image, so the line reads the meal itself. While that is
 * loading, or if it fails, `EntityImage` draws its seeded pattern — the line never waits on its
 * picture, and the name beside it is what a screen reader hears (the image is decorative).
 */

/** Bounds for one line. Above ten, a household is ordering for an event and should talk to us. */
export const MIN_LINE_QUANTITY = 1;
export const MAX_LINE_QUANTITY = 10;

export interface CartLineProps {
    readonly item: CartItem;
    readonly priceText: string;
    readonly busy: boolean;
    readonly onQuantity: (quantity: number) => void;
    readonly onRemove: () => void;
    readonly onOpen: () => void;
}

export function CartLine({ item, priceText, busy, onQuantity, onRemove, onOpen }: CartLineProps) {
    const { t } = useTranslation();
    const meal = useMealQuery(item.mealId);
    const testID = `cart-line-${item.id}`;

    return (
        <View
            testID={testID}
            className="flex-row items-start gap-4 border-b border-stroke-subtle p-4 sm:p-5"
        >
            <View className="h-16 w-16 shrink-0 overflow-hidden rounded-lg sm:h-[88px] sm:w-[88px]">
                <EntityImage
                    testID={`${testID}-image`}
                    assetId={meal.data?.imagePlaceholderId}
                    variant="card"
                    seed={meal.data?.slug ?? String(item.mealId)}
                    label={t('marketplace:menu.imageLabel', { meal: item.name })}
                    aspect="square"
                    decorative
                    flush
                />
            </View>

            <View className="min-w-0 flex-1 flex-col">
                <View className="flex-row items-baseline justify-between gap-3">
                    <RNText
                        testID={`${testID}-name`}
                        className="min-w-0 shrink font-display text-lg font-bold tracking-display text-content-primary text-start"
                    >
                        {item.name}
                    </RNText>
                    <RNText
                        testID={`${testID}-total`}
                        className="font-display text-lg font-bold tabular-nums text-content-primary text-end"
                    >
                        {priceText}
                    </RNText>
                </View>

                <RNText
                    testID={`${testID}-mods`}
                    className="mt-1 text-sm text-content-secondary text-start"
                >
                    {t('commerce:cart.noChanges')}
                </RNText>

                <View className="mt-3 flex-row flex-wrap items-center gap-x-4 gap-y-2">
                    <LineQuantity
                        testID={`${testID}-quantity`}
                        meal={item.name}
                        value={item.quantity}
                        disabled={busy}
                        onChange={onQuantity}
                    />
                    <TextLink
                        testID={`${testID}-open`}
                        label={t('commerce:cart.viewMeal')}
                        onPress={onOpen}
                    />
                    <TextLink
                        testID={`${testID}-remove`}
                        tone="muted"
                        label={t('commerce:cart.remove')}
                        accessibilityHint={t('commerce:cart.removeHint', { meal: item.name })}
                        disabled={busy}
                        onPress={onRemove}
                    />
                </View>
            </View>
        </View>
    );
}

interface LineQuantityProps {
    readonly meal: string;
    readonly value: number;
    readonly disabled: boolean;
    readonly onChange: (next: number) => void;
    readonly testID: string;
}

/**
 * The design's compact stepper: one outlined pill holding minus, the count and plus.
 *
 * Not `NumberStepper`. That control is a labelled form field around a text input, which is right
 * where somebody types a number and wrong on a basket line — a visible "How many portions of…"
 * label over every line, and a keystroke-per-request input on something that sends a mutation per
 * change. A line moves one portion at a time; the buttons say which meal they change, and the
 * count announces itself when it moves. The buttons keep the 44px floor.
 */
function LineQuantity({ meal, value, disabled, onChange, testID }: LineQuantityProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View
            testID={testID}
            className="flex-row items-center rounded-lg border border-stroke-strong bg-surface-raised"
        >
            <IconButton
                testID={`${testID}-decrement`}
                variant="ghost"
                size="sm"
                label={t('commerce:cart.decrease', { meal })}
                icon={<Icon name="minus" size="sm" />}
                disabled={disabled || value <= MIN_LINE_QUANTITY}
                onPress={() => {
                    onChange(Math.max(MIN_LINE_QUANTITY, value - 1));
                }}
            />
            <RNText
                testID={`${testID}-value`}
                aria-live="polite"
                accessibilityLiveRegion="polite"
                accessibilityLabel={t('commerce:cart.quantityValue', {
                    meal,
                    quantity: formatter.formatNumber(value),
                })}
                className="min-w-6 text-center text-sm font-semibold tabular-nums text-content-primary"
            >
                {formatter.formatNumber(value)}
            </RNText>
            <IconButton
                testID={`${testID}-increment`}
                variant="ghost"
                size="sm"
                label={t('commerce:cart.increase', { meal })}
                icon={<Icon name="plus" size="sm" />}
                disabled={disabled || value >= MAX_LINE_QUANTITY}
                onPress={() => {
                    onChange(Math.min(MAX_LINE_QUANTITY, value + 1));
                }}
            />
        </View>
    );
}
