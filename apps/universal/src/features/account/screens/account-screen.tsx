import type { AccountChecklistItem, ConsentState } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Checkbox,
    EmptyState,
    Icon,
    Tabs,
    cx,
    useBreakpoint,
} from '@healthy360/design-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import {
    useAccountOverviewQuery,
    useAddressesQuery,
    useConsentsQuery,
    useSetConsentMutation,
    toFailure,
} from '../../../data/account-hooks.ts';
import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { AccountSetupSteps } from '../account-setup-steps.tsx';
import { ACCOUNT_CARD, PanelTitle } from '../account-card.tsx';
import { AccountOrdersPanel } from '../account-orders-panel.tsx';
import { AccountProfilePanel } from '../account-profile-panel.tsx';

/**
 * `/customer/account` — the HealthZone `account` screen: "Your account", a 220px side nav, one
 * panel.
 *
 * ## The six sections are the design's six
 *
 * Orders · Favorites · Profile · Addresses · Payment methods · Notifications, in that order, as the
 * design's `sideBtn()` rows. Each panel is the design's card:
 *
 * * **Orders** — "Order history" over `GET /me/orders` (`../account-orders-panel.tsx`).
 * * **Favorites** — there is no favourites capability anywhere in the product, so the design's grid
 *   holds its honest empty state and the way to the menu.
 * * **Profile** — "Profile & preferences" (`../account-profile-panel.tsx`).
 * * **Addresses** — the address book in the same card, its actions where the profile's Save and
 *   Cancel sit.
 * * **Payment methods** — one-off orders are cash on delivery and no card is ever stored, so the
 *   card states exactly that.
 * * **Notifications** — the marketing switches, and under a hairline the privacy record: the
 *   permissions screen and the closure wizard, which had no other way in.
 *
 * ## Account setup is a notice, not a section
 *
 * The server's activation checklist is the one thing this page carries that the design does not
 * draw. While a required step is outstanding it sits above the panel as one compact notice — the
 * evaluator's verdict, the count, and a button per outstanding required step — and when nothing is
 * outstanding it is gone. Optional steps are not in it: each has a home in a section (the mobile
 * field, the address book, the allergy line, the permissions link).
 *
 * Every fact in it is the server's: the order of the steps, whether each one is complete, whether
 * it is `required` **in this environment**, and — separately from all of that — `canActivate`.
 * Phone verification is configurable and switched off in production until a real SMS provider
 * exists (gate A-011), so a client carrying a hard-coded "phone, then address, then consents" rule
 * would ask for a step the server does not want. `canActivate` is read, never derived from the items.
 *
 * ## Layout
 *
 * Wide, the side nav is a 220px sticky column beside the panel; below `lg` it becomes a tab row
 * above it, because a 220px column on a phone is a third of the screen spent on navigation.
 * `?section=` opens a named section, which is how the order page's "back to your orders" returns to
 * the history; the old `setup` and `privacy` names still land somewhere sensible.
 *
 * ## Marketing lives here rather than on the consents screen
 *
 * The consents screen is a compliance surface: full text, versions, a blocking age confirmation.
 * Marketing preferences are a *setting* — the thing a person comes looking for when an email
 * annoyed them — and burying them under three paragraphs of terms is how an unsubscribe becomes
 * hard to find. Both surfaces write the same `setConsent`, so there is one record either way.
 */

const SECTIONS = [
    'orders',
    'favorites',
    'profile',
    'addresses',
    'payments',
    'notifications',
] as const;
type Section = (typeof SECTIONS)[number];

/** Section names that existed before the design's six, and where they now live. */
const LEGACY_SECTIONS: Readonly<Record<string, Section>> = {
    setup: 'orders',
    privacy: 'notifications',
};

function sectionFrom(value: string | undefined): Section | null {
    if (value === undefined) return null;
    if ((SECTIONS as readonly string[]).includes(value)) return value as Section;
    return LEGACY_SECTIONS[value] ?? null;
}

