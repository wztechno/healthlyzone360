import type { DishOption, DishPortion } from '@healthy360/api-client/contracts';
import { Dialog, Text, TextInputField } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useDishChoicesQuery } from '../../../data/order-desk-hooks.ts';
import { choiceLabel } from '../../../ui/dish-choices.tsx';
import type { DishChoiceValue } from '../../../ui/dish-choices.tsx';
import { ChoiceRow, DeskButton } from '../desk-kit/index.ts';
import { displayName } from '../format.ts';
import type { BasketLine } from './basket.ts';

/**
 * One ticket row's portion, free options and note, in the desk's card dialog — the look of Record a
 * payment, so every pop-up the desk opens reads alike.
 *
 * ```
 *  Options and note                              ✕
 *  Chicken Burger Patty
 *
 *  PORTION
 *  (•) B2C pack                         $10.00     <- rows, the chosen one soft green
 *  ( ) Family pack                      $24.00
 *  SAUCE
 *  (•) No preference
 *  ( ) Garlic · Contains milk
 *  LEAVE OUT
 *  [✓] No onions
 *  Note for the kitchen  [                    ]
 *
 *                                 ( Back ) (( Apply ))
 * ```
 *
 * Every choice is a whole row rather than a select, so what is on offer is read at a glance and
 * picked in one press. Portions are packs, so the row's quote prices the choice; nothing here works
 * out a price.
 */

export interface DishChoicesChange {
    readonly catalogueItemVariantId: string | null;
    readonly variantLabel: string | null;
    readonly options: readonly DishOption[];
    readonly note: string;
}

const NO_PREFERENCE = '';

