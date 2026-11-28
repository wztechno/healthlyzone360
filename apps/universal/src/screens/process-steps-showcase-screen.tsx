import { Badge, Button, Stack, Tabs, Text } from '@healthy360/design-system';
import { useState } from 'react';
import { View } from 'react-native';

import { ReviewBox, StepCard } from '../features/kitchen-admin/process-parts.tsx';

type Step = 'order' | 'delivery' | 'lines' | 'check';

/**
 * `/showcase-process-steps` — the parts the stepped posting forms are drawn from: the step track in
 * each of its states, a step card, and the review boxes. The foot bar docks to the shell's edge, so
 * it is seen on the forms themselves.
 */
export function ProcessStepsShowcaseScreen() {
    const [step, setStep] = useState<Step>('lines');

    return (
        <View className="mx-auto w-full max-w-5xl p-6">
            <Stack space="lg">
                <Text variant="title">Step track — walked, open, with problems</Text>
                <Tabs<Step>
                    variant="pills"
                    testID="showcase-steps"
                    label="Steps"
                    value={step}
                    onChange={setStep}
                    items={[
                        { value: 'order', label: 'Order', detail: 'PO-2611-0035', done: true },
                        {
                            value: 'delivery',
                            label: 'Delivery',
                            detail: 'Paperwork and charges',
                            done: true,
                        },
                        {
                            value: 'lines',
                            label: 'What arrived',
                            detail: '4 to post, 1 left out',
                            issues: { count: 2, tone: 'warning', label: '2 to fix' },
                        },
                        {
                            value: 'check',
                            label: 'Check and post',
                            detail: 'Over-receipt',
                            detailTone: 'warning',
                        },
                    ]}
                />

                <Text variant="title">Step card</Text>
                <StepCard
                    testID="showcase-step-card"
                    title="What arrived"
                    count="4 to post, 1 left out"
                    actions={<Button size="sm" variant="secondary" label="Add invoice charges" />}
                >
                    <Text tone="secondary">The step's fields sit here.</Text>
                </StepCard>

                <Text variant="title">Review boxes</Text>
                <View className="flex-row flex-wrap gap-3">
                    <View className="min-w-[320px] flex-1">
                        <ReviewBox
                            testID="showcase-review"
                            title="This delivery"
                            trailing={<Badge tone="warning" label="Over-receipt" />}
                        >
                            <Text tone="secondary">Stock rises immediately for 4 lines.</Text>
                        </ReviewBox>
                    </View>
                    <View className="min-w-[260px] flex-1">
                        <ReviewBox testID="showcase-fixes" title="To fix">
                            <Badge tone="brand" label="2" />
                        </ReviewBox>
                    </View>
                </View>
            </Stack>
        </View>
    );
}
