import { Icon, cx } from '@healthy360/design-system';
import type { CartItem } from '@healthy360/api-client/contracts';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { useMealQuery } from '../../data/catalogue-hooks.ts';
import { EntityImage } from '../../media/entity-image.tsx';
import { dishOptionsLine } from '../../ui/dish-choices.tsx';
import { TINT_FILL, TINT_INK, shelfTint } from '../catalogue/shelf-tints.ts';
import { formatMoney } from '../marketplace/format.ts';
import { YourAllergens } from './my-allergens.tsx';

/**
 * One basket line, as the accepted Basket board draws it: the 104px photograph, the name with its
 * shelf chip and its price each, Remove under them, the stepper — whose minus becomes a bin at one —
 * and the line total, with "2 × $9.00" under it when there is more than one.
 *
 * ## The second line
 *
 * The design's grey line lists a line's options and its note, and says "No changes" when there are
 * none.
 *
 * ## "View meal", not "Edit options"
 *
 * A line's options are part of what it is: changing them is another line. So the link opens the
 * dish, and says so.
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
    /** The first line of the card draws no rule above it. */
    readonly first?: boolean | undefined;
}

export function CartLine({
    item,
    priceText,
    busy,
    onQuantity,
    onRemove,
    onOpen,
    first = false,
}: CartLineProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const meal = useMealQuery(item.mealId);
    const testID = `cart-line-${item.id}`;
    const category = meal.data?.publishedCategory ?? null;
    const tint = shelfTint(category?.code);
    const unit = formatMoney(formatter, item.unitPrice);
    const mods = [dishOptionsLine(item.options, locale, t), item.note]
        .filter((part) => part != null && part !== '')
        .join(t('catalogue:dishOptions.separator'));

    return (
        <View
            testID={testID}
            className={cx(
                'flex-row flex-wrap items-center gap-x-[18px] gap-y-3 px-5 py-4',
                first ? '' : 'border-t border-stroke-subtle',
            )}
        >
            <Pressable
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                onPress={onOpen}
                className="h-[84px] w-[104px] overflow-hidden rounded-[18px]"
            >
                <EntityImage
                    testID={`${testID}-image`}
                    assetId={meal.data?.imagePlaceholderId}
                    photoUrl={meal.data?.photoUrl}
                    variant="card"
                    seed={meal.data?.slug ?? String(item.mealId)}
                    label={t('marketplace:menu.imageLabel', { meal: item.name })}
                    decorative
                    flush
                    className="h-full w-full"
                />
            </Pressable>

            <View className="min-w-[160px] flex-1 flex-col items-start">
                <Pressable
                    testID={`${testID}-open`}
                    role="link"
                    accessibilityRole="link"
                    accessibilityHint={t('commerce:cart.viewMeal')}
                    onPress={onOpen}
                >
                    <RNText
                        testID={`${testID}-name`}
                        className="font-display text-lg font-bold text-content-primary text-start hover:text-content-on-brand-subtle"
                    >
                        {item.name}
                    </RNText>
                </Pressable>
                <View className="mt-1.5 flex-row flex-wrap items-center gap-2">
                    {category === null ? null : (
                        <View
                            className={cx(
                                'h-[22px] justify-center rounded-full px-2',
                                TINT_FILL[tint],
                            )}
                        >
                            <RNText className={cx('text-xs font-bold', TINT_INK[tint])}>
                                {category.name}
                            </RNText>
                        </View>
                    )}
                    <RNText className="text-sm tabular-nums text-content-secondary">
                        {t('commerce:cart.each', { price: unit })}
                    </RNText>
                </View>
                <RNText
                    testID={`${testID}-mods`}
                    numberOfLines={2}
                    className="mt-1 text-xs text-content-secondary text-start"
                >
                    {mods === '' ? t('commerce:cart.noChanges') : mods}
                </RNText>
                <YourAllergens
                    allergens={item.allergens}
                    testID={`${testID}-your-allergens`}
                    className="mt-1"
                />
                <Pressable
                    testID={`${testID}-remove`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityHint={t('commerce:cart.removeHint', { meal: item.name })}
                    accessibilityState={{ disabled: busy }}
                    disabled={busy}
                    onPress={onRemove}
                    className="group mt-2 h-8 flex-row items-center gap-1 rounded-[10px] pe-2.5 ps-1.5 hover:bg-danger-subtle"
                >
                    <Icon
                        name="close"
                        size="sm"
                        className="text-content-secondary group-hover:text-danger-on-subtle"
                    />
                    <RNText className="text-sm font-semibold text-content-secondary group-hover:text-danger-on-subtle">
                        {t('commerce:cart.remove')}
                    </RNText>
                </Pressable>
            </View>

            <LineQuantity
                testID={`${testID}-quantity`}
                meal={item.name}
                value={item.quantity}
                disabled={busy}
                onChange={onQuantity}
                onRemove={onRemove}
            />

            <View className="w-24 items-end">
                <RNText
                    testID={`${testID}-total`}
                    className="font-display text-lg font-bold tabular-nums text-content-primary text-end"
                >
                    {priceText}
                </RNText>
                {item.quantity > 1 ? (
                    <RNText className="text-xs font-medium tabular-nums text-content-secondary text-end">
                        {t('commerce:cart.timesUnit', {
                            count: formatter.formatNumber(item.quantity),
                            price: unit,
                        })}
                    </RNText>
                ) : null}
            </View>
        </View>
    );
}

interface LineQuantityProps {
    readonly meal: string;
    readonly value: number;
    readonly disabled: boolean;
    readonly onChange: (next: number) => void;
    /** At one, the minus is a bin: one fewer is none. */
    readonly onRemove: () => void;
    readonly testID: string;
}

/** The board's stepper: a sunken track, a white minus (a bin at one), the count, a brand plus. */
function LineQuantity({ meal, value, disabled, onChange, onRemove, testID }: LineQuantityProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const atOne = value <= MIN_LINE_QUANTITY;
    const atMost = value >= MAX_LINE_QUANTITY;

    return (
        <View
            testID={testID}
            role="group"
            aria-label={t('commerce:cart.quantityValue', {
                meal,
                quantity: formatter.formatNumber(value),
            })}
            className="h-12 flex-row items-center rounded-2xl border border-stroke-subtle bg-surface-base p-1"
        >
            <Pressable
                testID={`${testID}-decrement`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={
                    atOne
                        ? t('commerce:cart.removeHint', { meal })
                        : t('commerce:cart.decrease', { meal })
                }
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => {
                    if (atOne) {
                        onRemove();
                        return;
                    }
                    onChange(Math.max(MIN_LINE_QUANTITY, value - 1));
                }}
                className="h-10 w-10 items-center justify-center rounded-xl bg-surface-raised shadow-elevation-1 active:scale-90"
            >
                <Icon name={atOne ? 'close' : 'minus'} size="sm" className="text-content-primary" />
            </Pressable>
            <RNText
                testID={`${testID}-value`}
                aria-live="polite"
                accessibilityLiveRegion="polite"
                accessibilityLabel={t('commerce:cart.quantityValue', {
                    meal,
                    quantity: formatter.formatNumber(value),
                })}
                className="w-10 text-center font-display text-lg font-bold tabular-nums text-content-primary"
            >
                {formatter.formatNumber(value)}
            </RNText>
            <Pressable
                testID={`${testID}-increment`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('commerce:cart.increase', { meal })}
                accessibilityState={{ disabled: disabled || atMost }}
                disabled={disabled || atMost}
                onPress={() => {
                    onChange(Math.min(MAX_LINE_QUANTITY, value + 1));
                }}
                className={cx(
                    'h-10 w-10 items-center justify-center rounded-xl bg-surface-brand shadow-elevation-1 active:scale-90',
                    atMost ? 'opacity-40' : '',
                )}
            >
                <Icon name="plus" size="sm" className="text-content-on-brand" />
            </Pressable>
        </View>
    );
}
