import {
    Button,
    Callout,
    Card,
    Heading,
    Inline,
    SegmentedControl,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useDietaryProfileQuery,
    useSaveDietaryProfileMutation,
} from '../../../data/account-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { AllergyPicker } from '../allergy-picker.tsx';
import { DietaryTagsPicker } from '../dietary-tags-picker.tsx';
import { declarationsFor, initialAllergyAnswer } from '../dietary.ts';
import type { AllergenDeclaration, DietaryProfile } from '../repositories-shim.ts';

/**
 * `/customer/account/allergies` — the store of record for what a person cannot eat.
 *
 * ## Why there is a Yes/No question in front of the tick-list
 *
 * "No allergies" and "has not said yet" are different facts, and only one of them completes the
 * step. An empty tick-list cannot tell them apart — which is how a meal configurator ends up asking
 * the same question on every order, and how a checklist shows an outstanding step to somebody who
 * answered it honestly with a "no". The contract's `DietaryProfile.updatedAt` is what distinguishes
 * them, and the branch is what lets a person *say* no rather than leave a list empty and hope.
 *
 * Answering "no" saves an empty declaration. That is a real answer with a real timestamp, not a
 * no-op.
 *
 * ## The list is kept while the answer is "no"
 *
 * Flipping to "no" clears what is *saved*, not what is on screen: a person who ticks peanuts,
 * changes their mind, then changes it back should not have to tick peanuts again. The rule lives in
 * `../dietary.ts` so it is one function rather than a condition inside a submit handler.
 *
 * ## The disclaimer is not decoration
 *
 * This screen collects health information and the product acts on it. `MedicalDisclaimer` is
 * mandatory here (plan §5) and it says the thing that matters: the platform filters meals against
 * what it was told, and being told correctly is a shared responsibility rather than a guarantee.
 */

const TEST_ID = 'allergies-screen';

const ANSWERS = ['yes', 'no'] as const;
type Answer = (typeof ANSWERS)[number];

/** Component state, seeded from the profile the first time it arrives. */
interface Edit {
    readonly answer: Answer | null;
    readonly allergens: readonly AllergenDeclaration[];
    readonly diets: readonly string[];
    /** `updatedAt` of the profile this edit was seeded from — `null` before the first save. */
    readonly from: string | null;
}

function seed(profile: DietaryProfile): Edit {
    const answered = initialAllergyAnswer(profile);
    return {
        answer: answered === null ? null : answered ? 'yes' : 'no',
        allergens: profile.allergens,
        diets: profile.dietCategoryCodes,
        from: profile.updatedAt,
    };
}

export function AllergiesScreen() {
    const { t } = useTranslation();

    const profile = useDietaryProfileQuery();
    const save = useSaveDietaryProfileMutation();

    const [edit, setEdit] = useState<Edit | null>(null);

    /**
     * Derived rather than pushed by an effect, on the same rule as the address editor: the refetch
     * that follows a save would otherwise overwrite the very edit that caused it.
     */
    const loaded = profile.data;
    const current: Edit =
        loaded === undefined
            ? { answer: null, allergens: [], diets: [], from: null }
            : edit !== null && edit.from === loaded.updatedAt
              ? edit
              : seed(loaded);

    const set = (patch: Partial<Edit>) => {
        setEdit({ ...current, ...patch, from: loaded?.updatedAt ?? null });
    };

    const saveFailure = toFailure(save.error);
    const saved = save.isSuccess && edit === null;

    return (
        <Stack space="lg" testID={TEST_ID}>
            <Stack space="xs">
                <Heading level={1} testID={`${TEST_ID}-title`}>
                    {t('account:dietary.title')}
                </Heading>
                <Text tone="secondary">{t('account:dietary.subtitle')}</Text>
                <Text tone="secondary" variant="caption" testID={`${TEST_ID}-store-of-record`}>
                    {t('account:dietary.storeOfRecord')}
                </Text>
            </Stack>

            <MedicalDisclaimer context={t('account:dietary.disclaimerContext')} />

            <QueryStates
                query={profile}
                isEmpty={false}
                emptyTitle={t('account:dietary.title')}
                skeletonCount={2}
                testID={`${TEST_ID}-profile`}
            >
                <Stack space="md">
                    {saveFailure === null ? null : (
                        <Callout
                            testID={`${TEST_ID}-error`}
                            role="alert"
                            tone="danger"
                            title={saveFailure.message}
                        />
                    )}

                    {saved ? (
                        <Callout
                            testID={`${TEST_ID}-saved`}
                            role="status"
                            tone="success"
                            title={t('account:dietary.saved')}
                        />
                    ) : null}

                    <Card padding="md">
                        <Stack space="sm">
                            <SegmentedControl
                                testID={`${TEST_ID}-answer`}
                                label={t('account:dietary.hasAllergiesLabel')}
                                block
                                value={current.answer ?? ''}
                                onChange={(next) => {
                                    set({ answer: next as Answer });
                                }}
                                items={ANSWERS.map((answer) => ({
                                    value: answer,
                                    label: t(`account:dietary.hasAllergies.${answer}`),
                                    testID: `${TEST_ID}-answer-${answer}`,
                                }))}
                            />

                            {current.answer === null ? (
                                <Text tone="secondary" testID={`${TEST_ID}-unanswered`}>
                                    {t('account:dietary.unanswered')}
                                </Text>
                            ) : null}

                            {current.answer === 'no' ? (
                                <Text tone="secondary" testID={`${TEST_ID}-none`}>
                                    {t('account:dietary.noneBody')}
                                </Text>
                            ) : null}

                            {current.answer === 'yes' ? (
                                <AllergyPicker
                                    testID={`${TEST_ID}-allergens`}
                                    value={current.allergens}
                                    disabled={save.isPending}
                                    onChange={(allergens) => {
                                        set({ allergens });
                                    }}
                                />
                            ) : null}
                        </Stack>
                    </Card>

                    <Card padding="md">
                        <DietaryTagsPicker
                            testID={`${TEST_ID}-diets`}
                            value={current.diets}
                            disabled={save.isPending}
                            onChange={(diets) => {
                                set({ diets });
                            }}
                        />
                    </Card>

                    <Inline space="sm">
                        <Button
                            testID={`${TEST_ID}-save`}
                            label={t('account:dietary.save')}
                            loading={save.isPending}
                            disabled={current.answer === null}
                            onPress={() => {
                                save.mutate(
                                    {
                                        dietCategoryCodes: current.diets,
                                        allergens: declarationsFor(
                                            current.answer === 'yes',
                                            current.allergens,
                                        ),
                                        // Ingredient-level exclusions are a separate surface (the
                                        // configurator's "leave this out"), and this screen has no
                                        // control for them — so it preserves what is stored rather
                                        // than sending an empty list that would silently drop them.
                                        excludedIngredientIds: loaded?.excludedIngredientIds ?? [],
                                    },
                                    {
                                        onSuccess: () => {
                                            // Drop the local edit so the saved profile becomes the
                                            // seed again — the "saved" notice is derived from that.
                                            setEdit(null);
                                        },
                                    },
                                );
                            }}
                        />
                    </Inline>
                </Stack>
            </QueryStates>
        </Stack>
    );
}
