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
import { TargetResultCard } from '../target-result.tsx';

/**
 * `/tools/calorie-calculator` — an energy estimate, with no account and nothing stored.
 *
 * ## Why there is no submit button
 *
 * The calculation is arithmetic over values the browser already holds
 * (`NutritionTargetEngine.calculate` is synchronous by design), so the result follows the inputs
 * the way a spreadsheet cell follows its formula. A "calculate" button would add a state in which
 * the form and the answer disagree, and the only thing it would buy is a moment where the person
 * cannot see what they have changed. The result appears as soon as the three measurements exist,
 * and the "still missing" state says which ones do not.
 *
 * ## What is given away before anything is asked for
 *
 * Everything. No account, no email, no stored profile — doc 17, MKT-10 and MKT-01: the acquisition
 * surface gives a real answer first. The account call to action sits *after* the result and says
 * what an account adds, rather than gating the number behind one.
 */
export function CalorieCalculatorScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [inputs, setInputs] = useState<CalculatorInputs>(DEFAULT_CALCULATOR_INPUTS);

    const request = useMemo(() => toTargetRequest(inputs), [inputs]);
    const calculation = useTargetCalculationQuery(request);

    return (
        <Stack space="lg" testID="calorie-calculator-screen">
            <Breadcrumbs
                testID="calorie-calculator-breadcrumbs"
                items={[
                    {
                        key: 'home',
                        label: t('catalogue:nav.home'),
                        onPress: () => {
                            router.push('/');
                        },
                    },
                    { key: 'tools', label: t('catalogue:nav.tools') },
                    { key: 'calorie', label: t('catalogue:nav.calorieCalculator') },
                ]}
            />

            <Stack space="xs">
                <Heading level={1} testID="calorie-calculator-title">
                    {t('catalogue:tools.calorieTitle')}
                </Heading>
                <Text tone="secondary">{t('catalogue:tools.calorieSubtitle')}</Text>
            </Stack>

            <CalculatorFields testID="calorie-calculator" value={inputs} onChange={setInputs} />

            {request === null ? (
                <EmptyState
                    testID="calorie-calculator-incomplete"
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
                    testID="calorie-calculator-result"
                >
                    {calculation.data === undefined ? null : (
                        <TargetResultCard
                            testID="calorie-calculator-target"
                            result={calculation.data}
                        />
                    )}
                </QueryStates>
            )}

            <MedicalDisclaimer />

            <Card testID="calorie-calculator-next" padding="md" tone="sunken">
                <Stack space="sm">
                    <Text variant="label">{t('catalogue:tools.nextTitle')}</Text>
                    <Text tone="secondary">{t('catalogue:tools.nextBody')}</Text>
                    <Inline space="sm" wrap>
                        <Button
                            testID="calorie-calculator-register"
                            label={t('catalogue:tools.register')}
                            onPress={() => {
                                router.push('/register');
                            }}
                        />
                        <Button
                            testID="calorie-calculator-sign-in"
                            variant="secondary"
                            label={t('catalogue:tools.signIn')}
                            onPress={() => {
                                router.push('/sign-in');
                            }}
                        />
                        <Button
                            testID="calorie-calculator-macro"
                            variant="ghost"
                            label={t('catalogue:tools.otherCalculator', {
                                tool: t('catalogue:nav.macroCalculator'),
                            })}
                            onPress={() => {
                                router.push('/tools/macro-calculator');
                            }}
                        />
                        <Button
                            testID="calorie-calculator-meals"
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
