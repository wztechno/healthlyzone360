import type { DishOption, DishOptionAllergen, DishPortion } from '@healthy360/api-client/contracts';
import { Badge, Checkbox, Inline, Select, Stack, Text } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

/**
 * What can be changed about a dish, for the meal page and the desk alike: a portion, one answer per
 * sauce or side group, and things to leave out. Everything but the portion is free. `options` on a
 * line is what is sent; what it costs is the server's to say.
 */

export interface DishChoiceValue {
    readonly catalogueItemVariantId: string | null;
    readonly optionIds: readonly string[];
}

export const NO_DISH_CHOICES: DishChoiceValue = { catalogueItemVariantId: null, optionIds: [] };

/** What a chosen option looks like on a ticket: "No onions", "Sauce: Garlic". */
export function dishOptionText(option: DishOption, locale: string, t: TFunction): string {
    const arabic = locale.startsWith('ar');
    const name = arabic ? option.nameAr : option.nameEn;
    if (option.kind === 'remove') return t('catalogue:dishOptions.leaveOut', { name });
    return t('catalogue:dishOptions.chosen', {
        group: arabic ? (option.groupAr ?? option.groupEn) : option.groupEn,
        name,
    });
}

/** A line's options as one sentence, or `null` for a plain line. */
export function dishOptionsLine(
    options: readonly DishOption[] | undefined,
    locale: string,
    t: TFunction,
): string | null {
    if (options === undefined || options.length === 0) return null;
    return options
        .map((option) => dishOptionText(option, locale, t))
        .join(t('catalogue:dishOptions.separator'));
}

export interface DishChoiceFieldsProps {
    readonly testID: string;
    readonly options: readonly DishOption[];
    readonly portions: readonly DishPortion[];
    readonly value: DishChoiceValue;
    readonly onChange: (next: DishChoiceValue) => void;
    readonly formatPrice: (portion: DishPortion) => string;
    readonly size?: 'sm' | undefined;
}

const NO_PREFERENCE = '';

export function DishChoiceFields({
    testID,
    options,
    portions,
    value,
    onChange,
    formatPrice,
    size,
}: DishChoiceFieldsProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const arabic = locale.startsWith('ar');

    const groups = [
        ...new Set(options.flatMap((option) => (option.groupEn === null ? [] : [option.groupEn]))),
    ];
    const removals = options.filter((option) => option.kind === 'remove');
    const named = (option: DishOption) => (arabic ? option.nameAr : option.nameEn);

    const pick = (group: string, id: string) => {
        const others = options
            .filter((option) => option.groupEn === group)
            .map((option) => option.id);
        onChange({
            ...value,
            optionIds: [
                ...value.optionIds.filter((chosen) => !others.includes(chosen)),
                ...(id === NO_PREFERENCE ? [] : [id]),
            ],
        });
    };

    return (
        <Stack space="sm" testID={testID}>
            {portions.length === 0 ? null : (
                <Select
                    testID={`${testID}-portion`}
                    label={t('catalogue:dishOptions.portion')}
                    size={size}
                    value={
                        value.catalogueItemVariantId ?? portions[0]?.catalogueItemVariantId ?? null
                    }
                    options={portions.map((portion) => ({
                        value: portion.catalogueItemVariantId,
                        label: t('catalogue:dishOptions.portionPrice', {
                            name: arabic ? portion.nameAr : portion.nameEn,
                            price: formatPrice(portion),
                        }),
                    }))}
                    onChange={(catalogueItemVariantId) => {
                        onChange({ ...value, catalogueItemVariantId });
                    }}
                />
            )}

            {groups.map((group) => {
                const inGroup = options.filter((option) => option.groupEn === group);
                const first = inGroup[0];
                const chosen = inGroup.find((option) => value.optionIds.includes(option.id));
                return (
                    <Stack key={group} space="xs">
                        <Select
                            testID={`${testID}-group-${group}`}
                            label={arabic ? (first?.groupAr ?? group) : group}
                            size={size}
                            value={chosen?.id ?? NO_PREFERENCE}
                            options={[
                                {
                                    value: NO_PREFERENCE,
                                    label: t('catalogue:dishOptions.noPreference'),
                                },
                                ...inGroup.map((option) => ({
                                    value: option.id,
                                    label: choiceLabel(option, named(option), t),
                                })),
                            ]}
                            onChange={(id) => {
                                pick(group, id);
                            }}
                        />
                        {chosen === undefined ? null : (
                            <ChoiceAllergens
                                testID={`${testID}-group-${group}-allergens`}
                                option={chosen}
                                t={t}
                            />
                        )}
                    </Stack>
                );
            })}

            {removals.map((option) => (
                <Checkbox
                    key={option.id}
                    testID={`${testID}-remove-${option.id}`}
                    label={t('catalogue:dishOptions.leaveOut', { name: named(option) })}
                    checked={value.optionIds.includes(option.id)}
                    onChange={(checked) => {
                        onChange({
                            ...value,
                            optionIds: checked
                                ? [...value.optionIds, option.id]
                                : value.optionIds.filter((chosen) => chosen !== option.id),
                        });
                    }}
                />
            ))}
        </Stack>
    );
}

