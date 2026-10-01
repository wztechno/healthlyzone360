import type { ContactPoint, DietaryProfile } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Select,
    TextInputField,
    cx,
    inputFrameClassName,
    useBreakpoint,
    useToast,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import {
    toFailure,
    useContactPointsQuery,
    useDietaryProfileQuery,
    useSaveDietaryProfileMutation,
} from '../../data/account-hooks.ts';
import { useSession } from '../../session/session-provider.tsx';
import { Eyebrow } from '../../ui/eyebrow.tsx';
import { PillChip } from '../../ui/pill-chip.tsx';
import { QueryStates } from '../marketplace/query-states.tsx';
import { DIET_CLASSIFICATIONS } from '../onboarding/vocabularies.ts';
import { ACCOUNT_CARD, PanelTitle } from './account-card.tsx';
import { hasAnsweredAllergyQuestion } from './dietary.ts';

/**
 * The account page's Profile tab — the HealthZone `account` screen's "Profile & preferences" card,
 * element for element: the title, a 2×2 grid of fields (Full name, Email, Mobile, Default slot), a
 * hairline, the "DIETARY PREFERENCES · APPLIED TO RECOMMENDATIONS" eyebrow over a wrap row of pill
 * chips, then "Save changes" and "Cancel".
 *
 * ## The fields are the design's inputs, bound to what the contract can do
 *
 * * **Full name** and **Email** are real inputs, read-only: there is no endpoint that changes a
 *   display name or a sign-in address, so the value can be read, selected and copied and not typed
 *   over.
 * * **Mobile** is drawn as the same input, but pressing it opens the phone screen — the only way a
 *   number changes, because a new one is confirmed with a code before it is used. Its trailing word
 *   says what the press does (add, confirm, change).
 * * **Default slot** is a real select, disabled, reading "Chosen at each checkout": the account
 *   publishes no default delivery window, and the window is picked per order.
 *
 * ## It never waits on the customer-account record
 *
 * Name and email are the signed-in person's own — the session (`/me`) carries them, the same source
 * the profile page reads — and the phone is their contact points (`/me/contacts`). None of them is
 * the customer-account overview, which a person can be signed in without (a staff login, an account
 * whose customer record was never opened): gating the card on it emptied the whole Profile tab into
 * an error for exactly the people whose details were sitting in the session. Each part shows as
 * soon as its own source answers, and the diet chips, which do need the customer record, say so in
 * place when it is missing rather than taking the card down with them.
 *
 * ## The diet chips save, and only once the allergy question is answered
 *
 * The chips write `saveDietaryProfile` — the same record the allergies screen writes. That record
 * cannot take a diet without an allergy list beside it, and saving one turns `updatedAt` from `null`
 * into a date, which is exactly the fact `hasAnsweredAllergyQuestion` reads as "this person said
 * they have no allergies". Saving diet chips for somebody who has never answered would put words in
 * their mouth, so until they have, the chips and Save are inert and the one line under the chips
 * sends them to the question. Once they have, that line states their declared allergies and links
 * to edit them, and a save carries the stored allergens and exclusions through untouched.
 */

const TEST_ID = 'account-profile';

/** The phone a person is working with: the confirmed one, else the most recent unconfirmed. */
function currentPhone(contacts: readonly ContactPoint[]): ContactPoint | null {
    const phones = contacts.filter((contact) => contact.kind === 'phone');
    return phones.find((contact) => contact.verified) ?? phones[phones.length - 1] ?? null;
}

/** The edited diet — one code or none — seeded from the profile the first time it arrives. */
interface DietEdit {
    readonly diet: string | null;
    /** `updatedAt` of the profile this edit was seeded from. */
    readonly from: string | null;
}

/** One field cell of the design's 2×2 grid. */
function Cell({ children }: { readonly children: ReactNode }) {
    return <View className="z-auto min-w-0 flex-1">{children}</View>;
}

/**
 * The Mobile field: the design's input, opening the phone screen when pressed. Not a `TextInput` —
 * nothing is typed here — but the same frame, label and value, so the grid reads as four fields.
 */
