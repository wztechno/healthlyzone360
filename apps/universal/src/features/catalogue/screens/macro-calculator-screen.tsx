import {
    Breadcrumbs,
    Button,
    Card,
    EmptyState,
    Heading,
    Inline,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTargetCalculationQuery } from '../../../data/catalogue-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import {
    CalculatorFields,
    DEFAULT_CALCULATOR_INPUTS,
    toTargetRequest,
} from '../calculator-fields.tsx';
import type { CalculatorInputs } from '../calculator-fields.tsx';
import { MacroTargetsPanel, TargetResultCard } from '../target-result.tsx';

/**
 * `/tools/macro-calculator` — the same estimate, split across the three macronutrients.
 *
 * The energy figure and the split come from one engine call, not two: a macro calculator that
 * reached a different energy figure from the calorie calculator for the same inputs would be a
 * defect a person could see, and the split is a function of the energy target anyway
 * (`MockNutritionTargetEngine`).
 *
 * The diet-preference selector is the only extra input, and it changes the *split* and never the
 * energy figure — which the hint next to it says outright, because the opposite assumption is the
 * common one.
 *
 * Grams lead, percentages follow (doc 09, CAL-09 and IMP-03; doc 17, ONB-10): a percentage cannot
 * be eaten, and the reference product's own documentation argues against percentage targets.
 */
export function MacroCalculatorScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [inputs, setInputs] = useState<CalculatorInputs>(DEFAULT_CALCULATOR_INPUTS);

    const request = useMemo(() => toTargetRequest(inputs), [inputs]);
    const calculation = useTargetCalculationQuery(request);

    return (
        <Stack space="lg" testID="macro-calculator-screen">
            <Breadcrumbs
                testID="macro-calculator-breadcrumbs"
                items={[
                    {
                        key: 'home',
                        label: t('catalogue:nav.home'),
                        onPress: () => {
                            router.push('/');
                        },
                    },
                    { key: 'tools', label: t('catalogue:nav.tools') },
                    { key: 'macro', label: t('catalogue:nav.macroCalculator') },
                ]}
            />

            <Stack space="xs">
                <Heading level={1} testID="macro-calculator-title">
                    {t('catalogue:tools.macroTitle')}
                </Heading>
                <Text tone="secondary">{t('catalogue:tools.macroSubtitle')}</Text>
            </Stack>

            <CalculatorFields
                testID="macro-calculator"
                value={inputs}
                onChange={setInputs}
                showDiet
            />

            {request === null ? (
                <EmptyState
                    testID="macro-calculator-incomplete"
                    title={t('catalogue:tools.incompleteTitle')}
                    body={t('catalogue:tools.incompleteBody')}
                />
            ) : (
                <QueryStates
                    query={calculation}
                    isEmpty={calculation.data === undefined}
                    emptyTitle={t('catalogue:tools.errorTitle')}
                    emptyBody={t('catalogue:tools.incompleteBody')}
                    skeletonCount={1}
                    testID="macro-calculator-result"
                >
                    {calculation.data === undefined ? null : (
                        <Stack space="lg">
                            <MacroTargetsPanel
                                testID="macro-calculator-macros"
                                result={calculation.data}
                            />
                            <TargetResultCard
                                testID="macro-calculator-target"
                                result={calculation.data}
                            />
                        </Stack>
                    )}
                </QueryStates>
            )}

            <MedicalDisclaimer />

            <Card testID="macro-calculator-next" padding="md" tone="sunken">
                <Stack space="sm">
                    <Text variant="label">{t('catalogue:tools.nextTitle')}</Text>
                    <Text tone="secondary">{t('catalogue:tools.nextBody')}</Text>
                    <Inline space="sm" wrap>
                        <Button
                            testID="macro-calculator-register"
                            label={t('catalogue:tools.register')}
                            onPress={() => {
                                router.push('/register');
                            }}
                        />
                        <Button
                            testID="macro-calculator-sign-in"
                            variant="secondary"
                            label={t('catalogue:tools.signIn')}
                            onPress={() => {
                                router.push('/sign-in');
                            }}
                        />
                        <Button
                            testID="macro-calculator-calorie"
                            variant="ghost"
                            label={t('catalogue:tools.otherCalculator', {
                                tool: t('catalogue:nav.calorieCalculator'),
                            })}
                            onPress={() => {
                                router.push('/tools/calorie-calculator');
                            }}
                        />
                        <Button
                            testID="macro-calculator-meals"
                            variant="ghost"
                            label={t('catalogue:tools.browseMeals')}
                            onPress={() => {
                                router.push('/meals');
                            }}
                        />
                    </Inline>
                </Stack>
            </Card>
        </Stack>
    );
}
