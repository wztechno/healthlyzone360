import type { DishOptionDraft, KitchenDishOption } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    FormSection,
    Icon,
    IconButton,
    Inline,
    Select,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { recipesFromPages, useAllRecipesQuery } from '../../data/kitchen-admin-hooks.ts';
import { useDishOptionsQuery, useReplaceDishOptionsMutation } from '../../data/order-desk-hooks.ts';
import { toFailure } from '../../data/hooks.ts';
import { displayName } from './format.ts';
import { allergenLabel } from './ops-format.ts';

/**
 * The free changes a dish offers: something left out, or a sauce or side from a group. Saved on its
 * own, as the whole list, because it is not part of the listing's draft and a rename must not wait
 * for a publish. The priced choice, the portion, is the dish's packs, set under Selling.
 *
 * A choice links the sauce or side recipe it is (owner, 3 Nov 2026) and takes its allergens from that
 * recipe's published version, which the row shows beside it. The picker is the recipe `Select` the
 * product editor uses. A choice saved before the link existed stays unlinked, and unoffered, until
 * somebody picks its recipe here; Save waits for every choice to have one.
 */
export function DishOptionsSection({
    itemId,
    canManage,
}: {
    readonly itemId: string;
    readonly canManage: boolean;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const toast = useToast();
    const read = useDishOptionsQuery(itemId);
    const recipes = useAllRecipesQuery();
    const recipeRows = recipesFromPages(recipes.data?.pages);
    const recipeOptions: readonly SelectOption[] = useMemo(
        () =>
            recipeRows.map((row) => ({
                value: String(row.id),
                label: displayName(row.name, locale).value,
                // Searched, not shown — see `SelectOption.keywords`.
                keywords: row.slug,
            })),
        [recipeRows, locale],
    );
    const replace = useReplaceDishOptionsMutation(itemId);
    // What is on screen: the saved list until somebody edits it.
    const [edited, setRows] = useState<readonly DishOptionDraft[] | null>(null);
    const rows = edited ?? read.data ?? [];

    const edit = (index: number, change: Partial<DishOptionDraft>) => {
        setRows(rows.map((row, at) => (at === index ? { ...row, ...change } : row)));
    };
    const complete = rows.every(
        (row) =>
            row.nameEn.trim() !== '' &&
            row.nameAr.trim() !== '' &&
            (row.kind === 'remove' || ((row.groupEn ?? '').trim() !== '' && row.recipeId !== null)),
    );
    const failure = toFailure(replace.error);

    return (
        <FormSection
            variant="panel"
            testID="kitchen-dish-options"
            title={t('kitchen:dishOptions.title')}
            description={t('kitchen:dishOptions.aside')}
        >
            <Stack space="sm">
                {rows.map((row, index) => (
                    <View
                        key={row.id ?? `new-${String(index)}`}
                        testID={`kitchen-dish-option-${String(index)}`}
                        className="flex-row flex-wrap items-end gap-tight border-b border-stroke-subtle pb-tight"
                    >
                        <View className="w-40">
                            <Select
                                testID={`kitchen-dish-option-${String(index)}-kind`}
                                label={t('kitchen:dishOptions.kind')}
                                size="sm"
                                disabled={!canManage}
                                value={row.kind}
                                options={[
                                    { value: 'remove', label: t('kitchen:dishOptions.kindRemove') },
                                    { value: 'choice', label: t('kitchen:dishOptions.kindChoice') },
                                ]}
                                onChange={(kind) => {
                                    edit(index, { kind });
                                }}
                            />
                        </View>
                        {row.kind === 'remove' ? null : (
                            <>
                                <View className="w-32">
                                    <TextInputField
                                        testID={`kitchen-dish-option-${String(index)}-group-en`}
                                        id={`kitchen-dish-option-${String(index)}-group-en`}
                                        label={t('kitchen:dishOptions.groupEn')}
                                        size="sm"
                                        disabled={!canManage}
                                        value={row.groupEn ?? ''}
                                        onChangeText={(groupEn) => {
                                            edit(index, { groupEn });
                                        }}
                                    />
                                </View>
                                <View className="w-32">
                                    <TextInputField
                                        testID={`kitchen-dish-option-${String(index)}-group-ar`}
                                        id={`kitchen-dish-option-${String(index)}-group-ar`}
                                        label={t('kitchen:dishOptions.groupAr')}
                                        size="sm"
                                        disabled={!canManage}
                                        value={row.groupAr ?? ''}
                                        onChangeText={(groupAr) => {
                                            edit(index, { groupAr });
                                        }}
                                    />
                                </View>
                            </>
                        )}
                        <View className="w-40">
                            <TextInputField
                                testID={`kitchen-dish-option-${String(index)}-name-en`}
                                id={`kitchen-dish-option-${String(index)}-name-en`}
                                label={t('kitchen:dishOptions.nameEn')}
                                size="sm"
                                disabled={!canManage}
                                value={row.nameEn}
                                onChangeText={(nameEn) => {
                                    edit(index, { nameEn });
                                }}
                            />
                        </View>
                        <View className="w-40">
                            <TextInputField
                                testID={`kitchen-dish-option-${String(index)}-name-ar`}
                                id={`kitchen-dish-option-${String(index)}-name-ar`}
                                label={t('kitchen:dishOptions.nameAr')}
                                size="sm"
                                disabled={!canManage}
                                value={row.nameAr}
                                onChangeText={(nameAr) => {
                                    edit(index, { nameAr });
                                }}
                            />
                        </View>
                        {row.kind === 'remove' ? null : (
                            <View className="w-56">
                                <Select
                                    testID={`kitchen-dish-option-${String(index)}-recipe`}
                                    id={`kitchen-dish-option-${String(index)}-recipe`}
                                    label={t('kitchen:dishOptions.recipe')}
                                    placeholder={t('kitchen:dishOptions.recipePlaceholder')}
                                    size="sm"
                                    searchable
                                    loading={recipes.isPending}
                                    disabled={!canManage}
                                    options={recipeOptions}
                                    value={row.recipeId}
                                    onChange={(recipeId) => {
                                        // The label is the saved recipe's until this saves.
                                        edit(index, { recipeId, allergens: null });
                                    }}
                                />
                            </View>
                        )}
                        {canManage ? (
                            <IconButton
                                testID={`kitchen-dish-option-${String(index)}-remove`}
                                icon={<Icon name="close" size="sm" />}
                                variant="secondary"
                                size="sm"
                                label={t('kitchen:dishOptions.removeRow')}
                                onPress={() => {
                                    setRows(rows.filter((_, at) => at !== index));
                                }}
                            />
                        ) : null}
                        {row.kind === 'remove' ? null : (
                            <View className="w-full">
                                <ChoiceAllergens
                                    testID={`kitchen-dish-option-${String(index)}-allergens`}
                                    row={row}
                                    saved={read.data?.find((option) => option.id === row.id)}
                                    t={t}
                                />
                            </View>
                        )}
                    </View>
                ))}

                {failure === null ? null : (
                    <Text variant="caption" tone="danger" testID="kitchen-dish-options-error">
                        {failure.message}
                    </Text>
                )}

                {canManage ? (
                    <View className="flex-row gap-tight">
                        <Button
                            testID="kitchen-dish-options-add"
                            variant="secondary"
                            size="sm"
                            label={t('kitchen:dishOptions.add')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={() => {
                                setRows([
                                    ...rows,
                                    {
                                        id: null,
                                        kind: 'remove',
                                        groupEn: null,
                                        groupAr: null,
                                        nameEn: '',
                                        nameAr: '',
                                        recipeId: null,
                                        allergens: null,
                                    },
                                ]);
                            }}
                        />
                        <Button
                            testID="kitchen-dish-options-save"
                            size="sm"
                            label={t('kitchen:dishOptions.save')}
                            disabled={!complete || replace.isPending}
                            loading={replace.isPending}
                            onPress={() => {
                                replace.mutate(rows, {
                                    onSuccess: () => {
                                        setRows(null);
                                        toast.show({
                                            testID: 'kitchen-dish-options-saved',
                                            tone: 'success',
                                            message: t('kitchen:dishOptions.saved'),
                                        });
                                    },
                                });
                            }}
                        />
                    </View>
                ) : null}
            </Stack>
        </FormSection>
    );
}

/**
 * What a choice brings to the plate: its linked recipe's published allergens, as the danger badges the
 * meal listing draws, or why there are none to show.
 */
function ChoiceAllergens({
    testID,
    row,
    saved,
    t,
}: {
    readonly testID: string;
    readonly row: DishOptionDraft;
    readonly saved: KitchenDishOption | undefined;
    readonly t: TFunction;
}) {
    if (row.recipeId === null) {
        return (
            <Text variant="caption" tone="warning" testID={`${testID}-unlinked`}>
                {t('kitchen:dishOptions.recipeMissing')}
            </Text>
        );
    }

    if (saved?.recipeId !== row.recipeId) {
        return (
            <Text variant="caption" tone="secondary" testID={`${testID}-unsaved`}>
                {t('kitchen:dishOptions.allergensAfterSave')}
            </Text>
        );
    }

    if (row.allergens === null) {
        return (
            <Text variant="caption" tone="warning" testID={`${testID}-unpublished`}>
                {t('kitchen:dishOptions.recipeUnpublished')}
            </Text>
        );
    }

    if (row.allergens.length === 0) {
        return (
            <Text variant="caption" tone="secondary" testID={`${testID}-none`}>
                {t('kitchen:dishOptions.noAllergens')}
            </Text>
        );
    }

    return (
        <Inline space="xs" wrap testID={testID}>
            {row.allergens.map(({ code }) => (
                <Badge
                    icon={null}
                    key={code}
                    testID={`${testID}-${code}`}
                    tone="danger"
                    label={allergenLabel(code, t)}
                />
            ))}
        </Inline>
    );
}
