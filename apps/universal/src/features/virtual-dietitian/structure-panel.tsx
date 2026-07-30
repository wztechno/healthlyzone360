import type {
    PreparationMode,
    SendVdMessageRequest,
    VdProposal,
    VdSafetyNotice,
} from '@healthy360/api-client/contracts';
import {
    Button,
    Card,
    FilterChip,
    Heading,
    Inline,
    SegmentedControl,
    Skeleton,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { KitchenId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useKitchensQuery } from '../../data/marketplace-hooks.ts';
import { OriginBadge } from './origin-badge.tsx';
import { AllergenReminder, SafetyNotices } from './safety-notices.tsx';

/**
 * The proposed shape of the day, and the four constraints the planner needs before it can build a
 * week: preparation mode, preferred kitchens, weekly budget and delivery area.
 *
 * ## Why the preferences are sent as a message
 *
 * `CreateVdSessionRequest` carries all four, but the session already exists by the time a person is
 * looking at a meal structure, and `GenerateVdDraftRequest` carries only the preparation mode. The
 * remaining three are therefore recorded the way every other answer in this journey is recorded — as
 * a message with structured `answers`, which the store persists on the message and the collected
 * panel reads back. That is a real write against a real contract field, not a local variable
 * pretending to be one; the alternative was a form whose Save button did nothing observable.
 *
 * ## The kitchen list is the marketplace's, filtered to what a household can actually buy
 *
 * `listKitchens({ channels: ['marketplace'] })` — the same call the public directory makes — so a
 * wholesale-only kitchen never appears as something to prefer. Loading and empty are both rendered;
 * an empty kitchen list is a real answer in a delivery area nobody serves.
 */
export interface StructurePanelProps {
    readonly proposal: VdProposal;
    readonly safetyNotices: readonly VdSafetyNotice[];
    readonly onRecordPreferences: (request: SendVdMessageRequest) => void;
    readonly recording: boolean;
    readonly onGenerate: (preparationMode: PreparationMode) => void;
    readonly generating: boolean;
    readonly failure: string | null;
    readonly testID?: string | undefined;
}

const MODES: readonly PreparationMode[] = ['home_prepared', 'kitchen_prepared', 'mixed'];

export function StructurePanel({
    proposal,
    safetyNotices,
    onRecordPreferences,
    recording,
    onGenerate,
    generating,
    failure,
    testID = 'vd-structure',
}: StructurePanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const [mode, setMode] = useState<PreparationMode>('mixed');
    const [kitchenIds, setKitchenIds] = useState<readonly KitchenId[]>([]);
    const [budget, setBudget] = useState('450');
    const [area, setArea] = useState('Business Bay');

    const kitchensQuery = useKitchensQuery({ channels: ['marketplace'] });
    const kitchens = kitchensQuery.data?.items ?? [];
    const selectedNames = kitchens
        .filter((kitchen) => kitchenIds.includes(kitchen.id))
        .map((kitchen) => kitchen.name);

    return (
        <Stack space="md" testID={testID}>
            <Inline space="sm" align="center">
                <Heading level={2}>{t('virtualDietitian:structure.title')}</Heading>
                <OriginBadge kind="ai" testID={`${testID}-heading-origin`} />
            </Inline>

            <Stack space="sm" testID={`${testID}-slots`}>
                <Heading level={3}>{t('virtualDietitian:structure.slotsTitle')}</Heading>
                {proposal.mealStructure.map((slot) => (
                    <Card
                        key={`${slot.mealType}-${slot.time ?? 'none'}`}
                        padding="sm"
                        tone="raised"
                        testID={`${testID}-slot-${slot.mealType}`}
                    >
                        <Inline space="sm" align="center" justify="between">
                            <Stack space="xs" className="flex-1 basis-40">
                                <Text variant="label">
                                    {t(`virtualDietitian:structure.mealType.${slot.mealType}`, {
                                        defaultValue: slot.mealType,
                                    })}
                                </Text>
                                <Text variant="caption" tone="secondary">
                                    {slot.time ?? t('virtualDietitian:structure.noTime')}
                                </Text>
                            </Stack>
                            <Text variant="caption" tone="secondary">
                                {t('virtualDietitian:structure.energyShare', {
                                    percent: formatter.formatNumber(
                                        Math.round(slot.energyShare * 100),
                                    ),
                                })}
                            </Text>
                            <Text variant="caption">
                                {t(`virtualDietitian:structure.mode.${slot.preparationMode}`)}
                            </Text>
                        </Inline>
                    </Card>
                ))}
            </Stack>

            <SafetyNotices notices={safetyNotices} testID={`${testID}-safety`} />
            <AllergenReminder testID={`${testID}-allergen-reminder`} />

            <Stack space="sm" testID={`${testID}-preferences`}>
                <Heading level={3}>{t('virtualDietitian:structure.modeQuestion')}</Heading>
                <SegmentedControl
                    testID={`${testID}-mode`}
                    label={t('virtualDietitian:structure.modeLabel')}
                    value={mode}
                    onChange={setMode}
                    items={MODES.map((candidate) => ({
                        value: candidate,
                        label: t(`virtualDietitian:structure.mode.${candidate}`),
                        testID: `${testID}-mode-${candidate}`,
                    }))}
                />

                <Heading level={3}>{t('virtualDietitian:structure.kitchensTitle')}</Heading>
                <Text variant="caption" tone="secondary">
                    {t('virtualDietitian:structure.kitchensHint')}
                </Text>
                {kitchensQuery.isPending ? (
                    <Skeleton testID={`${testID}-kitchens-loading`} heightClassName="h-12" />
                ) : kitchens.length === 0 ? (
                    <Text testID={`${testID}-kitchens-empty`} variant="caption" tone="secondary">
                        {t('virtualDietitian:structure.kitchensEmpty')}
                    </Text>
                ) : (
                    <Stack space="xs">
                        <Inline space="xs" wrap testID={`${testID}-kitchens`}>
                            {kitchens.map((kitchen) => (
                                <FilterChip
                                    key={String(kitchen.id)}
                                    testID={`${testID}-kitchen-${kitchen.slug}`}
                                    label={kitchen.name}
                                    selected={kitchenIds.includes(kitchen.id)}
                                    onChange={(selected) => {
                                        setKitchenIds((current) =>
                                            selected
                                                ? [...current, kitchen.id]
                                                : current.filter((id) => id !== kitchen.id),
                                        );
                                    }}
                                />
                            ))}
                        </Inline>
                        <Text
                            testID={`${testID}-kitchens-count`}
                            variant="caption"
                            tone="secondary"
                        >
                            {t('virtualDietitian:structure.kitchensSelected', {
                                count: kitchenIds.length,
                            })}
                        </Text>
                    </Stack>
                )}

                <TextInputField
                    testID={`${testID}-budget`}
                    label={t('virtualDietitian:structure.budgetLabel')}
                    hint={t('virtualDietitian:structure.budgetHint')}
                    inputMode="numeric"
                    keyboardType="number-pad"
                    value={budget}
                    onChangeText={setBudget}
                />

                <TextInputField
                    testID={`${testID}-area`}
                    label={t('virtualDietitian:structure.areaLabel')}
                    hint={t('virtualDietitian:structure.areaHint')}
                    value={area}
                    onChangeText={setArea}
                />

                <Inline space="sm" wrap>
                    <Button
                        testID={`${testID}-save`}
                        variant="secondary"
                        loading={recording}
                        label={
                            recording
                                ? t('virtualDietitian:structure.saving')
                                : t('virtualDietitian:structure.save')
                        }
                        onPress={() => {
                            onRecordPreferences({
                                body: t(
                                    'virtualDietitian:quickReplies.suggested_meal_structure.kitchenLunch',
                                ),
                                answers: {
                                    preparationMode: mode,
                                    weeklyBudgetMinorUnits:
                                        (Number.parseInt(budget, 10) || 0) * 100,
                                    deliveryArea: area,
                                    preferredKitchens:
                                        selectedNames.length === 0
                                            ? t('virtualDietitian:structure.kitchensEmpty')
                                            : selectedNames.join(
                                                  t('marketplace:common.listSeparator'),
                                              ),
                                },
                            });
                        }}
                    />
                    <Button
                        testID={`${testID}-generate`}
                        variant="primary"
                        loading={generating}
                        accessibilityHint={t('virtualDietitian:structure.generateHint')}
                        label={
                            generating
                                ? t('virtualDietitian:structure.generating')
                                : t('virtualDietitian:structure.generate')
                        }
                        onPress={() => {
                            onGenerate(mode);
                        }}
                    />
                </Inline>

                {failure === null ? null : (
                    <Text
                        testID={`${testID}-error`}
                        tone="danger"
                        role="alert"
                        aria-live="assertive"
                    >
                        {failure}
                    </Text>
                )}
            </Stack>
        </Stack>
    );
}
