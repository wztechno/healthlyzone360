import type { DishOption, DishPortion } from '@healthy360/api-client/contracts';
import { Checkbox, Select, Stack } from '@healthy360/design-system';
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
                    value={value.catalogueItemVariantId ?? portions[0]?.catalogueItemVariantId ?? null}
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
                return (
                    <Select
                        key={group}
                        testID={`${testID}-group-${group}`}
                        label={arabic ? (first?.groupAr ?? group) : group}
                        size={size}
                        value={
                            inGroup.find((option) => value.optionIds.includes(option.id))?.id ??
                            NO_PREFERENCE
                        }
                        options={[
                            {
                                value: NO_PREFERENCE,
                                label: t('catalogue:dishOptions.noPreference'),
                            },
                            ...inGroup.map((option) => ({
                                value: option.id,
                                label: named(option),
                            })),
                        ]}
                        onChange={(id) => {
                            pick(group, id);
                        }}
                    />
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