/**
 * A sauce or side as the picker lists it, so its allergens are read before it is picked: the name,
 * then what it contains and, worded apart, what it may contain, or that nobody has assessed it. A
 * choice that declares nothing is just its name; the badges below say so once it is chosen.
 */
function choiceLabel(option: DishOption, name: string, t: TFunction): string {
    const separator = t('catalogue:dishOptions.separator');
    const allergens = option.allergens;
    if (allergens === null || allergens === undefined) {
        return [name, t('catalogue:dishOptions.allergensUnassessed')].join(separator);
    }
    const names = (containment: DishOptionAllergen['containment']) =>
        allergens
            .filter((allergen) => allergen.containment === containment)
            .map((allergen) => t(`marketplace:allergens.${allergen.code}`))
            .join(t('marketplace:common.listSeparator'));
    const contains = names('contains');
    const mayContain = names('may_contain');
    return [
        name,
        ...(contains === ''
            ? []
            : [t('marketplace:menu.containsAllergens', { allergens: contains })]),
        ...(mayContain === ''
            ? []
            : [t('catalogue:dishOptions.mayContain', { allergens: mayContain })]),
    ].join(separator);
}

/**
 * What the chosen sauce or side adds to the plate, before it is bought: its recipe's allergens as the
 * danger badges the kitchen's editor draws, a "may contain" one worded and toned apart, or a warning
 * when nobody has assessed it. Missing allergens read as unassessed, never as "none".
 */
function ChoiceAllergens({
    testID,
    option,
    t,
}: {
    readonly testID: string;
    readonly option: DishOption;
    readonly t: TFunction;
}) {
    const allergens = option.allergens;

    if (allergens === null || allergens === undefined) {
        return (
            <Text variant="caption" tone="warning" testID={`${testID}-unassessed`}>
                {t('catalogue:dishOptions.allergensUnassessed')}
            </Text>
        );
    }

    if (allergens.length === 0) {
        return (
            <Text variant="caption" tone="secondary" testID={`${testID}-none`}>
                {t('catalogue:dishOptions.allergensNone')}
            </Text>
        );
    }

    return (
        <Inline space="xs" wrap testID={testID}>
            {allergens.map(({ code, containment }) => (
                <Badge
                    key={code}
                    testID={`${testID}-${code}`}
                    tone={containment === 'may_contain' ? 'warning' : 'danger'}
                    label={
                        containment === 'may_contain'
                            ? t('catalogue:dishOptions.mayContain', {
                                  allergens: t(`marketplace:allergens.${code}`),
                              })
                            : t(`marketplace:allergens.${code}`)
                    }
                />
            ))}
        </Inline>
    );
}
