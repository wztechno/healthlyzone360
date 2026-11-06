import type { ContactPoint, DietaryProfile } from '@healthy360/api-client/contracts';
import { Callout, Icon, cx, useBreakpoint, useToast } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';

import { useCan } from '../../access/gate.tsx';
import {
    toFailure,
    useContactPointsQuery,
    useDietaryProfileQuery,
    useSaveDietaryProfileMutation,
} from '../../data/account-hooks.ts';
import { withReturnTo } from '../../navigation/return-to.ts';
import { useSession } from '../../session/session-provider.tsx';
import { QueryStates } from '../marketplace/query-states.tsx';
import { DIET_CLASSIFICATIONS } from '../onboarding/vocabularies.ts';
import { ACCOUNT_CARD, CountPill, LinkRow, PanelHead } from './account-card.tsx';
import { hasAnsweredAllergyQuestion } from './dietary.ts';

/**
 * The account page's Profile section, as the accepted Account board draws it: the four fields (Full
 * name, Email, Mobile with Change, the delivery window "Chosen at each checkout"), a rule, "Your diet"
 * with its count over the diet tiles, the amber allergies card with Manage, Save and Cancel, and the
 * Change password and Devices rows.
 *
 * ## The fields are read-only, and say so by what they offer
 *
 * There is no endpoint that changes a display name or a sign-in address, so Full name and Email are
 * values that can be selected and copied, not typed over. Mobile's Change opens the phone screen —
 * the only way a number changes, because a new one is confirmed with a code before it is used. The
 * account publishes no default delivery window, so that field states it is chosen per order.
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
 * The tiles write `saveDietaryProfile` — the same record the allergies screen writes. That record
 * cannot take a diet without an allergy list beside it, and saving one turns `updatedAt` from `null`
 * into a date, which is exactly the fact `hasAnsweredAllergyQuestion` reads as "this person said
 * they have no allergies". Saving diet chips for somebody who has never answered would put words in
 * their mouth, so until they have, the chips and Save are inert and the one line under the chips
 * sends them to the question. Once they have, that line states their declared allergies and links
 * to edit them, and a save carries the stored allergens and exclusions through untouched.
 *
 * ## Sign-in and security
 *
 * Change password and Devices had no way in for a customer: they were linked from `/profile`,
 * which only the staff workspace reaches. They sit at the foot of this card, each opened with this
 * tab as its `?returnTo=` so finishing comes back here. Devices is behind `device.manage_own`, the
 * permission its own route gates on — a link to a page that would refuse the person is worse than
 * no link.
 */

/** Where the security pages come back to. */
const PROFILE_HOME = '/customer/account?section=profile';

const TEST_ID = 'account-profile';

/** The phone a person is working with: the confirmed one, else the most recent unconfirmed. */
export function currentPhone(contacts: readonly ContactPoint[]): ContactPoint | null {
    const phones = contacts.filter((contact) => contact.kind === 'phone');
    return phones.find((contact) => contact.verified) ?? phones[phones.length - 1] ?? null;
}

/** The edited diet — one code or none — seeded from the profile the first time it arrives. */
interface DietEdit {
    readonly diet: string | null;
    /** `updatedAt` of the profile this edit was seeded from. */
    readonly from: string | null;
}

/** One of the board's read-only fields: a small label over a sunken value box. */
function Field({
    label,
    value,
    testID,
    muted = false,
    action,
}: {
    readonly label: string;
    readonly value: string;
    readonly testID: string;
    readonly muted?: boolean;
    readonly action?: ReactNode;
}) {
    return (
        <View testID={testID} className="min-w-0 flex-1">
            <RNText className="mb-1.5 text-xs font-semibold text-content-secondary text-start">
                {label}
            </RNText>
            <View className="h-12 flex-row items-center gap-2 rounded-[14px] border border-stroke bg-surface-base px-3.5">
                <RNText
                    testID={`${testID}-value`}
                    selectable
                    numberOfLines={1}
                    className={cx(
                        'min-w-0 flex-1 text-base text-start',
                        muted ? 'text-content-secondary' : 'text-content-primary',
                    )}
                >
                    {value}
                </RNText>
                {action}
            </View>
        </View>
    );
}

