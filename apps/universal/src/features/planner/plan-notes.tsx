import {
    Button,
    Callout,
    Card,
    Drawer,
    Stack,
    Text,
    TextInputField,
    useBreakpoint,
} from '@healthy360/design-system';
import type { MealPlanId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePlanNotesQuery, useSetPlanNotesMutation } from '../../data/planner-hooks.ts';
import { QueryStates } from '../marketplace/query-states.tsx';

/**
 * Plan notes: the person's own, and the dietitian's.
 *
 * `PlanNotes` carries `customerNote` and `dietitianNote` as two separate fields, and only the first
 * is writable — the second is written through `./professional.ts` and is read-only here
 * (`contracts/planner.ts` says so in as many words). That asymmetry is the whole design: a
 * professional's note that a client could quietly edit is not a professional's note, and doc 17,
 * PRO-02 keeps the consumer's own agency intact alongside it rather than instead of it.
 *
 * Doc 10, PRS-05 records that notes survive regeneration at every scope in the reference product,
 * and doc 17, PLN-05 extends that to plan level, which is what this is. The store honours it: every
 * regeneration path rewrites entries and leaves `customerNote` alone.
 *
 * The editor holds an edit buffer only once there is an edit; until then it shows whatever the query
 * holds. That is what keeps a background refetch from discarding something half-typed, without the
 * usual "seed the state from the query in an effect" dance and its cascading renders.
 */
export interface PlanNotesPanelProps {
    readonly planId: MealPlanId;
    readonly open: boolean;
    readonly onClose: () => void;
    readonly onAnnounce: (message: string) => void;
    readonly testID?: string | undefined;
}

export function PlanNotesPanel({
    planId,
    open,
    onClose,
    onAnnounce,
    testID = 'planner-notes',
}: PlanNotesPanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();

    const notes = usePlanNotesQuery(planId);
    const save = useSetPlanNotesMutation();

    const saved = notes.data?.customerNote ?? '';
    /**
     * `null` means "not edited yet", and the field then shows whatever the query holds.
     *
     * Deliberately not an effect that seeds a buffer from the query: that pattern needs a second
     * piece of state to remember what it seeded from, re-renders once per fetch, and races a save
     * that lands while somebody is typing. Deriving the displayed value instead has none of those
     * problems — the buffer only exists once there is an edit to hold.
     */
    const [edit, setEdit] = useState<string | null>(null);
    const draft = edit ?? saved;
    const dirty = edit !== null && edit !== saved;

    return (
        <Drawer
            testID={testID}
            open={open}
            onClose={onClose}
            placement={atLeast('lg') ? 'end' : 'bottom'}
            title={t('planner:notes.title')}
            className={atLeast('lg') ? 'w-[420px] max-w-[95vw]' : undefined}
        >
            <QueryStates
                query={notes}
                isEmpty={false}
                emptyTitle={t('planner:notes.title')}
                skeletonCount={1}
                testID={`${testID}-states`}
            >
                <Stack space="md" testID={`${testID}-body`}>
                    {notes.data?.dietitianNote == null ? (
                        <Text testID={`${testID}-no-dietitian-note`} tone="secondary">
                            {t('planner:notes.noDietitianNote')}
                        </Text>
                    ) : (
                        <Callout
                            testID={`${testID}-dietitian-note`}
                            role="note"
                            tone="info"
                            icon="info"
                            title={t('planner:notes.dietitianTitle')}
                            body={notes.data.dietitianNote}
                        />
                    )}

                    <Card testID={`${testID}-editor`} padding="md" tone="sunken">
                        <Stack space="sm">
                            <TextInputField
                                testID={`${testID}-input`}
                                id={`${testID}-input`}
                                label={t('planner:notes.customerLabel')}
                                hint={t('planner:notes.customerHint')}
                                multiline
                                numberOfLines={5}
                                value={draft}
                                onChangeText={setEdit}
                            />

                            <Button
                                testID={`${testID}-save`}
                                label={
                                    save.isPending
                                        ? t('planner:notes.saving')
                                        : t('planner:notes.save')
                                }
                                disabled={!dirty || save.isPending}
                                onPress={() => {
                                    save.mutate(
                                        {
                                            planId,
                                            request: {
                                                customerNote: draft.trim() === '' ? null : draft,
                                            },
                                        },
                                        {
                                            onSuccess: () => {
                                                // Back to "not edited": the query is now the
                                                // authority again, and the field follows it.
                                                setEdit(null);
                                                onAnnounce(t('planner:announce.notesSaved'));
                                            },
                                        },
                                    );
                                }}
                            />

                            {save.isError ? (
                                <Callout
                                    testID={`${testID}-error`}
                                    role="alert"
                                    tone="danger"
                                    icon="error"
                                    title={t('planner:notes.errorTitle')}
                                    body={t('planner:notes.errorBody')}
                                />
                            ) : null}

                            <Text testID={`${testID}-updated`} variant="caption" tone="secondary">
                                {notes.data?.updatedAt == null
                                    ? t('planner:notes.neverSaved')
                                    : t('planner:notes.updatedAt', {
                                          timestamp: formatter.formatDate(notes.data.updatedAt, {
                                              dateStyle: 'medium',
                                              timeStyle: 'short',
                                          }),
                                      })}
                            </Text>
                        </Stack>
                    </Card>

                    <Text variant="caption" tone="secondary">
                        {t('planner:notes.survivesRegeneration')}
                    </Text>
                </Stack>
            </QueryStates>
        </Drawer>
    );
}
