import { Icon, cx, useMotion } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Modal, Platform, Pressable, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../media/entity-image.tsx';
import { formatMoney } from '../marketplace/format.ts';
import type { BasketMeal } from './use-basket-add.tsx';

/** Who a dish that crosses the person's allergies is for — it only changes what the toast says. */
export type AllergenRecipient = 'me' | 'other';

export interface AllergenWarningDialogProps {
    readonly testID: string;
    readonly meal: BasketMeal | null;
    /** The meal's allergens the person declared. */
    readonly clashing: readonly string[];
    readonly names: (codes: readonly string[]) => string;
    readonly onClose: () => void;
    readonly onAddAnyway: (recipient: AllergenRecipient) => void;
}

/**
 * The accepted Allergen board's question, asked when Add is pressed on a dish that contains
 * something on the person's allergy list: an amber head with the warning tile nudging and
 * "Contains Milk and Eggs", the dish itself, every allergen it declares (theirs filled amber, the
 * rest plain), who it is for, then "Find another dish" or "Add anyway".
 *
 * It is a question, not a refusal: the person chose the dish, and checkout asks again by the
 * server's rule. "Someone else" is not stored anywhere — it only changes the confirmation, which
 * then says the dish is for someone else instead of warning about it.
 */
export function AllergenWarningDialog({
    testID,
    meal,
    clashing,
    names,
    onClose,
    onAddAnyway,
}: AllergenWarningDialogProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { enabled } = useMotion();
    const [recipient, setRecipient] = useState<AllergenRecipient>('me');
    const [shownFor, setShownFor] = useState<BasketMeal | null>(meal);
    const [nudge] = useState(() => new Animated.Value(0));

    // A new question starts on "Me" — reset while rendering, not in an effect.
    if (shownFor !== meal) {
        setShownFor(meal);
        setRecipient('me');
    }

    const open = meal !== null;
    useEffect(() => {
        if (!open || !enabled) return undefined;
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(nudge, {
                    toValue: 1,
                    duration: 300,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: Platform.OS !== 'web',
                }),
                Animated.timing(nudge, {
                    toValue: -1,
                    duration: 300,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: Platform.OS !== 'web',
                }),
                Animated.timing(nudge, {
                    toValue: 0,
                    duration: 300,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: Platform.OS !== 'web',
                }),
                Animated.delay(1500),
            ]),
        );
        loop.start();
        return () => {
            loop.stop();
        };
    }, [enabled, nudge, open]);

    if (meal === null) return null;

    const others = (meal.allergens ?? []).filter((code) => !clashing.includes(code));
    const title = t('commerce:myAllergens.containsTitle', { allergens: names(clashing) });
    const detail = [
        meal.price === undefined ? null : formatMoney(formatter, meal.price),
        meal.mealTypes?.[0] === undefined ? null : t(`marketplace:mealTypes.${meal.mealTypes[0]}`),
    ]
        .filter((part): part is string => part !== null)
        .join(' · ');

    return (
        <Modal transparent visible onRequestClose={onClose} animationType="fade">
            <View className="flex-1 items-center justify-center p-4">
                <Pressable
                    testID={`${testID}-scrim`}
                    accessibilityLabel={t('common:action.close')}
                    onPress={onClose}
                    className="absolute bottom-0 end-0 start-0 top-0 bg-surface-inverse/50"
                />
                <View
                    testID={testID}
                    role="dialog"
                    aria-modal
                    aria-label={title}
                    className="w-full max-w-[540px] overflow-hidden rounded-[28px] bg-surface-raised shadow-elevation-4"
                >
                    <View className="relative overflow-hidden bg-warning-subtle px-6 pb-5 pt-[22px]">
                        <View
                            aria-hidden
                            className="absolute -end-[60px] -top-[60px] h-[200px] w-[200px] rounded-full bg-warning-strong opacity-15"
                        />
                        <Animated.View
                            aria-hidden
                            className="h-14 w-14 items-center justify-center rounded-[18px] bg-warning-strong"
                            style={{
                                transform: [
                                    {
                                        rotate: nudge.interpolate({
                                            inputRange: [-1, 1],
                                            outputRange: ['-8deg', '8deg'],
                                        }),
                                    },
                                ],
                            }}
                        >
                            <Icon name="alert" size="lg" className="text-warning-on-strong" />
                        </Animated.View>
                        <RNText
                            testID={`${testID}-title`}
                            accessibilityRole="header"
                            aria-level={2}
                            className="mt-3.5 pe-10 font-display text-2xl font-bold leading-[30px] text-warning-on-subtle text-start"
                        >
                            {title}
                        </RNText>
                        <Pressable
                            testID={`${testID}-close`}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={t('common:action.close')}
                            onPress={onClose}
                            className="absolute end-3.5 top-3.5 h-10 w-10 items-center justify-center rounded-full bg-surface-raised/60 hover:bg-surface-raised"
                        >
                            <Icon name="close" size="sm" className="text-warning-on-subtle" />
                        </Pressable>
                    </View>

                    <View className="px-6 pb-6 pt-5">
                        <View className="flex-row items-center gap-3 rounded-[18px] bg-surface-base p-2.5">
                            <View className="h-[60px] w-[60px] overflow-hidden rounded-[14px]">
                                <EntityImage
                                    assetId={meal.imagePlaceholderId}
                                    photoUrl={meal.photoUrl}
                                    seed={meal.id}
                                    label={meal.name ?? ''}
                                    decorative
                                    flush
                                    className="h-full w-full"
                                />
                            </View>
                            <View className="min-w-0 flex-1">
                                {meal.name === undefined ? null : (
                                    <RNText
                                        numberOfLines={2}
                                        className="text-base font-bold text-content-primary text-start"
                                    >
                                        {meal.name}
                                    </RNText>
                                )}
                                {detail === '' ? null : (
                                    <RNText className="text-sm text-content-secondary text-start">
                                        {detail}
                                    </RNText>
                                )}
                            </View>
                        </View>

                        <Label>{t('commerce:myAllergens.containsLabel')}</Label>
                        <View testID={`${testID}-allergens`} className="flex-row flex-wrap gap-1.5">
                            {clashing.map((code) => (
                                <View
                                    key={code}
                                    className="h-8 flex-row items-center gap-1.5 rounded-full bg-warning-strong px-3"
                                >
                                    <Icon
                                        name="alert"
                                        size="sm"
                                        className="text-warning-on-strong"
                                    />
                                    <RNText className="text-sm font-bold text-warning-on-strong">
                                        {names([code])}
                                    </RNText>
                                </View>
                            ))}
                            {others.map((code) => (
                                <View
                                    key={code}
                                    className="h-8 justify-center rounded-full bg-surface-base px-3"
                                >
                                    <RNText className="text-sm font-semibold text-content-primary">
                                        {names([code])}
                                    </RNText>
                                </View>
                            ))}
                        </View>

                        <Label>{t('commerce:myAllergens.whoFor')}</Label>
                        <View
                            role="radiogroup"
                            aria-label={t('commerce:myAllergens.whoFor')}
                            className="flex-row gap-1.5 rounded-2xl bg-surface-base p-1"
                        >
                            {(['me', 'other'] as const).map((value) => {
                                const on = recipient === value;
                                return (
                                    <Pressable
                                        key={value}
                                        testID={`${testID}-for-${value}`}
                                        role="radio"
                                        accessibilityRole="radio"
                                        aria-checked={on}
                                        accessibilityState={{ checked: on }}
                                        onPress={() => {
                                            setRecipient(value);
                                        }}
                                        className={cx(
                                            'h-12 flex-1 flex-row items-center justify-center gap-2 rounded-xl transition-colors duration-200',
                                            on ? 'bg-surface-raised shadow-elevation-2' : '',
                                        )}
                                    >
                                        <Icon
                                            name={value === 'me' ? 'person' : 'users'}
                                            size="md"
                                            className={
                                                on
                                                    ? 'text-content-primary'
                                                    : 'text-content-secondary'
                                            }
                                        />
                                        <RNText
                                            className={cx(
                                                'text-sm font-bold',
                                                on
                                                    ? 'text-content-primary'
                                                    : 'text-content-secondary',
                                            )}
                                        >
                                            {value === 'me'
                                                ? t('commerce:myAllergens.forMe')
                                                : t('commerce:myAllergens.forSomeoneElse')}
                                        </RNText>
                                    </Pressable>
                                );
                            })}
                        </View>

                        <View className="mt-5 flex-row gap-2">
                            <Pressable
                                testID={`${testID}-cancel`}
                                role="button"
                                accessibilityRole="button"
                                onPress={onClose}
                                className="h-[52px] flex-1 items-center justify-center rounded-2xl border border-stroke bg-surface-raised px-3 hover:bg-surface-sunken"
                            >
                                <RNText className="text-sm font-bold text-content-primary">
                                    {t('commerce:myAllergens.findAnother')}
                                </RNText>
                            </Pressable>
                            <Pressable
                                testID={`${testID}-add`}
                                role="button"
                                accessibilityRole="button"
                                onPress={() => {
                                    onAddAnyway(recipient);
                                }}
                                className="h-[52px] flex-[1.3] flex-row items-center justify-center gap-2 rounded-2xl bg-surface-inverse px-3 hover:opacity-90"
                            >
                                <Icon name="plus" size="md" className="text-content-inverse" />
                                <RNText className="text-base font-bold text-content-inverse">
                                    {t('commerce:myAllergens.addAnyway')}
                                </RNText>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

function Label({ children }: { readonly children: string }) {
    return (
        <RNText className="mb-2 mt-4 text-xs font-bold uppercase tracking-widest text-content-secondary text-start">
            {children}
        </RNText>
    );
}