export function DishChoicesDialog({
    line,
    money,
    onClose,
    onSave,
}: {
    readonly line: BasketLine;
    readonly money: (portion: DishPortion) => string;
    readonly onClose: () => void;
    readonly onSave: (change: DishChoicesChange) => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const arabic = locale.startsWith('ar');
    const read = useDishChoicesQuery(line.catalogueItemId);
    const [value, setValue] = useState<DishChoiceValue>({
        catalogueItemVariantId: line.catalogueItemVariantId,
        optionIds: line.options?.map((option) => option.id) ?? [],
    });
    const [note, setNote] = useState(line.note ?? '');

    const options = read.data?.options ?? [];
    const portions = read.data?.portions ?? [];
    const chosenPortion = value.catalogueItemVariantId ?? portions[0]?.catalogueItemVariantId ?? null;
    const portion = portions.find(
        (candidate) => candidate.catalogueItemVariantId === chosenPortion,
    );
    const groups = [
        ...new Set(options.flatMap((option) => (option.groupEn === null ? [] : [option.groupEn]))),
    ];
    const removals = options.filter((option) => option.kind === 'remove');
    const named = (option: DishOption) => (arabic ? option.nameAr : option.nameEn);

    const pick = (group: string, id: string) => {
        const others = options
            .filter((option) => option.groupEn === group)
            .map((option) => option.id);
        setValue({
            ...value,
            optionIds: [
                ...value.optionIds.filter((chosen) => !others.includes(chosen)),
                ...(id === NO_PREFERENCE ? [] : [id]),
            ],
        });
    };

    const title = displayName(line.name, locale).value;

    return (
        <Dialog
            testID="kitchen-order-desk-sale-choices"
            look="card"
            open
            onClose={onClose}
            title={t('kitchen:dishOptions.drawerTitle')}
            description={title}
            actions={
                <>
                    <DeskButton
                        testID="kitchen-order-desk-sale-choices-back"
                        variant="secondary"
                        label={t('kitchen:common.back')}
                        onPress={onClose}
                    />
                    <DeskButton
                        testID="kitchen-order-desk-sale-choices-save"
                        label={t('kitchen:dishOptions.apply')}
                        onPress={() => {
                            onSave({
                                catalogueItemVariantId: value.catalogueItemVariantId,
                                variantLabel:
                                    portion === undefined
                                        ? line.variantLabel
                                        : displayName(
                                              { en: portion.nameEn, ar: portion.nameAr },
                                              locale,
                                          ).value,
                                options: options.filter((option) =>
                                    value.optionIds.includes(option.id),
                                ),
                                note: note.trim(),
                            });
                        }}
                    />
                </>
            }
        >
            <View testID="kitchen-order-desk-sale-choices-fields" className="flex-col gap-4">
                {portions.length === 0 ? null : (
                    <ChoiceGroup label={t('catalogue:dishOptions.portion')}>
                        {portions.map((candidate) => (
                            <ChoiceRow
                                key={candidate.catalogueItemVariantId}
                                testID={`kitchen-order-desk-sale-choices-portion-${candidate.catalogueItemVariantId}`}
                                label={arabic ? candidate.nameAr : candidate.nameEn}
                                meta={money(candidate)}
                                selected={candidate.catalogueItemVariantId === chosenPortion}
                                onPress={() => {
                                    setValue({
                                        ...value,
                                        catalogueItemVariantId: candidate.catalogueItemVariantId,
                                    });
                                }}
                            />
                        ))}
                    </ChoiceGroup>
                )}

                {groups.map((group) => {
                    const inGroup = options.filter((option) => option.groupEn === group);
                    const first = inGroup[0];
                    const chosen = inGroup.find((option) => value.optionIds.includes(option.id));
                    return (
                        <ChoiceGroup key={group} label={arabic ? (first?.groupAr ?? group) : group}>
                            <ChoiceRow
                                testID={`kitchen-order-desk-sale-choices-group-${group}-none`}
                                label={t('catalogue:dishOptions.noPreference')}
                                selected={chosen === undefined}
                                onPress={() => {
                                    pick(group, NO_PREFERENCE);
                                }}
                            />
                            {inGroup.map((option) => (
                                <ChoiceRow
                                    key={option.id}
                                    testID={`kitchen-order-desk-sale-choices-option-${option.id}`}
                                    label={choiceLabel(option, named(option), t)}
                                    selected={chosen?.id === option.id}
                                    onPress={() => {
                                        pick(group, option.id);
                                    }}
                                />
                            ))}
                        </ChoiceGroup>
                    );
                })}

                {removals.length === 0 ? null : (
                    <ChoiceGroup label={t('kitchen:dishOptions.kindRemove')}>
                        {removals.map((option) => {
                            const on = value.optionIds.includes(option.id);
                            return (
                                <ChoiceRow
                                    key={option.id}
                                    testID={`kitchen-order-desk-sale-choices-remove-${option.id}`}
                                    mark="check"
                                    label={t('catalogue:dishOptions.leaveOut', {
                                        name: named(option),
                                    })}
                                    selected={on}
                                    onPress={() => {
                                        setValue({
                                            ...value,
                                            optionIds: on
                                                ? value.optionIds.filter((id) => id !== option.id)
                                                : [...value.optionIds, option.id],
                                        });
                                    }}
                                />
                            );
                        })}
                    </ChoiceGroup>
                )}

                <TextInputField
                    testID="kitchen-order-desk-sale-choices-note"
                    id="kitchen-order-desk-sale-choices-note"
                    label={t('kitchen:dishOptions.noteLabel')}
                    size="sm"
                    multiline
                    numberOfLines={2}
                    maxLength={300}
                    value={note}
                    onChangeText={setNote}
                />
            </View>
        </Dialog>
    );
}

/** A heading in the dialog's label style over its rows. */
function ChoiceGroup({ label, children }: { readonly label: string; readonly children: ReactNode }) {
    return (
        <View role="group" aria-label={label} className="flex-col gap-1">
            <Text variant="label" tone="secondary" className="!font-semibold">
                {label}
            </Text>
            <View className="flex-col gap-0.5">{children}</View>
        </View>
    );
}
