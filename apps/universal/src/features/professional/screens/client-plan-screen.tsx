import {
    Badge,
    Button,
    Callout,
    Card,
    Heading,
    Inline,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { MealPlanDay, MealPlanEntry } from '@healthy360/api-client/contracts';
import { MealPlanId, UserId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useClientPlanQuery,
    useSetDietitianNoteMutation,
} from '../../../data/professional-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { isIsoDate } from '../../commerce/dates.ts';
import { PlannerAnnouncer, usePlannerAnnouncement } from '../../planner/announcer.tsx';
import { allergenKey, formatMoney, nutrientValue } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { warningKey } from '../format.ts';

/**
 * `/dietitian/clients/{client}/{plan}/{week}` — a client's week, as the professional sees it.
 *
 * ## Every part of the address is in the path
 *
 * `getClientPlan(clientId, planId, weekStart)` needs all three, and none of them has a defensible
 * default: guessing the week from the clock would show a different week depending on when the link
 * was opened, and guessing the plan is not possible at all. So the route carries all three, the
 * screen validates each, and a malformed address renders a not-found rather than a failed request.
 *
 * ## There is no client directory, and that is the contract's decision
 *
 * `ProfessionalRepository` scopes every method by an identifier the caller was handed and publishes
 * no "list my clients" (`contracts/professional.ts`). This screen is therefore reached from a review
 * or from a link, and does not offer navigation to any other client — inventing a roster the
 * interface does not publish would be the UI asserting an access decision that is the backend's.
 *
 * ## The note is a real mutation
 *
 * `setDietitianNote` exists and the store honours it, writing a `notes_updated` event onto the plan.
 * It is wired straight through rather than routed via a prototype notice.
 */

export interface ClientPlanScreenProps {
    readonly clientId: string | undefined;
    readonly planId: string | undefined;
    readonly weekStart: string | undefined;
}

export function ClientPlanScreen({ clientId, planId, weekStart }: ClientPlanScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { message, announce } = usePlannerAnnouncement();

    const client = clientId === undefined ? null : UserId.safeParse(clientId);
    const plan = planId === undefined ? null : MealPlanId.safeParse(planId);
    const week = weekStart !== undefined && isIsoDate(weekStart) ? weekStart : null;

    const query = useClientPlanQuery(client, plan, week);
    const data = query.data;

    const [note, setNote] = useState('');
    const setDietitianNote = useSetDietitianNoteMutation();
    const failure = toFailure(setDietitianNote.error);

    const backAction = (
        <Button
            testID="client-plan-back"
            variant="secondary"
            label={t('professional:plan.back')}
            onPress={() => {
                router.push('/dietitian' as never);
            }}
        />
    );

    if (client === null || plan === null || week === null) {
        return (
            <Stack space="lg" testID="client-plan-screen">
                <Callout
                    testID="client-plan-not-found"
                    role="alert"
                    tone="warning"
                    icon="warning"
                    title={t('professional:plan.notFoundTitle')}
                    body={t('professional:plan.notFoundBody')}
                    actions={backAction}
                />
            </Stack>
        );
    }

    const days: readonly MealPlanDay[] = data?.days ?? [];
    const energy = data === undefined ? 0 : nutrientValue(data.summary.dailyAverage, 'energy');

    return (
        <Stack space="lg" testID="client-plan-screen">
            <PlannerAnnouncer message={message} testID="client-plan-announcer" />

            <Stack space="xs">
                <Heading level={1} testID="client-plan-title">
                    {t('professional:plan.title')}
                </Heading>
                <Text tone="secondary" testID="client-plan-week">
                    {t('professional:plan.week', {
                        date: formatter.formatDate(week, { dateStyle: 'full' }),
                    })}
                </Text>
            </Stack>

            <MedicalDisclaimer context={t('professional:plan.disclaimerContext')} />

            <QueryStates
                query={query}
                isEmpty={days.length === 0}
                emptyTitle={t('professional:plan.emptyTitle')}
                emptyBody={t('professional:plan.emptyBody')}
                emptyActions={backAction}
                skeletonCount={3}
                testID="client-plan"
            >
                {data === undefined ? null : (
                    <Stack space="lg">
                        <Stack space="xs" testID="client-plan-summary">
                            <Text variant="label">{t('professional:plan.summaryTitle')}</Text>
                            <Text testID="client-plan-average-energy">
                                {t('professional:plan.averageEnergy', { value: energy })}
                            </Text>
                            <Text testID="client-plan-cost" tone="secondary" variant="caption">
                                {data.summary.estimatedCost === null
                                    ? t('professional:plan.noCost')
                                    : t('professional:plan.cost', {
                                          value: formatMoney(formatter, data.summary.estimatedCost),
                                      })}
                            </Text>
                            <Text
                                tone="secondary"
                                variant="caption"
                                testID="client-plan-planned-note"
                            >
                                {t('professional:plan.plannedNote')}
                            </Text>
                        </Stack>

                        <Stack space="sm" testID="client-plan-days">
                            {days.map((day) => (
                                <Card
                                    key={day.date}
                                    testID={`client-plan-day-${day.date}`}
                                    padding="md"
                                >
                                    <Stack space="sm">
                                        <Text variant="bodyStrong">
                                            {formatter.formatDate(day.date, {
                                                dateStyle: 'full',
                                            })}
                                        </Text>
                                        {day.entries.length === 0 ? (
                                            <Text tone="secondary" variant="caption">
                                                {t('professional:plan.noEntries')}
                                            </Text>
                                        ) : (
                                            day.entries.map((entry) => (
                                                <EntryRow key={entry.id} entry={entry} />
                                            ))
                                        )}
                                    </Stack>
                                </Card>
                            ))}
                        </Stack>
                    </Stack>
                )}
            </QueryStates>

            {failure === null ? null : (
                <Callout
                    testID="client-plan-failure"
                    role="alert"
                    tone="danger"
                    icon="warning"
                    title={t('professional:plan.noteFailedTitle')}
                    body={failure.message}
                />
            )}

            <Stack space="sm" testID="client-plan-note">
                <Text variant="label">{t('professional:plan.noteTitle')}</Text>
                <TextInputField
                    testID="client-plan-note-input"
                    id="client-plan-note-input"
                    label={t('professional:plan.noteLabel')}
                    hint={t('professional:plan.noteHint')}
                    value={note}
                    multiline
                    onChangeText={setNote}
                />
                <Inline space="sm" wrap>
                    <Button
                        testID="client-plan-note-save"
                        label={t('professional:plan.noteSave')}
                        loading={setDietitianNote.isPending}
                        onPress={() => {
                            setDietitianNote.mutate(
                                {
                                    planId: plan,
                                    note: note.trim() === '' ? null : note.trim(),
                                },
                                {
                                    onSuccess: () => {
                                        announce(t('professional:plan.announceNote'));
                                    },
                                },
                            );
                        }}
                    />
                    {backAction}
                </Inline>
            </Stack>
        </Stack>
    );
}

interface EntryRowProps {
    readonly entry: MealPlanEntry;
}

/**
 * One entry, with the four facts that decide whether a professional needs to act on it: what it is,
 * whether it carries an allergen, whether the planner flagged it, and whether anybody has signed it
 * off already.
 */
function EntryRow({ entry }: EntryRowProps) {
    const { t } = useTranslation();
    const testId = `client-plan-entry-${String(entry.id)}`;

    return (
        <Stack space="xs" testID={testId}>
            <Inline space="sm" align="center" justify="between">
                <Text testID={`${testId}-label`}>{entry.label}</Text>
                <Badge
                    testID={`${testId}-meal-type`}
                    tone="neutral"
                    icon="dot"
                    label={t(`marketplace:mealTypes.${entry.mealType}`, {
                        defaultValue: entry.mealType,
                    })}
                />
            </Inline>

            <Inline space="xs" wrap>
                {entry.approvedBy === null ? null : (
                    <Badge
                        testID={`${testId}-approved`}
                        tone="success"
                        icon="check"
                        label={t('professional:plan.entryApproved')}
                    />
                )}
                {entry.locked ? (
                    <Badge
                        testID={`${testId}-kept`}
                        tone="info"
                        icon="info"
                        label={t('professional:plan.entryKept')}
                    />
                ) : null}
                {entry.isLeftover ? (
                    <Badge
                        testID={`${testId}-leftover`}
                        tone="neutral"
                        icon="dot"
                        label={t('professional:plan.entryLeftover')}
                    />
                ) : null}
            </Inline>

            {entry.allergens.length === 0 ? null : (
                <Text tone="secondary" variant="caption" testID={`${testId}-allergens`}>
                    {t('professional:plan.entryAllergens', {
                        allergens: entry.allergens
                            .map((code) => t(allergenKey(code), { defaultValue: code }))
                            .join(t('professional:common.listSeparator')),
                    })}
                </Text>
            )}

            {entry.warnings.length === 0 ? null : (
                <Text tone="warning" variant="caption" testID={`${testId}-warnings`}>
                    {entry.warnings
                        .map((code) => t(warningKey(code), { defaultValue: code }))
                        .join(t('professional:common.listSeparator'))}
                </Text>
            )}
        </Stack>
    );
}