/** Optional consents whose key names a marketing channel. The rest belong to the consents screen. */
function isMarketingConsent(consent: ConsentState): boolean {
    return !consent.definition.required && consent.definition.key.startsWith('marketing_');
}

interface SectionItem {
    readonly value: Section;
    readonly label: string;
    readonly testID: string;
}

/**
 * The wide side nav: the design's `sideBtn()` rows, the open one raised onto a card.
 *
 * Buttons with `aria-current` rather than a vertical tablist: the narrow layout uses the design
 * system's `Tabs`, which owns the arrow-key model, and a second hand-rolled roving-focus list for
 * one breakpoint would be a keyboard model nobody tests.
 */
function SideNav({
    label,
    items,
    value,
    onChange,
}: {
    readonly label: string;
    readonly items: readonly SectionItem[];
    readonly value: Section;
    readonly onChange: (next: Section) => void;
}) {
    return (
        <View
            testID="account-nav"
            aria-label={label}
            accessibilityLabel={label}
            className="w-[220px] shrink-0 flex-col gap-0.5 web:sticky web:top-0"
        >
            {items.map((item) => {
                const selected = item.value === value;
                return (
                    <Pressable
                        key={item.value}
                        testID={item.testID}
                        role="button"
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        aria-current={selected ? 'page' : undefined}
                        onPress={() => {
                            onChange(item.value);
                        }}
                        className={cx(
                            'min-h-touch flex-row items-center rounded border px-3 py-2.5',
                            selected
                                ? 'border-stroke bg-surface-raised'
                                : 'border-transparent hover:bg-surface-raised',
                        )}
                    >
                        <RNText
                            numberOfLines={1}
                            className={cx(
                                'flex-1 text-sm font-medium text-start',
                                selected ? 'text-content-primary' : 'text-content-secondary',
                            )}
                        >
                            {item.label}
                        </RNText>
                    </Pressable>
                );
            })}
        </View>
    );
}

/**
 * The checklist, folded into one notice above the panel while a required step is outstanding.
 * Server order, preserved: re-sorting would override a sequence the server is entitled to choose.
 */
function SetupNotice({
    items,
    canActivate,
}: {
    readonly items: readonly AccountChecklistItem[];
    readonly canActivate: boolean;
}) {
    const { t } = useTranslation();
    const outstanding = items.filter((item) => item.required && !item.complete);
    if (canActivate && outstanding.length === 0) return null;

    return (
        <Callout
            testID="account-activation"
            role="status"
            tone="warning"
            title={t('account:checklist.cannotActivate')}
            body={t('account:checklist.outstanding', { count: outstanding.length })}
        >
            {/* Each step says what it needs and opens the screen that does it. */}
            <AccountSetupSteps
                testID="account-step"
                steps={outstanding.map((item) => ({
                    step: item.step,
                    blockedReason: item.blockedReason,
                }))}
            />
        </Callout>
    );
}

function FavoritesPanel() {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <View testID="account-favorites" className={`${ACCOUNT_CARD} p-6`}>
            <EmptyState
                testID="account-favorites-empty"
                icon="starOutline"
                title={t('account:favorites.empty')}
                body={t('account:favorites.emptyBody')}
                actions={
                    <Button
                        testID="account-favorites-browse"
                        label={t('account:orders.browse')}
                        onPress={() => {
                            router.push('/meals');
                        }}
                    />
                }
            />
        </View>
    );
}