function MobileField({ phone }: { readonly phone: ContactPoint | null }) {
    const { t } = useTranslation();
    const router = useRouter();
    const label = t('account:profile.mobileLabel');
    const value = phone === null ? t('account:profile.noPhone') : phone.maskedValue;
    const action =
        phone === null
            ? t('account:profile.phoneAdd')
            : phone.verified
              ? t('account:profile.phoneChange')
              : t('account:profile.phoneVerify');

    return (
        <View testID={`${TEST_ID}-phone`} className="flex-col gap-hair">
            <RNText className="text-sm font-medium text-content-primary text-start">{label}</RNText>
            <Pressable
                testID={`${TEST_ID}-phone-open`}
                role="link"
                accessibilityRole="link"
                accessibilityLabel={`${label}: ${value}`}
                accessibilityHint={action}
                onPress={() => {
                    router.push('/customer/account/phone' as never);
                }}
                className={cx(
                    inputFrameClassName({ invalid: false, focused: false, disabled: false }),
                    'min-h-touch hover:border-stroke-strong',
                )}
            >
                <RNText
                    testID={`${TEST_ID}-phone-value`}
                    numberOfLines={1}
                    className={cx(
                        'min-w-0 flex-1 text-base text-start',
                        phone === null ? 'text-content-secondary' : 'text-content-primary',
                    )}
                >
                    {value}
                </RNText>
                <RNText
                    testID={`${TEST_ID}-phone-state`}
                    className={cx(
                        'text-sm font-medium text-end',
                        phone !== null && !phone.verified
                            ? 'text-warning-strong'
                            : 'text-content-secondary',
                    )}
                >
                    {action}
                </RNText>
            </Pressable>
        </View>
    );
}

function DietaryPreferences({ profile }: { readonly profile: DietaryProfile }) {
    const { t } = useTranslation();
    const router = useRouter();
    const toast = useToast();
    const save = useSaveDietaryProfileMutation();
    const [edit, setEdit] = useState<DietEdit | null>(null);

    const answered = hasAnsweredAllergyQuestion(profile);
    // Derived rather than pushed by an effect, on the allergies screen's rule: the refetch that
    // follows a save would otherwise overwrite the edit that caused it.
    const diet =
        edit !== null && edit.from === profile.updatedAt ? edit.diet : profile.dietCategoryCode;
    const dirty = diet !== profile.dietCategoryCode;
    const failure = toFailure(save.error);
    const eyebrow = t('account:profile.dietsEyebrow');

    const allergyLine = !answered
        ? t('account:profile.dietsLocked')
        : profile.allergens.length === 0
          ? t('account:profile.allergiesNone')
          : t('account:profile.allergiesDeclared', {
                list: profile.allergens
                    .map((entry) => t(`onboarding:allergens.${entry.allergenCode}`))
                    .join(t('account:profile.listSeparator')),
            });

    return (
        <View className="flex-col">
            <Eyebrow>{eyebrow}</Eyebrow>
            <View
                testID={`${TEST_ID}-diets`}
                // One diet: the profile stores a single classification. Choosing the chosen one
                // again clears it.
                role="radiogroup"
                accessibilityRole="radiogroup"
                aria-label={eyebrow}
                accessibilityLabel={eyebrow}
                className="mt-3 flex-row flex-wrap gap-2"
            >
                {DIET_CLASSIFICATIONS.map((code) => (
                    <PillChip
                        key={code}
                        mode="radio"
                        floor="pill"
                        testID={`${TEST_ID}-diets-${code}`}
                        label={t(`onboarding:diets.${code}`)}
                        selected={diet === code}
                        disabled={!answered || save.isPending}
                        onPress={() => {
                            setEdit({ diet: diet === code ? null : code, from: profile.updatedAt });
                        }}
                    />
                ))}
            </View>

            {/*
             * The allergy declaration's one line. Not a chip — an allergy is a safety constraint,
             * not a preference, and drawing it among the diets would say they are the same kind of
             * thing — but the way to the question, and while it is unanswered, the reason the chips
             * above do not move.
             */}
            <View className="mt-3 flex-row flex-wrap items-center gap-x-2 gap-y-1">
                <RNText
                    testID={answered ? `${TEST_ID}-allergies` : `${TEST_ID}-diets-locked`}
                    className={cx(
                        'text-sm text-start',
                        answered ? 'text-content-secondary' : 'text-warning-strong',
                    )}
                >
                    {allergyLine}
                </RNText>
                <Pressable
                    testID={`${TEST_ID}-allergies-edit`}
                    role="link"
                    accessibilityRole="link"
                    onPress={() => {
                        router.push('/customer/account/allergies' as never);
                    }}
                    className="min-h-touch justify-center"
                >
                    <RNText className="text-sm font-semibold text-content-primary underline text-start">
                        {answered
                            ? t('account:profile.editAllergies')
                            : t('account:profile.answerAllergies')}
                    </RNText>
                </Pressable>
            </View>

            {failure === null ? null : (
                <Callout
                    testID={`${TEST_ID}-error`}
                    role="alert"
                    tone="danger"
                    title={failure.message}
                    className="mt-3"
                />
            )}

            <View className="mt-6 flex-row flex-wrap gap-2.5">
                <Button
                    testID={`${TEST_ID}-save`}
                    label={t('account:profile.save')}
                    loading={save.isPending}
                    disabled={!answered || !dirty}
                    onPress={() => {
                        save.mutate(
                            {
                                dietCategoryCode: diet,
                                // Carried through, never re-derived: this panel edits diets only.
                                allergens: profile.allergens,
                                excludedIngredientIds: profile.excludedIngredientIds,
                            },
                            {
                                onSuccess: () => {
                                    setEdit(null);
                                    toast.show({
                                        message: t('account:profile.saved'),
                                        tone: 'success',
                                        testID: `${TEST_ID}-saved`,
                                    });
                                },
                            },
                        );
                    }}
                />
                <Button
                    testID={`${TEST_ID}-cancel`}
                    variant="quiet"
                    label={t('account:profile.cancel')}
                    disabled={!dirty || save.isPending}
                    onPress={() => {
                        setEdit(null);
                    }}
                />
            </View>
        </View>
    );
}

