import { Accordion, Card, Inline, Stack, Text } from '@healthy360/design-system';
import type { AccordionItem } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { NutritionTargetExplanation } from '@healthy360/nutrition';
import { useTranslation } from 'react-i18next';

/**
 * "Why this target?" — the engine's own working, shown rather than summarised.
 *
 * Doc 17, NUT-03 asks for an interaction attached to the value that discloses the inputs used and
 * the assumptions made, and marks it **NEW**: neither reference product offers one. What makes this
 * more than a marketing panel is that nothing in it is written by hand. Every step, every formula,
 * every input value and every citation comes from `NutritionTargetResult.explanation`, which the
 * engine produced while it was calculating. A person can therefore check the arithmetic instead of
 * trusting it, and a screen cannot drift from the engine, because there is nothing here to drift.
 *
 * Collapsed by default, and that is a considered choice rather than a space saving: somebody who
 * wants their number should get their number, and somebody who wants the derivation should not have
 * to hunt for it. The trigger is a full-width control with a visible label, not an icon.
 */

export interface TargetExplanationProps {
    readonly explanation: NutritionTargetExplanation;
    readonly testID?: string | undefined;
}

export function TargetExplanation({
    explanation,
    testID = 'nutrition-explanation',
}: TargetExplanationProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const items: readonly AccordionItem[] = [
        {
            key: 'why',
            title: t('nutrition:explanation.whyThisTarget'),
            testID: `${testID}-why`,
            children: (
                <Stack space="md">
                    <Text testID={`${testID}-summary`}>{explanation.summary}</Text>

                    <Stack space="sm" testID={`${testID}-steps`}>
                        {explanation.steps.map((step) => (
                            <Card
                                key={step.id}
                                padding="md"
                                tone="sunken"
                                testID={`${testID}-step-${step.id}`}
                            >
                                <Stack space="xs">
                                    <Text variant="bodyStrong">{step.title}</Text>
                                    <Text tone="secondary" variant="caption">
                                        {step.detail}
                                    </Text>

                                    {step.formula === null ? null : (
                                        <Text
                                            variant="mono"
                                            testID={`${testID}-formula-${step.id}`}
                                        >
                                            {step.formula}
                                        </Text>
                                    )}

                                    <Inline space="xs" wrap>
                                        {Object.entries(step.inputs).map(([name, value]) => (
                                            <Text key={name} variant="caption" tone="secondary">
                                                {t('nutrition:explanation.input', {
                                                    name: t(`nutrition:inputs.${name}`, {
                                                        defaultValue: name,
                                                    }),
                                                    value:
                                                        typeof value === 'number'
                                                            ? formatter.formatNumber(value)
                                                            : String(value),
                                                })}
                                            </Text>
                                        ))}
                                    </Inline>

                                    {step.output === null ? null : (
                                        <Text
                                            variant="bodyStrong"
                                            testID={`${testID}-output-${step.id}`}
                                        >
                                            {t('nutrition:explanation.output', {
                                                value: formatter.formatNumber(step.output),
                                                unit: step.unit ?? '',
                                            })}
                                        </Text>
                                    )}

                                    {step.citation === null ? null : (
                                        <Text
                                            variant="caption"
                                            tone="secondary"
                                            testID={`${testID}-citation-${step.id}`}
                                        >
                                            {step.citation}
                                        </Text>
                                    )}
                                </Stack>
                            </Card>
                        ))}
                    </Stack>
                </Stack>
            ),
        },
        {
            key: 'assumptions',
            title: t('nutrition:explanation.assumptions'),
            testID: `${testID}-assumptions`,
            children: (
                <Stack space="xs">
                    {explanation.assumptions.map((assumption, index) => (
                        <Text key={index} tone="secondary">
                            {assumption}
                        </Text>
                    ))}
                </Stack>
            ),
        },
        {
            key: 'citations',
            title: t('nutrition:explanation.citations'),
            testID: `${testID}-citations`,
            children: (
                <Stack space="xs">
                    {explanation.citations.length === 0 ? (
                        <Text tone="secondary">{t('nutrition:explanation.noCitations')}</Text>
                    ) : (
                        explanation.citations.map((citation, index) => (
                            <Text key={index} variant="caption" tone="secondary">
                                {citation}
                            </Text>
                        ))
                    )}
                </Stack>
            ),
        },
    ];

    return <Accordion testID={testID} items={items} multiple />;
}
