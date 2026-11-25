import { Button, Stack, Text } from '@healthy360/design-system';
import { useState } from 'react';
import { View } from 'react-native';

import { DeskChip } from '../features/kitchen-admin/desk-kit/desk-chip.tsx';
import { CountPill, ReviewBox, StepCard } from '../features/kitchen-admin/process-parts.tsx';
import { ProcessSteps } from '../features/kitchen-admin/process-steps.tsx';

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
                <ProcessSteps<Step>
                    testID="showcase-steps"
                    label="Steps"
                    value={step}
                    onChange={setStep}
                    steps={[
                        { key: 'order', label: 'Order', caption: 'PO-2611-0035', done: true },
                        {
                            key: 'delivery',
                            label: 'Delivery',
                            caption: 'Paperwork and charges',
                            done: true,
                        },
                        {
                            key: 'lines',
                            label: 'What arrived',
                            caption: '4 to post, 1 left out',
                            issues: 2,
                            issuesLabel: '2 to fix',
                        },
                        {
                            key: 'check',
                            label: 'Check and post',
                            caption: 'Over-receipt',
                            captionTone: 'warning',
                        },
                    ]}
                />

                <Text variant="title">Step card</Text>
                <StepCard
                    testID="showcase-step-card"
                    title="What arrived"
                    count="4 to post, 1 left out"
                    actions={
                        <Button size="sm" variant="secondary" label="Add invoice charges" />
                    }
                >
                    <Text tone="secondary">The step's fields sit here.</Text>
                </StepCard>

                <Text variant="title">Review boxes</Text>
                <View className="flex-row flex-wrap gap-3">
                    <View className="min-w-[320px] flex-1">
                        <ReviewBox
                            testID="showcase-review"
                            title="This delivery"
                            trailing={<DeskChip tone="warning" label="Over-receipt" />}
                        >
                            <Text tone="secondary">Stock rises immediately for 4 lines.</Text>
                        </ReviewBox>
                    </View>
                    <View className="min-w-[260px] flex-1">
                        <ReviewBox testID="showcase-fixes" title="To fix">
                            <CountPill label="2" />
                        </ReviewBox>
                    </View>
                </View>
            </Stack>
        </View>
    );
}