function AddressesPanel() {
    const { t } = useTranslation();
    const router = useRouter();
    const addresses = useAddressesQuery();
    const items = addresses.data ?? [];

    const addButton = (
        <Button
            testID="account-addresses-add"
            label={t('account:addresses.add')}
            onPress={() => {
                router.push('/customer/account/addresses/new' as never);
            }}
        />
    );

    return (
        <View testID="account-addresses" className={`${ACCOUNT_CARD} p-6`}>
            <PanelTitle testID="account-addresses-title">{t('account:nav.addresses')}</PanelTitle>
            <View className="mt-4">
                <QueryStates
                    query={addresses}
                    isEmpty={items.length === 0}
                    emptyTitle={t('account:addresses.empty')}
                    emptyBody={t('account:addresses.emptyBody')}
                    emptyActions={addButton}
                    skeletonCount={2}
                    testID="account-addresses-states"
                >
                    <View className="flex-col gap-3">
                        {items.map((address) => (
                            <View
                                key={address.id}
                                testID={`account-address-${address.id}`}
                                className="min-h-touch flex-row flex-wrap items-center gap-3 rounded border border-stroke-strong px-3 py-2.5"
                            >
                                <View className="min-w-[200px] flex-1 flex-col gap-0.5">
                                    <View className="flex-row flex-wrap items-center gap-2">
                                        <RNText className="text-base font-semibold text-content-primary text-start">
                                            {address.label}
                                        </RNText>
                                        {address.isDefault ? (
                                            <Badge
                                                tone="success"
                                                label={t('account:addresses.default')}
                                            />
                                        ) : null}
                                    </View>
                                    <RNText className="text-sm text-content-secondary text-start">
                                        {[
                                            address.line1,
                                            address.line2,
                                            address.building,
                                            address.floor,
                                            address.areaName,
                                        ]
                                            .filter(
                                                (part): part is string =>
                                                    part !== null && part.trim().length > 0,
                                            )
                                            .join(t('account:addresses.partSeparator'))}
                                    </RNText>
                                </View>
                                <Button
                                    testID={`account-address-${address.id}-edit`}
                                    size="sm"
                                    variant="quiet"
                                    label={t('account:addresses.edit')}
                                    onPress={() => {
                                        router.push(
                                            `/customer/account/addresses/${address.id}` as never,
                                        );
                                    }}
                                />
                            </View>
                        ))}
                    </View>
                    <View className="mt-6 flex-row flex-wrap gap-2.5">
                        {addButton}
                        <Button
                            testID="account-addresses-manage"
                            variant="quiet"
                            label={t('account:profile.manageAddresses')}
                            onPress={() => {
                                router.push('/customer/account/addresses' as never);
                            }}
                        />
                    </View>
                </QueryStates>
            </View>
        </View>
    );
}

function PaymentsPanel() {
    const { t } = useTranslation();

    return (
        <View testID="account-payments" className={`${ACCOUNT_CARD} p-6`}>
            <PanelTitle testID="account-payments-title">{t('account:nav.payments')}</PanelTitle>
            <View className="mt-4 min-h-touch flex-row items-center gap-3 rounded border border-stroke-strong px-3 py-2.5">
                <Icon name="banknote" size="md" className="text-content-secondary" />
                <RNText
                    testID="account-payments-cash"
                    className="flex-1 text-base font-semibold text-content-primary text-start"
                >
                    {t('account:payments.cash')}
                </RNText>
                <Badge tone="success" label={t('account:addresses.default')} />
            </View>
            <RNText className="mt-3 text-sm text-content-secondary text-start">
                {t('account:payments.body')}
            </RNText>
        </View>
    );
}

