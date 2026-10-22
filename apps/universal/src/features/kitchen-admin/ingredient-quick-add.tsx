import type {
    IngredientAdmin,
    IngredientAssistReference,
    IngredientAssistSuggestion,
} from '@healthy360/api-client/contracts';
import { Button, Callout, Icon, Inline, Stack, Text } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { toFailure } from '../../data/hooks.ts';
import {
    useCreateIngredientMutation,
    useIngredientAssist,
} from '../../data/kitchen-admin-hooks.ts';
import { queryKeys } from '../../data/query-keys.ts';
import { useRepositories } from '../../data/repository-provider.tsx';
import { displayName } from './format.ts';

type QuickAddState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'checking' | 'creating'; readonly name: string }
    | {
          readonly kind: 'matches' | 'duplicates';
          readonly name: string;
          readonly result: IngredientAssistSuggestion;
      }
    | { readonly kind: 'exists' | 'failed'; readonly name: string };

/**
 * The recipe line picker's **Add**: a typed name the library does not have becomes an ingredient
 * in the background and lands on the line, with no form and no navigation.
 *
 * The assistant runs first. An exact match is never created again — the cook is offered the
 * existing row instead — and the assistant's possible duplicates are shown before anything is
 * written. Otherwise the row is created with what the assistant could fill (Arabic, category pair,
 * a USDA pick it did not call a different food), owing its confirmed nutrition reference: the
 * server keeps the pick as a suggestion and a recipe on the row cannot publish until the cook
 * confirms it on the ingredient. With the assistant down the row goes in with its English name
 * alone and the caller is told it needs its details.
 *
 * The server refuses a name that exists with a 409, so a race between two Adds — or an assist call
 * that failed outright — still cannot make a duplicate; the caller refreshes its list instead.
 *
 * Renders the button and, below it, whatever the cook has to choose. Both are row items: the
 * caller's row wraps, so the panel's full width puts it under the picker.
 */
