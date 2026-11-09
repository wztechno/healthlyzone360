import type { DishOptionDraft, KitchenDishOption } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    DataList,
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
import type { DataListColumn, SelectOption } from '@healthy360/design-system';
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
/** A row with its place in the list, which every edit addresses. */
interface IndexedOption {
    readonly row: DishOptionDraft;
    readonly index: number;
}

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

    const dash = (
        <Text tone="secondary" aria-hidden>
            {t('kitchen:list.noValue')}
        </Text>
    );
    const columns: readonly DataListColumn<IndexedOption>[] = [
        {
            key: 'kind',
            label: t('kitchen:dishOptions.kind'),
            width: 150,
            priority: 100,
            grow: false,
            render: ({ row, index }) => (
                <View
                    testID={`kitchen-dish-option-${String(index)}`}
                    className="z-auto w-full py-tight"
                >
                    <Select
                        testID={`kitchen-dish-option-${String(index)}-kind`}
                        label={t('kitchen:dishOptions.kind')}
                        labelHidden
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
            ),
        },
        ...(
            [
                ['nameEn', 'kitchen:dishOptions.nameEn', 'name-en', false],
                ['nameAr', 'kitchen:dishOptions.nameAr', 'name-ar', false],
                ['groupEn', 'kitchen:dishOptions.groupEn', 'group-en', true],
                ['groupAr', 'kitchen:dishOptions.groupAr', 'group-ar', true],
            ] as const
        ).map(([field, labelKey, suffix, choiceOnly]): DataListColumn<IndexedOption> => ({
            key: field,
            label: t(labelKey),
            width: 140,
            priority: choiceOnly ? 80 : 95,
            render: ({ row, index }) =>
                choiceOnly && row.kind === 'remove' ? (
                    dash
                ) : (
                    <View className="z-auto w-full py-tight">
                        <TextInputField
                            testID={`kitchen-dish-option-${String(index)}-${suffix}`}
                            id={`kitchen-dish-option-${String(index)}-${suffix}`}
                            label={t(labelKey)}
                            labelHidden
                            size="sm"
                            disabled={!canManage}
                            value={row[field] ?? ''}
                            onChangeText={(next) => {
                                edit(index, { [field]: next });
                            }}
                        />
                    </View>
                ),
        })),
        {
            key: 'recipe',
            label: t('kitchen:dishOptions.recipe'),
            width: 220,
            priority: 90,
            fill: true,
            render: ({ row, index }) =>
                row.kind === 'remove' ? (
                    dash
                ) : (
                    <View className="z-auto w-full gap-hair py-tight">
                        <Select
                            testID={`kitchen-dish-option-${String(index)}-recipe`}
                            id={`kitchen-dish-option-${String(index)}-recipe`}
                            label={t('kitchen:dishOptions.recipe')}
                            labelHidden
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
                        <ChoiceAllergens
                            testID={`kitchen-dish-option-${String(index)}-allergens`}
                            row={row}
                            saved={read.data?.find((option) => option.id === row.id)}
                            t={t}
                        />
                    </View>
                ),
        },
        ...(canManage
            ? [
                  {
                      key: 'remove',
                      label: '',
                      width: 48,
                      priority: 99,
                      grow: false,
                      align: 'end' as const,
                      render: ({ index }: IndexedOption) => (
                          <IconButton
                              testID={`kitchen-dish-option-${String(index)}-remove`}
                              icon={<Icon name="close" size="sm" />}
                              variant="ghost"
                              size="sm"
                              label={t('kitchen:dishOptions.removeRow')}
                              onPress={() => {
                                  setRows(rows.filter((_, at) => at !== index));
                              }}
                          />
                      ),
                  },
              ]
            : []),
    ];

    return (
        <FormSection
            variant="panel"
            testID="kitchen-dish-options"
            title={t('kitchen:dishOptions.title')}
            description={t('kitchen:dishOptions.aside')}
        >
            <Stack space="sm">
                {/*
                 * The board's table: one line per change, headed Kind, Name, Name in Arabic, Group,
                 * Group in Arabic, Recipe. A removal has no group or recipe, so those cells are a
                 * quiet dash; a choice's allergens sit under its recipe.
                 */}
                {rows.length === 0 ? null : (
                    <DataList<IndexedOption>
                        testID="kitchen-dish-options-table"
                        label={t('kitchen:dishOptions.title')}
                        columns={columns}
                        rows={rows.map((row, index) => ({ row, index }))}
                        rowKey={({ row, index }) => row.id ?? `new-${String(index)}`}
                        density="sm"
                    />
                )}

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