function NotificationsPanel() {
    const { t } = useTranslation();
    const router = useRouter();
    const consents = useConsentsQuery();
    const setConsent = useSetConsentMutation();
    const marketing = (consents.data ?? []).filter(isMarketingConsent);
    const setConsentFailure = toFailure(setConsent.error);

    return (
        <View testID="account-marketing" className={`${ACCOUNT_CARD} p-6`}>
            <PanelTitle testID="account-marketing-title">
                {t('account:nav.notifications')}
            </PanelTitle>

            <View className="mt-4 flex-col gap-3">
                <Eyebrow>{t('account:marketing.title')}</Eyebrow>
                {setConsentFailure === null ? null : (
                    <Callout
                        testID="account-marketing-error"
                        role="alert"
                        tone="danger"
                        title={t('account:marketing.saveFailed')}
                    />
                )}
                {consents.isPending ? (
                    <RNText
                        testID="account-marketing-loading"
                        className="text-sm text-content-secondary text-start"
                    >
                        {t('common:state.loading')}
                    </RNText>
                ) : (
                    marketing.map((consent) => (
                        <Checkbox
                            key={consent.definition.key}
                            testID={`account-marketing-${consent.definition.key}`}
                            label={consent.definition.title}
                            description={consent.definition.text}
                            checked={consent.granted}
                            disabled={setConsent.isPending}
                            onChange={(granted) => {
                                setConsent.mutate({ key: consent.definition.key, granted });
                            }}
                        />
                    ))
                )}
            </View>

            <View
                testID="account-privacy"
                className="mt-5 flex-col gap-3 border-t border-stroke-subtle pt-5"
            >
                <Eyebrow>{t('account:privacy.title')}</Eyebrow>
                <View className="flex-row flex-wrap gap-2.5">
                    <Button
                        testID="account-privacy-consents"
                        variant="secondary"
                        label={t('account:privacy.reviewConsents')}
                        onPress={() => {
                            router.push('/customer/account/consents' as never);
                        }}
                    />
                    <Button
                        testID="account-privacy-close"
                        variant="quiet"
                        label={t('account:privacy.closeAccount')}
                        onPress={() => {
                            router.push('/customer/account/close/reason' as never);
                        }}
                    />
                </View>
            </View>
        </View>
    );
}

export function AccountScreen() {
    const { t } = useTranslation();
    const { atLeast } = useBreakpoint();
    const wide = atLeast('lg');
    const overview = useAccountOverviewQuery();
    const params = useLocalSearchParams<{ section?: string }>();
    const [section, setSection] = useState<Section>(sectionFrom(params.section) ?? 'orders');

    const checklist = overview.data?.checklist ?? null;
    const items: readonly SectionItem[] = SECTIONS.map((value) => ({
        value,
        label: t(`account:nav.${value}`),
        testID: `account-tab-${value}`,
    }));
    const navLabel = t('account:nav.label');

    const panel = (
        <View testID="account-panel" className="z-auto min-w-0 flex-1 flex-col gap-4">
            {checklist === null ? null : (
                <SetupNotice items={checklist.items} canActivate={checklist.canActivate} />
            )}

            {section === 'orders' ? <AccountOrdersPanel /> : null}
            {section === 'favorites' ? <FavoritesPanel /> : null}
            {/* Not gated on the overview: the card's details come from the session. */}
            {section === 'profile' ? <AccountProfilePanel /> : null}
            {section === 'addresses' ? <AddressesPanel /> : null}
            {section === 'payments' ? <PaymentsPanel /> : null}
            {section === 'notifications' ? <NotificationsPanel /> : null}
        </View>
    );

    return (
        // The design's measure: an 1100px section less its 28px gutters, centred in the shell.
        <View testID="account-screen" className="w-full max-w-[1044px] flex-col self-center">
            <RNText
                testID="account-title"
                accessibilityRole="header"
                aria-level={1}
                // `text-4xl` (36px), the nearest step to the design's 38.
                className="mb-5 font-display text-4xl font-bold leading-[1.05] tracking-display text-content-primary text-start"
            >
                {t('account:title')}
            </RNText>

            {wide ? (
                <View className="z-auto flex-row items-start gap-6">
                    <SideNav label={navLabel} items={items} value={section} onChange={setSection} />
                    {panel}
                </View>
            ) : (
                <View className="z-auto flex-col gap-4">
                    <Tabs
                        testID="account-nav"
                        label={navLabel}
                        items={items.map((item) => ({
                            value: item.value,
                            label: item.label,
                            testID: item.testID,
                        }))}
                        value={section}
                        onChange={setSection}
                    />
                    {panel}
                </View>
            )}
        </View>
    );
}