export function IngredientQuickAdd({
    name,
    canAdd,
    onPick,
    onCreated,
    onRefresh,
    testID,
}: {
    /** The settled, trimmed term the picker searched for. */
    readonly name: string;
    /** The search for {@link name} came back empty. */
    readonly canAdd: boolean;
    /** An existing row the cook chose instead — fetched, so the line takes its unit. */
    readonly onPick: (ingredient: IngredientAdmin) => void;
    readonly onCreated: (ingredient: IngredientAdmin, needsDetails: boolean) => void;
    /** The name turned out to exist after all: search again so it can be picked. */
    readonly onRefresh: () => void;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const repositories = useRepositories();
    const queryClient = useQueryClient();
    const assist = useIngredientAssist();
    const create = useCreateIngredientMutation();
    const [state, setState] = useState<QuickAddState>({ kind: 'idle' });

    const busy = state.kind === 'checking' || state.kind === 'creating';
    // A panel answers the name it was asked about; typing on moves past it.
    const shown = state.kind !== 'idle' && state.name === name ? state : null;

    const createFor = (typed: string, result: IngredientAssistSuggestion | null) => {
        const assisted = result !== null && !result.unavailable.includes('assistant');
        const nutrition = result?.nutrition ?? null;
        // Never a pick the assistant itself says is a different food.
        const pick =
            nutrition === null || nutrition.pick === null || nutrition.relation === 'different'
                ? undefined
                : nutrition.candidates[nutrition.pick];

        setState({ kind: 'creating', name: typed });
        create.mutate(
            {
                name: { en: typed, ar: assisted ? (result.nameAr ?? '') : '' },
                categoryCode: assisted ? (result.categoryCode ?? '') : '',
                ...(assisted && result.subcategoryCode !== null
                    ? { subcategoryCode: result.subcategoryCode }
                    : {}),
                // The new-ingredient form's default; the line takes whatever the row says.
                measurementUnit: 'g',
                nutritionPending: {
                    suggestion:
                        pick === undefined ? null : { ref: pick.ref, sourceHash: pick.source_hash },
                },
            },
            {
                onSuccess: (ingredient) => {
                    setState({ kind: 'idle' });
                    onCreated(ingredient, !assisted);
                },
                onError: (error) => {
                    if (toFailure(error)?.code === 'resource.conflict') {
                        onRefresh();
                        setState({ kind: 'exists', name: typed });
                    } else {
                        setState({ kind: 'failed', name: typed });
                    }
                },
            },
        );
    };

    const start = () => {
        const typed = name;
        setState({ kind: 'checking', name: typed });
        assist.mutate(typed, {
            onSuccess: (result) => {
                if (result.existingMatches.length > 0) {
                    setState({ kind: 'matches', name: typed, result });
                } else if (result.possibleDuplicates.length > 0) {
                    setState({ kind: 'duplicates', name: typed, result });
                } else {
                    createFor(typed, result);
                }
            },
            // No answer at all is the assistant being down; the server still refuses a duplicate.
            onError: () => {
                createFor(typed, null);
            },
        });
    };

    const use = (entry: IngredientAssistReference) => {
        setState({ kind: 'idle' });
        void queryClient
            .fetchQuery({
                queryKey: queryKeys.kitchenAdmin.ingredient(entry.id),
                queryFn: () => repositories.kitchenAdmin.getIngredient(entry.id),
            })
            .then(onPick, () => {
                setState({ kind: 'failed', name });
            });
    };

    const row = (entry: IngredientAssistReference) => (
        <Inline key={String(entry.id)} space="xs" align="center" wrap>
            <Text variant="body">{displayName(entry.name, locale).value}</Text>
            {entry.reason === null ? null : (
                <Text variant="caption" tone="secondary">
                    {entry.reason}
                </Text>
            )}
            <Button
                testID={`${testID}-use-${String(entry.id)}`}
                size="sm"
                variant="ghost"
                label={t('kitchen:recipes.quickAddUse')}
                onPress={() => {
                    use(entry);
                }}
            />
        </Inline>
    );

    const cancel = (
        <Button
            testID={`${testID}-cancel`}
            size="sm"
            variant="ghost"
            label={t('kitchen:recipes.quickAddCancel')}
            onPress={() => {
                setState({ kind: 'idle' });
            }}
        />
    );

    return (
        <>
            {canAdd || busy ? (
                <View>
                    <Button
                        testID={testID}
                        size="sm"
                        variant="secondary"
                        label={t('kitchen:recipes.quickAdd')}
                        hint={t('kitchen:recipes.quickAddHint', { name })}
                        iconStart={<Icon name="plus" size="sm" />}
                        loading={busy}
                        disabled={busy || name === ''}
                        onPress={start}
                    />
                </View>
            ) : null}

            {shown?.kind === 'matches' ? (
                <View className="w-full">
                    <Callout
                        testID={`${testID}-existing`}
                        tone="warning"
                        role="alert"
                        title={t('kitchen:recipes.quickAddExistingTitle', { name: shown.name })}
                        actions={cancel}
                    >
                        <Stack space="xs">{shown.result.existingMatches.map(row)}</Stack>
                    </Callout>
                </View>
            ) : null}

            {shown?.kind === 'duplicates' ? (
                <View className="w-full">
                    <Callout
                        testID={`${testID}-duplicates`}
                        tone="info"
                        icon="sparkle"
                        role="status"
                        title={t('kitchen:recipes.quickAddDuplicatesTitle', { name: shown.name })}
                        actions={
                            <Inline space="xs">
                                <Button
                                    testID={`${testID}-anyway`}
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:recipes.quickAddAnyway')}
                                    onPress={() => {
                                        createFor(shown.name, shown.result);
                                    }}
                                />
                                {cancel}
                            </Inline>
                        }
                    >
                        <Stack space="xs">{shown.result.possibleDuplicates.map(row)}</Stack>
                    </Callout>
                </View>
            ) : null}

            {shown?.kind === 'exists' || shown?.kind === 'failed' ? (
                <View className="w-full">
                    <Text
                        testID={`${testID}-${shown.kind}`}
                        variant="caption"
                        tone={shown.kind === 'failed' ? 'danger' : 'secondary'}
                    >
                        {t(
                            shown.kind === 'failed'
                                ? 'kitchen:recipes.quickAddFailed'
                                : 'kitchen:recipes.quickAddExists',
                            { name: shown.name },
                        )}
                    </Text>
                </View>
            ) : null}
        </>
    );
}
