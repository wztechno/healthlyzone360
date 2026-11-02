import type { DishOptionDraft } from '@healthy360/api-client/contracts';
import {
    Button,
    FormSection,
    Icon,
    IconButton,
    Select,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
    useDishOptionsQuery,
    useReplaceDishOptionsMutation,
} from '../../data/order-desk-hooks.ts';
import { toFailure } from '../../data/hooks.ts';

/**
 * The free changes a dish offers: something left out, or a sauce or side from a group. Saved on its
 * own, as the whole list, because it is not part of the listing's draft and a rename must not wait
 * for a publish. The priced choice, the portion, is the dish's packs, set under Selling.
 */
export function DishOptionsSection({
    itemId,
    canManage,
}: {
    readonly itemId: string;
    readonly canManage: boolean;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const read = useDishOptionsQuery(itemId);
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
            (row.kind === 'remove' || (row.groupEn ?? '').trim() !== ''),
    );
    const failure = toFailure(replace.error);

    return (
        <FormSection
            variant="card"
            testID="kitchen-dish-options"
            title={t('kitchen:dishOptions.title')}
            aside={
                <Text variant="caption" tone="secondary">
                    {t('kitchen:dishOptions.aside')}
                </Text>
            }
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
