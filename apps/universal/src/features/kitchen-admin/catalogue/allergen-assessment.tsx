import type { MealId, ProductId } from '@healthy360/domain-types';
import { Badge, Button, Callout, useToast } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useAllergenClassesQuery,
    useMarkAllergensAssessedMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { displayName } from '../format.ts';
import { CATALOGUE_MANAGE_PERMISSION } from '../entity-registry.ts';

interface AssessmentBadgesProps {
    /** `false` is off sale. `undefined` is a payload that does not say, so nothing is drawn. */
    readonly allergensAssessed: boolean | undefined;
    readonly onSaleWithoutRecipe: boolean | undefined;
    readonly testID: string;
}

/** What staff must not miss about an item's food-safety basis, beside its name or status. */
export function AssessmentBadges({
    allergensAssessed,
    onSaleWithoutRecipe,
    testID,
}: AssessmentBadgesProps) {
    const { t } = useTranslation();

    return (
        <>
            {allergensAssessed === false ? (
                <Badge
                    testID={`${testID}-not-assessed`}
                    tone="danger"
                    icon={null}
                    label={t('kitchen:allergenAssessment.notAssessed')}
                />
            ) : null}
            {onSaleWithoutRecipe === true ? (
                <Badge
                    testID={`${testID}-no-recipe`}
                    tone="warning"
                    icon={null}
                    label={t('kitchen:allergenAssessment.noRecipe')}
                />
            ) : null}
        </>
    );
}

interface AllergenAssessmentCalloutProps {
    readonly itemId: ProductId | MealId;
    readonly testID: string;
}

/**
 * Why an item is off sale, and "Assessed: contains none of these". The caller draws it only when
 * the item is unassessed, so nobody can state absence over a recipe that says otherwise.
 *
 * The classes are named on the page because that is what the person is confirming, so the button
 * waits for them.
 */
export function AllergenAssessmentCallout({ itemId, testID }: AllergenAssessmentCalloutProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);
    const classes = useAllergenClassesQuery();
    const mark = useMarkAllergensAssessedMutation();

    const named = (classes.data ?? []).map((entry) => displayName(entry.name, locale).value);

    return (
        <Callout
            testID={testID}
            tone="warning"
            title={t('kitchen:allergenAssessment.calloutTitle')}
            body={t('kitchen:allergenAssessment.calloutBody', { allergens: named.join(', ') })}
            actions={
                canManage ? (
                    <Button
                        testID={`${testID}-confirm`}
                        variant="secondary"
                        size="sm"
                        label={t('kitchen:allergenAssessment.confirm')}
                        disabled={named.length === 0}
                        loading={mark.isPending}
                        onPress={() => {
                            mark.mutate(itemId, {
                                onError: (error) => {
                                    toast.show({
                                        testID: `${testID}-failed`,
                                        tone: 'danger',
                                        message:
                                            toFailure(error)?.message ??
                                            t('kitchen:editor.saveError'),
                                    });
                                },
                            });
                        }}
                    />
                ) : undefined
            }
        />
    );
}