/**
 * The dietary row when there is no dietary record to edit — the customer record is missing, or the
 * read failed. The design's eyebrow and the chips stay where they are, inert, with one line saying
 * why, so the card keeps its shape instead of swapping it for an error box.
 */
function DietaryUnavailable() {
    const { t } = useTranslation();
    const eyebrow = t('account:profile.dietsEyebrow');
    return (
        <View testID={`${TEST_ID}-dietary-unavailable`} className="flex-col">
            <Eyebrow>{eyebrow}</Eyebrow>
            <View
                role="group"
                aria-label={eyebrow}
                accessibilityLabel={eyebrow}
                className="mt-3 flex-row flex-wrap gap-2"
            >
                {DIET_CLASSIFICATIONS.map((code) => (
                    <PillChip
                        key={code}
                        floor="pill"
                        label={t(`onboarding:diets.${code}`)}
                        disabled
                    />
                ))}
            </View>
            <RNText className="mt-3 text-sm text-content-secondary text-start">
                {t('account:profile.dietsUnavailable')}
            </RNText>
        </View>
    );
}

export function AccountProfilePanel() {
    const { t } = useTranslation();
    const { atLeast } = useBreakpoint();
    const { me } = useSession();
    const contacts = useContactPointsQuery();
    const profile = useDietaryProfileQuery();

    const phone = currentPhone(contacts.data ?? []);
    // The design's `1fr 1fr` grid; one column on a phone, where two 160px inputs truncate.
    const row = atLeast('md') ? 'z-auto flex-row gap-4' : 'z-auto flex-col gap-4';

    return (
        <View testID={TEST_ID} className={`${ACCOUNT_CARD} p-6`}>
            <PanelTitle testID={`${TEST_ID}-title`}>{t('account:profile.title')}</PanelTitle>

            <View className="z-auto mt-4 flex-col gap-4">
                <View className={row}>
                    <Cell>
                        <TextInputField
                            testID={`${TEST_ID}-name`}
                            label={t('account:profile.nameLabel')}
                            value={me?.profile.displayName ?? ''}
                            readOnly
                            selectTextOnFocus
                        />
                    </Cell>
                    <Cell>
                        <TextInputField
                            testID={`${TEST_ID}-email`}
                            label={t('account:profile.emailLabel')}
                            value={me?.user.email ?? ''}
                            readOnly
                            selectTextOnFocus
                            keyboardType="email-address"
                        />
                    </Cell>
                </View>
                <View className={row}>
                    <Cell>
                        <MobileField phone={phone} />
                    </Cell>
                    <Cell>
                        <Select
                            testID={`${TEST_ID}-slot`}
                            label={t('account:profile.slotLabel')}
                            options={(['morning', 'midday', 'evening'] as const).map((code) => ({
                                value: code,
                                label: t(`commerce:slots.${code}`),
                            }))}
                            value={null}
                            placeholder={t('account:profile.slotUnset')}
                            disabled
                            onChange={() => {
                                // Disabled: the account has no default window to write.
                            }}
                        />
                    </Cell>
                </View>
            </View>

            <View className="mt-5 border-t border-stroke-subtle pt-5">
                {profile.isError ? (
                    <DietaryUnavailable />
                ) : (
                    <QueryStates
                        query={profile}
                        isEmpty={false}
                        emptyTitle={t('account:dietary.title')}
                        skeletonCount={1}
                        testID={`${TEST_ID}-dietary`}
                    >
                        {profile.data === undefined ? null : (
                            <DietaryPreferences profile={profile.data} />
                        )}
                    </QueryStates>
                )}
            </View>
        </View>
    );
}
