import type {
    IngredientAssistReference,
    IngredientAssistSuggestion,
} from '@healthy360/api-client/contracts';
import { Button, Callout, Inline, Stack, Text } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { displayName } from './format.ts';

/**
 * What the ingredient assistant found for the typed name, under the identity fields.
 *
 * Machine origin is said in words on every part ("AI assistant", "filled by AI"), not carried by
 * colour: the design's violet is a hero band with one call to action, and this is a desk panel
 * with several. Exact matches lead because they are certain and need no AI; possible duplicates
 * follow with the model's reason. Neither blocks Save — a kitchen may want two rows on purpose.
 */
export function IngredientAssistPanel({
    result,
    pending,
    arabicFromAi,
    categorySuggestion,
    onOpen,
    onRerun,
}: {
    readonly result: IngredientAssistSuggestion | undefined;
    readonly pending: boolean;
    /** The Arabic field still holds exactly what the assistant wrote into it. */
    readonly arabicFromAi: boolean;
    /** A category pair the form could not apply because the cook had already chosen one. */
    readonly categorySuggestion: { readonly label: string; readonly onApply: () => void } | null;
    readonly onOpen: (id: IngredientAssistReference['id']) => void;
    readonly onRerun: () => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();

    if (result === undefined && !pending) return null;

    const row = (entry: IngredientAssistReference, kind: 'existing' | 'possible') => (
        <Inline key={entry.id} space="xs" align="center" wrap>
            <Text variant="body">
                {kind === 'existing'
                    ? t('kitchen:assist.existingMatch', {
                          name: displayName(entry.name, locale).value,
                      })
                    : t('kitchen:assist.possibleDuplicate', {
                          name: displayName(entry.name, locale).value,
                      })}
            </Text>
            {entry.reason === null ? null : (
                <Text variant="caption" tone="secondary">
                    {entry.reason}
                </Text>
            )}
            <Button
                testID={`kitchen-ingredient-assist-open-${entry.id}`}
                size="sm"
                variant="ghost"
                label={t('kitchen:assist.open')}
                onPress={() => onOpen(entry.id)}
            />
        </Inline>
    );

    return (
        <Stack space="sm" testID="kitchen-ingredient-assist">
            {result === undefined || result.existingMatches.length === 0 ? null : (
                <Callout
                    testID="kitchen-ingredient-assist-existing"
                    tone="warning"
                    title={t('kitchen:assist.existingTitle')}
                >
                    <Stack space="xs">
                        {result.existingMatches.map((entry) => row(entry, 'existing'))}
                    </Stack>
                </Callout>
            )}

            <Callout
                testID="kitchen-ingredient-assist-ai"
                tone="info"
                icon="sparkle"
                role="status"
                title={t('kitchen:assist.title')}
                actions={
                    <Button
                        testID="kitchen-ingredient-assist-rerun"
                        size="sm"
                        variant="ghost"
                        label={t('kitchen:assist.rerun')}
                        loading={pending}
                        disabled={pending}
                        onPress={onRerun}
                    />
                }
            >
                <Stack space="xs">
                    {pending ? (
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:assist.checking')}
                        </Text>
                    ) : null}
                    {result?.unavailable.includes('assistant') ? (
                        <Text testID="kitchen-ingredient-assist-unavailable" variant="caption">
                            {t('kitchen:assist.assistantUnavailable')}
                        </Text>
                    ) : null}
                    {result?.unavailable.includes('nutrition') ? (
                        <Text
                            testID="kitchen-ingredient-assist-nutrition-unavailable"
                            variant="caption"
                        >
                            {t('kitchen:assist.nutritionUnavailable')}
                        </Text>
                    ) : null}
                    {arabicFromAi ? (
                        <Text testID="kitchen-ingredient-assist-arabic" variant="caption">
                            {t('kitchen:assist.arabicFilled')}
                        </Text>
                    ) : null}
                    {categorySuggestion === null ? null : (
                        <Inline space="xs" align="center" wrap>
                            <Text variant="caption">
                                {t('kitchen:assist.categorySuggested', {
                                    category: categorySuggestion.label,
                                })}
                            </Text>
                            <Button
                                testID="kitchen-ingredient-assist-apply-category"
                                size="sm"
                                variant="ghost"
                                label={t('kitchen:assist.apply')}
                                onPress={categorySuggestion.onApply}
                            />
                        </Inline>
                    )}
                    {result?.possibleDuplicates.map((entry) => row(entry, 'possible'))}
                </Stack>
            </Callout>
        </Stack>
    );
}