/**
 * The Mobile field: the board's value box with "Change" — opening the phone screen, the only way a
 * number changes, because a new one is confirmed with a code before it is used.
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
        <Field
            testID={`${TEST_ID}-phone`}
            label={label}
            value={value}
            muted={phone === null}
            action={
                <Pressable
                    testID={`${TEST_ID}-phone-open`}
                    role="link"
                    accessibilityRole="link"
                    accessibilityLabel={`${label}: ${value}`}
                    accessibilityHint={action}
                    onPress={() => {
                        router.push('/customer/account/phone' as never);
                    }}
                    className="min-h-touch justify-center"
                >
                    <RNText
                        testID={`${TEST_ID}-phone-state`}
                        className={cx(
                            'text-sm font-semibold',
                            phone !== null && !phone.verified
                                ? 'text-warning-strong'
                                : 'text-content-on-brand-subtle',
                        )}
                    >
                        {action}
                    </RNText>
                </Pressable>
            }
        />
    );
}

function DietaryPreferences({
    profile,
    onOpenAllergies,
}: {
    readonly profile: DietaryProfile;
    readonly onOpenAllergies: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const { atLeast } = useBreakpoint();
    const save = useSaveDietaryProfileMutation();
    const [edit, setEdit] = useState<DietEdit | null>(null);

    const answered = hasAnsweredAllergyQuestion(profile);
    // Derived rather than pushed by an effect, on the allergies pane's rule: the refetch that
    // follows a save would otherwise overwrite the edit that caused it.
    const diet =
        edit !== null && edit.from === profile.updatedAt ? edit.diet : profile.dietCategoryCode;
    const dirty = diet !== profile.dietCategoryCode;
    const failure = toFailure(save.error);
    const title = t('account:profile.yourDiet');
    const columns = atLeast('lg') ? 4 : atLeast('md') ? 3 : 2;
    const rows: string[][] = [];
    DIET_CLASSIFICATIONS.forEach((code, index) => {
        (rows[Math.floor(index / columns)] ??= []).push(code);
    });

    return (
        <View className="flex-col">
            <View className="mb-3 flex-row items-center gap-2.5">
                <RNText
                    accessibilityRole="header"
                    aria-level={3}
                    className="font-display text-lg font-bold text-content-primary text-start"
                >
                    {title}
                </RNText>
                <CountPill
                    label={t('account:profile.dietChosen', { count: diet === null ? 0 : 1 })}
                />
            </View>
            <View
                testID={`${TEST_ID}-diets`}
                // One diet: the profile stores a single classification. Choosing the chosen one again
                // clears it.
                role="radiogroup"
                accessibilityRole="radiogroup"
                aria-label={title}
                accessibilityLabel={title}
                className="mb-3.5 flex-col gap-2.5"
            >
                {rows.map((row, rowIndex) => (
                    <View key={String(rowIndex)} className="flex-row gap-2.5">
                        {Array.from({ length: columns }, (_, column) => {
                            const code = row[column];
                            if (code === undefined)
                                return <View key={column} className="min-w-0 flex-1" />;
                            const on = diet === code;
                            const off = !answered || save.isPending;
                            return (
                                <Pressable
                                    key={code}
                                    testID={`${TEST_ID}-diets-${code}`}
                                    role="radio"
                                    aria-checked={on}
                                    accessibilityState={{
                                        checked: on,
                                        selected: on,
                                        disabled: off,
                                    }}
                                    disabled={off}
                                    onPress={() => {
                                        setEdit({
                                            diet: on ? null : code,
                                            from: profile.updatedAt,
                                        });
                                    }}
                                    className={cx(
                                        'relative h-[60px] min-w-0 flex-1 flex-row items-center gap-2.5 rounded-2xl border-[1.5px] px-3 active:scale-[0.98]',
                                        on
                                            ? 'border-surface-brand bg-surface-brand-subtle'
                                            : 'border-stroke-subtle bg-surface-raised hover:border-stroke',
                                        off && !on ? 'opacity-60' : '',
                                    )}
                                >
                                    <View
                                        className={cx(
                                            'h-9 w-9 items-center justify-center rounded-xl',
                                            on ? 'bg-surface-brand' : 'bg-surface-base',
                                        )}
                                    >
                                        <Icon
                                            name="salad"
                                            size="sm"
                                            className={
                                                on
                                                    ? 'text-content-on-brand'
                                                    : 'text-content-secondary'
                                            }
                                        />
                                    </View>
                                    <RNText
                                        numberOfLines={1}
                                        className={cx(
                                            'min-w-0 flex-1 text-sm font-semibold text-start',
                                            on
                                                ? 'text-content-on-brand-subtle'
                                                : 'text-content-primary',
                                        )}
                                    >
                                        {t(`onboarding:diets.${code}`)}
                                    </RNText>
                                    {on ? (
                                        <View className="absolute end-2 top-2 h-5 w-5 items-center justify-center rounded-full bg-surface-brand">
                                            <Icon
                                                name="check"
                                                size="sm"
                                                className="text-content-on-brand"
                                            />
                                        </View>
                                    ) : null}
                                </Pressable>
                            );
                        })}
                    </View>
                ))}
            </View>

            {/*
             * The allergy declaration, as the board's amber card. Not a diet tile — an allergy is a
             * safety constraint, not a preference — but the way to the question, and while it is
             * unanswered, the reason the tiles above do not move.
             */}
            <Pressable
                testID={`${TEST_ID}-allergies-edit`}
                role="link"
                accessibilityRole="link"
                onPress={onOpenAllergies}
                className="flex-row flex-wrap items-center gap-3.5 rounded-[20px] border-[1.5px] border-warning-border bg-warning-subtle p-4 hover:shadow-elevation-2"
            >
                <View className="h-12 w-12 items-center justify-center rounded-2xl bg-surface-raised">
                    <Icon name="alert" size="md" className="text-warning-on-subtle" />
                </View>
                <View className="min-w-[180px] flex-1">
                    <RNText className="text-base font-bold text-warning-on-subtle text-start">
                        {t('account:nav.allergies')}
                    </RNText>
                    {answered && profile.allergens.length > 0 ? (
                        <View
                            testID={`${TEST_ID}-allergies`}
                            className="mt-1.5 flex-row flex-wrap gap-1.5"
                        >
                            {profile.allergens.map((entry) => (
                                <View
                                    key={entry.allergenCode}
                                    className="h-[26px] justify-center rounded-full border border-warning-border bg-surface-raised px-2.5"
                                >
                                    <RNText className="text-xs font-semibold text-warning-on-subtle">
                                        {t(`onboarding:allergens.${entry.allergenCode}`)}
                                    </RNText>
                                </View>
                            ))}
                        </View>
                    ) : (
                        <RNText
                            testID={answered ? `${TEST_ID}-allergies` : `${TEST_ID}-diets-locked`}
                            className="mt-1 text-sm text-warning-on-subtle text-start"
                        >
                            {answered
                                ? t('account:profile.allergiesNone')
                                : t('account:profile.dietsLocked')}
                        </RNText>
                    )}
                </View>
                <View className="h-10 flex-row items-center gap-1.5 rounded-xl bg-warning-on-subtle px-3.5">
                    <RNText className="text-sm font-bold text-surface-raised">
                        {answered
                            ? t('account:profile.manage')
                            : t('account:profile.answerAllergies')}
                    </RNText>
                    <Icon name="chevronForward" size="sm" className="text-surface-raised" />
                </View>
            </Pressable>

            {failure === null ? null : (
                <Callout
                    testID={`${TEST_ID}-error`}
                    role="alert"
                    tone="danger"
                    title={failure.message}
                    className="mt-3"
                />
            )}

            <View className="mt-5 flex-row flex-wrap gap-2">
                <Pressable
                    testID={`${TEST_ID}-save`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityState={{
                        disabled: !answered || !dirty || save.isPending,
                        busy: save.isPending,
                    }}
                    disabled={!answered || !dirty || save.isPending}
                    onPress={() => {
                        save.mutate(
                            {
                                dietCategoryCode: diet,
                                // Carried through, never re-derived: this pane edits the diet only.
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
                    className={cx(
                        'h-12 flex-row items-center gap-2 rounded-[14px] px-5',
                        !answered || !dirty
                            ? 'bg-stroke-subtle'
                            : 'bg-surface-brand hover:bg-surface-canopy',
                    )}
                >
                    {save.isPending ? <ActivityIndicator size="small" /> : null}
                    <RNText
                        className={cx(
                            'text-sm font-bold',
                            !answered || !dirty
                                ? 'text-content-secondary'
                                : 'text-content-on-brand',
                        )}
                    >
                        {t('account:profile.save')}
                    </RNText>
                </Pressable>
                <Pressable
                    testID={`${TEST_ID}-cancel`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !dirty || save.isPending }}
                    disabled={!dirty || save.isPending}
                    onPress={() => {
                        setEdit(null);
                    }}
                    className={cx(
                        'h-12 justify-center rounded-[14px] border border-stroke bg-surface-raised px-[18px]',
                        !dirty ? 'opacity-50' : 'hover:bg-surface-brand-subtle',
                    )}
                >
                    <RNText className="text-sm font-semibold text-content-primary">
                        {t('account:profile.cancel')}
                    </RNText>
                </Pressable>
            </View>
        </View>
    );
}

/**
 * The dietary part when there is no dietary record to edit — the customer record is missing, or the
 * read failed. The tiles' place says why, so the pane keeps its shape instead of swapping it for an
 * error box.
 */
function DietaryUnavailable() {
    const { t } = useTranslation();
    return (
        <View testID={`${TEST_ID}-dietary-unavailable`} className="flex-col">
            <RNText className="mb-2 font-display text-lg font-bold text-content-primary text-start">
                {t('account:profile.yourDiet')}
            </RNText>
            <RNText className="text-sm text-content-secondary text-start">
                {t('account:profile.dietsUnavailable')}
            </RNText>
        </View>
    );
}

function SecurityLinks() {
    const { t } = useTranslation();
    const router = useRouter();
    const canManageDevices = useCan('device.manage_own');

    return (
        <View
            testID={`${TEST_ID}-security`}
            role="group"
            aria-label={t('account:profile.securityTitle')}
        >
            <LinkRow
                testID={`${TEST_ID}-change-password`}
                icon="lock"
                label={t('account:profile.changePassword')}
                onPress={() => {
                    router.push(withReturnTo('/change-password', PROFILE_HOME) as never);
                }}
            />
            {canManageDevices ? (
                <LinkRow
                    testID={`${TEST_ID}-devices`}
                    icon="smartphone"
                    label={t('account:profile.devices')}
                    onPress={() => {
                        router.push(withReturnTo('/devices', PROFILE_HOME) as never);
                    }}
                />
            ) : null}
        </View>
    );
}

export function AccountProfilePanel({
    onOpenAllergies,
}: {
    /** "Manage" on the allergy card — the account page opens its Allergies section. */
    readonly onOpenAllergies?: (() => void) | undefined;
} = {}) {
    const { t } = useTranslation();
    const router = useRouter();
    const { atLeast } = useBreakpoint();
    const { me } = useSession();
    const contacts = useContactPointsQuery();
    const profile = useDietaryProfileQuery();
    const openAllergies =
        onOpenAllergies ??
        (() => {
            router.push('/customer/account/allergies' as never);
        });

    const phone = currentPhone(contacts.data ?? []);
    // The board's `1fr 1fr` grid; one column on a phone, where two narrow fields truncate.
    const row = atLeast('md') ? 'flex-row gap-3.5' : 'flex-col gap-3.5';

    return (
        <View testID={TEST_ID} className={`${ACCOUNT_CARD} p-6`}>
            <PanelHead testID={`${TEST_ID}-title`} title={t('account:nav.profile')} />

            <View className="flex-col gap-3.5">
                <View className={row}>
                    <Field
                        testID={`${TEST_ID}-name`}
                        label={t('account:profile.nameLabel')}
                        value={me?.profile.displayName ?? ''}
                    />
                    <Field
                        testID={`${TEST_ID}-email`}
                        label={t('account:profile.emailLabel')}
                        value={me?.user.email ?? ''}
                    />
                </View>
                <View className={row}>
                    <MobileField phone={phone} />
                    {/* The account publishes no default delivery window: it is picked per order. */}
                    <Field
                        testID={`${TEST_ID}-slot`}
                        label={t('account:profile.slotLabel')}
                        value={t('account:profile.slotUnset')}
                        muted
                    />
                </View>
            </View>

            <View className="my-[22px] h-px bg-stroke-subtle" />

            {profile.isError ? (
                <DietaryUnavailable />
            ) : (
                <QueryStates
                    skeleton="form"
                    query={profile}
                    isEmpty={false}
                    emptyTitle={t('account:dietary.title')}
                    skeletonCount={1}
                    testID={`${TEST_ID}-dietary`}
                >
                    {profile.data === undefined ? null : (
                        <DietaryPreferences
                            profile={profile.data}
                            onOpenAllergies={openAllergies}
                        />
                    )}
                </QueryStates>
            )}

            <View className="mt-[22px]">
                <SecurityLinks />
            </View>
        </View>
    );
}
