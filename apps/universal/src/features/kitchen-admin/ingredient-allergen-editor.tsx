import type {
    AllergenClass,
    AllergenContainment,
    IngredientAdmin,
    IngredientAllergenMapping,
} from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    FormGrid,
    Inline,
    Select,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toFailure } from '../../data/hooks.ts';
import { useSetIngredientAllergensMutation } from '../../data/kitchen-admin-hooks.ts';
import { displayName } from './format.ts';

type Choice = AllergenContainment | 'none';

export interface IngredientAllergenEditorProps {
    readonly ingredient: IngredientAdmin;
    readonly classes: readonly AllergenClass[];
}

/**
 * The ingredient's allergen determination, editable: one choice per active class, saved as the
 * whole set (`PUT …/allergens` is wholesale).
 *
 * An empty set is a claim — "assessed, carries nothing" — so its button says so rather than
 * "save", and the server records it on the ingredient for the publish gate. A mapping the server
 * already holds keeps its verification and evidence; only the containment is chosen here. The
 * upgrade-only refusal on a platform baseline comes back as an error and is shown as one.
 *
 * Mount it keyed by the stored set so a successful save re-reads the server's answer.
 */
export function IngredientAllergenEditor({ ingredient, classes }: IngredientAllergenEditorProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const toast = useToast();
    const save = useSetIngredientAllergensMutation();

    const stored = new Map(ingredient.allergens.map((m) => [String(m.allergenCode), m]));
    const [draft, setDraft] = useState<ReadonlyMap<string, Choice>>(
        () => new Map(ingredient.allergens.map((m) => [String(m.allergenCode), m.containment])),
    );

    const active = classes.filter((entry) => entry.isActive || draft.has(String(entry.code)));
    const chosen = [...draft].filter(([, choice]) => choice !== 'none');
    const dirty =
        chosen.length !== ingredient.allergens.length ||
        chosen.some(([code, choice]) => stored.get(code)?.containment !== choice);
    const assessed = ingredient.allergens.length > 0 || ingredient.allergensAssessedClear === true;

    const options = [
        { value: 'none' as const, label: t('kitchen:allergens.none') },
        { value: 'may_contain' as const, label: t('kitchen:containment.mayContain') },
        { value: 'contains' as const, label: t('kitchen:containment.contains') },
    ];

    const onSave = () => {
        const mappings: IngredientAllergenMapping[] = [];
        for (const entry of active) {
            const code = String(entry.code);
            const choice = draft.get(code) ?? 'none';
            if (choice === 'none') continue;
            const previous = stored.get(code);
            mappings.push({
                allergenCode: entry.code,
                containment: choice,
                marketScope: previous?.marketScope ?? [],
                verification: previous?.verification ?? 'operator_confirmed',
                sourceNote: previous?.sourceNote ?? null,
            });
        }
        save.mutate(
            {
                ingredientId: ingredient.id,
                request: { lockVersion: ingredient.meta.lockVersion, mappings },
            },
            {
                onSuccess: () => {
                    toast.show({
                        testID: 'kitchen-ingredient-mapping-saved-toast',
                        tone: 'success',
                        message: t('kitchen:allergens.savedToast'),
                    });
                },
            },
        );
    };

    const failure = toFailure(save.error);

    return (
        <Stack space="sm" testID="kitchen-ingredient-mapping">
            {assessed ? null : (
                <Callout
                    testID="kitchen-ingredient-mapping-unassessed"
                    tone="warning"
                    title={t('kitchen:allergens.notAssessed')}
                />
            )}
            {ingredient.allergens.length === 0 && ingredient.allergensAssessedClear === true ? (
                <Text testID="kitchen-ingredient-mapping-clear" tone="secondary" variant="caption">
                    {t('kitchen:allergens.assessedClear')}
                </Text>
            ) : null}

            <FormGrid testID="kitchen-ingredient-mapping-grid">
                {active.map((entry) => {
                    const code = String(entry.code);
                    return (
                        <Select
                            key={code}
                            testID={`kitchen-ingredient-mapping-${code}`}
                            size="sm"
                            label={displayName(entry.name, locale).value}
                            options={options}
                            value={draft.get(code) ?? 'none'}
                            onChange={(next) => {
                                setDraft((current) => new Map(current).set(code, next));
                            }}
                        />
                    );
                })}
            </FormGrid>

            {failure === null ? null : (
                <Callout
                    testID="kitchen-ingredient-mapping-error"
                    tone="danger"
                    title={t('kitchen:allergens.saveError')}
                    body={failure.message}
                />
            )}

            <Inline justify="end">
                <Button
                    testID="kitchen-ingredient-mapping-save"
                    variant="primary"
                    size="sm"
                    loading={save.isPending}
                    disabled={save.isPending || (!dirty && assessed)}
                    label={
                        chosen.length === 0
                            ? t('kitchen:allergens.confirmNone')
                            : t('kitchen:allergens.save')
                    }
                    onPress={onSave}
                />
            </Inline>
        </Stack>
    );
}
