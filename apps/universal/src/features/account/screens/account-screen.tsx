import type { AccountChecklistItem, ConsentState } from '@healthy360/api-client/contracts';
import { Button, Callout, Dialog, Icon, Tabs, cx, useBreakpoint } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import {
    useAccountOverviewQuery,
    useAddressesQuery,
    useConsentsQuery,
    useDietaryProfileQuery,
    useRemoveAddressMutation,
    useSetConsentMutation,
    toFailure,
} from '../../../data/account-hooks.ts';
import { useMyOrdersQuery, useSubscriptionsQuery } from '../../../data/commerce-hooks.ts';
import { useLogoutMutation } from '../../../data/hooks.ts';
import { withReturnTo } from '../../../navigation/return-to.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { ShopSwitch } from '../../../ui/shop-switch.tsx';
import { SubpageTrail } from '../../../ui/subpage-trail.tsx';
import { SubscriptionsScreen } from '../../commerce/screens/subscriptions-screen.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { AccountSetupPanel } from '../account-setup-steps.tsx';
import { isLiveSubscription } from '../../catalogue/plan-subscription.ts';
import { ACCOUNT_CARD, LinkRow, PanelHead } from '../account-card.tsx';
import { AllergiesPanel } from '../account-allergies-panel.tsx';
import { AccountOrdersPanel } from '../account-orders-panel.tsx';
import { AccountProfilePanel } from '../account-profile-panel.tsx';
import { clearClosureDraft } from './closure-wizard-screen.tsx';

/**
 * `/customer/account` — the accepted Account board: the canopy band with the person's name, email and
 * phone and three figures (active plan, next delivery, orders), the 248px side menu card overlapping
 * its foot — each section with its icon and count, Sign out under a rule — and one pane.
 *
 * ## The design's six sections, plus Subscriptions
 *
 * Orders · Subscriptions · Favorites · Profile · Addresses · Payment methods · Notifications, in that
 * order, as the design's `sideBtn()` rows. Each panel is the design's card:
 *
 * * **Orders** — "Order history" over `GET /me/orders` (`../account-orders-panel.tsx`).
 * * **Subscriptions** — not one of the design's six. It had its own page, reached only from tiles on
 *   Discover; it sits beside the orders now, and `/customer/subscriptions` redirects here.
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
 * Wide, the side menu is a 248px sticky card beside the pane; below `lg` it becomes a tab row above
 * it, because a 248px column on a phone is a third of the screen spent on navigation.
 *
 * ## The open section is the URL's
 *
 * `?section=` names the open section, and switching writes it back with `setParams`. Every
 * `/customer/*` page is a sibling in one `<Slot/>`, so opening an address, an order or a subscription
 * unmounts this page — a section held only in `useState` came back as Orders after every Back,
 * refresh and "Back to your account". In the URL it survives all three, and the sub-pages' own
 * fallbacks (`/customer/account?section=addresses`, `?section=profile`, …) land where they came
 * from. `setParams` replaces the entry, so flicking through the tabs never fills Back with them. The
 * section also follows the URL while the page is mounted — a link to another section pressed from
 * here — adjusted during render, as the storefront's tabs are. The old `setup` and `privacy` names
 * still land somewhere sensible.
 *
 * ## Opened as a detour
 *
 * The closure wizard's "Sort this out" opens the orders or the subscriptions here with
 * `?returnTo=` the checks step. While there is one, a "Back to …" link sits above the title, and it
 * travels with every step this page opens, so the chain is not cut by a stop at an address.
 *
 * ## The address book is all here
 *
 * List, add, edit and remove. Remove used to live on a separate list page — the same list, one
 * button more — reached through "Manage addresses", with no way back from it. That page is now a
 * redirect to this section.
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
    'subscriptions',
    'favorites',
    'profile',
    'allergies',
    'addresses',
    'payments',
    'notifications',
] as const;
export type AccountSection = (typeof SECTIONS)[number];
type Section = AccountSection;

/** Section names that existed before the design's six, and where they now live. */
const LEGACY_SECTIONS: Readonly<Record<string, Section>> = {
    setup: 'orders',
    privacy: 'notifications',
};

function sectionFrom(value: string | string[] | undefined): Section | null {
    const first = Array.isArray(value) ? value[0] : value;
    if (first === undefined) return null;
    if ((SECTIONS as readonly string[]).includes(first)) return first as Section;
    return LEGACY_SECTIONS[first] ?? null;
}

/** This page, open on `section` — what a step it opens comes back to. */
export function accountSectionHref(section: Section): string {
    return `/customer/account?section=${section}`;
}

/** Optional consents whose key names a marketing channel. The rest belong to the consents screen. */
function isMarketingConsent(consent: ConsentState): boolean {
    return !consent.definition.required && consent.definition.key.startsWith('marketing_');
}

interface SectionItem {
    readonly value: Section;
    readonly label: string;
    readonly icon: AccountIcon;
    readonly count?: string | undefined;
    readonly testID: string;
}

type AccountIcon =
    'basket' | 'calendar' | 'starOutline' | 'user' | 'warning' | 'home' | 'lock' | 'info';

const SECTION_ICONS: Readonly<Record<Section, AccountIcon>> = {
    orders: 'basket',
    subscriptions: 'calendar',
    favorites: 'starOutline',
    profile: 'user',
    allergies: 'warning',
    addresses: 'home',
    payments: 'lock',
    notifications: 'info',
};

/**
 * The wide side menu: the board's card of rows, each an icon box, its name and a count, the open one
 * on the brand's soft fill; then a rule and Sign out.
 *
 * Buttons with `aria-current` rather than a vertical tablist: the narrow layout uses the design
 * system's `Tabs`, which owns the arrow-key model, and a second hand-rolled roving-focus list for one
 * breakpoint would be a keyboard model nobody tests.
 */
function SideNav({
    label,
    items,
    value,
    onChange,
    footer,
}: {
    readonly label: string;
    readonly items: readonly SectionItem[];
    readonly value: Section;
    readonly onChange: (next: Section) => void;
    readonly footer: ReactNode;
}) {
    return (
        <View
            testID="account-nav"
            aria-label={label}
            accessibilityLabel={label}
            className="w-[248px] shrink-0 flex-col rounded-3xl border border-stroke-subtle bg-surface-raised p-2.5 shadow-elevation-2 web:sticky web:top-0"
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
                            'h-12 flex-row items-center gap-3 rounded-[14px] px-3',
                            selected ? 'bg-surface-brand-subtle' : 'hover:bg-surface-base',
                        )}
                    >
                        <View
                            className={cx(
                                'h-8 w-8 items-center justify-center rounded-[10px]',
                                selected ? 'bg-surface-brand' : 'bg-surface-base',
                            )}
                        >
                            <Icon
                                name={item.icon}
                                size="sm"
                                className={
                                    selected ? 'text-content-on-brand' : 'text-content-secondary'
                                }
                            />
                        </View>
                        <RNText
                            numberOfLines={1}
                            className={cx(
                                'flex-1 text-sm font-semibold text-start',
                                selected
                                    ? 'text-content-on-brand-subtle'
                                    : 'text-content-secondary',
                            )}
                        >
                            {item.label}
                        </RNText>
                        {item.count === undefined ? null : (
                            <View
                                className={cx(
                                    'h-[22px] min-w-6 items-center justify-center rounded-full px-[7px]',
                                    selected ? 'bg-surface-raised' : 'bg-surface-base',
                                )}
                            >
                                <RNText className="text-xs font-bold tabular-nums text-content-secondary">
                                    {item.count}
                                </RNText>
                            </View>
                        )}
                    </Pressable>
                );
            })}
            <View className="mx-1.5 my-2 h-px bg-stroke-subtle" />
            {footer}
        </View>
    );
}

/**
 * Sign out — the header's account menu used to carry it; the header now opens this page instead.
 * `replace`, not `push`: Back must not return a signed-out person to their account.
 */
function SignOutButton({ row = false }: { readonly row?: boolean }) {
    const { t } = useTranslation();
    const router = useRouter();
    const logout = useLogoutMutation();
    const signOut = () => {
        logout.mutate(undefined, {
            onSuccess: () => {
                router.replace('/' as never);
            },
        });
    };

    if (!row) {
        return (
            <Button
                testID="account-sign-out"
                size="sm"
                variant="quiet"
                label={t('common:action.signOut')}
                loading={logout.isPending}
                onPress={signOut}
            />
        );
    }
    return (
        <Pressable
            testID="account-sign-out"
            role="button"
            accessibilityRole="button"
            accessibilityState={{ busy: logout.isPending }}
            disabled={logout.isPending}
            onPress={signOut}
            className="h-12 flex-row items-center gap-3 rounded-[14px] px-3 hover:bg-danger-subtle"
        >
            <View className="h-8 w-8 items-center justify-center rounded-[10px] bg-danger-subtle">
                <Icon name="signOut" size="sm" className="text-danger-on-subtle" />
            </View>
            <RNText className="flex-1 text-sm font-semibold text-danger-on-subtle text-start">
                {t('common:action.signOut')}
            </RNText>
        </Pressable>
    );
}

/**
 * The checklist, folded into one notice above the panel while a required step is outstanding.
 * Server order, preserved: re-sorting would override a sequence the server is entitled to choose.
 */
function SetupNotice({
    items,
    canActivate,
    returnTo,
}: {
    readonly items: readonly AccountChecklistItem[];
    readonly canActivate: boolean;
    /** This page as it is open now, so finishing a step comes back to the same section. */
    readonly returnTo: string;
}) {
    const { t } = useTranslation();
    const outstanding = items.filter((item) => item.required && !item.complete);
    if (canActivate && outstanding.length === 0) return null;

    return (
        // Each step says what it needs and opens the screen that does it.
        <AccountSetupPanel
            testID="account-activation"
            role="status"
            title={t('account:checklist.cannotActivate')}
            body={t('account:checklist.outstanding', { count: outstanding.length })}
            steps={outstanding.map((item) => ({
                step: item.step,
                blockedReason: item.blockedReason,
            }))}
            stepsTestID="account-step"
            returnTo={returnTo}
        />
    );
}

function FavoritesPanel() {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <View testID="account-favorites" className={`${ACCOUNT_CARD} p-6`}>
            <PanelHead title={t('account:nav.favorites')} />
            <View testID="account-favorites-empty" className="items-center gap-3 px-6 py-14">
                <View className="h-24 w-24 items-center justify-center rounded-full bg-surface-brand-subtle">
                    <Icon name="starOutline" size="lg" className="text-content-on-brand-subtle" />
                </View>
                <RNText
                    accessibilityRole="header"
                    aria-level={3}
                    className="mt-1.5 font-display text-2xl font-bold text-content-primary text-center"
                >
                    {t('account:favorites.empty')}
                </RNText>
                <Pressable
                    testID="account-favorites-browse"
                    role="button"
                    accessibilityRole="button"
                    onPress={() => {
                        router.push('/meals');
                    }}
                    className="h-12 flex-row items-center gap-2 rounded-[14px] bg-surface-brand px-5 hover:bg-surface-canopy"
                >
                    <RNText className="text-sm font-bold text-content-on-brand">
                        {t('account:orders.browse')}
                    </RNText>
                    <Icon name="chevronForward" size="sm" className="text-content-on-brand" />
                </Pressable>
            </View>
        </View>
    );
}

/**
 * The address book: a tile per address — the default ringed and tagged — with Edit, Set default and
 * Remove, and an "Add address" tile.
 *
 * The editor is opened with this section as its `?returnTo=`, so saving or cancelling lands back on
 * Addresses rather than on whatever section the page would default to.
 *
 * ## Removal asks first, and names the address
 *
 * `removeAddress` is not reversible and there is no undo behind it, so the confirmation names the
 * address rather than asking "are you sure?" about an unnamed thing — a person with a Home and an
 * Office needs to know which one the dialog is about.
 */
function AddressesPanel({ here }: { readonly here: string }) {
    const { t } = useTranslation();
    const router = useRouter();
    const { atLeast } = useBreakpoint();
    const addresses = useAddressesQuery();
    const remove = useRemoveAddressMutation();
    const items = addresses.data ?? [];
    const removeFailure = toFailure(remove.error);

    /** The address the confirmation is about. `null` closes the dialog. */
    const [pendingRemoval, setPendingRemoval] = useState<{
        readonly id: string;
        readonly label: string;
    } | null>(null);

    const openEditor = (address: string) => {
        router.push(withReturnTo(`/customer/account/addresses/${address}`, here) as never);
    };

    const addButton = (
        <Button
            testID="account-addresses-add"
            label={t('account:addresses.add')}
            onPress={() => {
                openEditor('new');
            }}
        />
    );
    const columns = atLeast('md') ? 3 : 1;
    const tiles: readonly ('add' | (typeof items)[number])[] = [...items, 'add'];
    const rows: (typeof tiles)[number][][] = [];
    tiles.forEach((tile, index) => {
        (rows[Math.floor(index / columns)] ??= []).push(tile);
    });

    return (
        <View testID="account-addresses" className={`${ACCOUNT_CARD} p-6`}>
            <PanelHead
                testID="account-addresses-title"
                title={t('account:nav.addresses')}
                {...(items.length === 0 ? {} : { count: String(items.length) })}
            />
            {removeFailure === null ? null : (
                <Callout
                    testID="account-addresses-remove-error"
                    role="alert"
                    tone="danger"
                    title={removeFailure.message}
                    className="mb-4"
                />
            )}
            <QueryStates
                query={addresses}
                isEmpty={items.length === 0}
                emptyTitle={t('account:addresses.empty')}
                emptyBody={t('account:addresses.emptyBody')}
                emptyActions={addButton}
                skeletonCount={2}
                testID="account-addresses-states"
            >
                <View className="flex-col gap-3.5">
                    {rows.map((row, rowIndex) => (
                        <View key={String(rowIndex)} className="flex-row gap-3.5">
                            {Array.from({ length: columns }, (_, column) => {
                                const tile = row[column];
                                if (tile === undefined) {
                                    return (
                                        <View key={column} className="min-w-0 flex-1 p-[18px]" />
                                    );
                                }
                                if (tile === 'add') {
                                    return (
                                        <Pressable
                                            key="add"
                                            testID="account-addresses-add-tile"
                                            role="button"
                                            accessibilityRole="button"
                                            onPress={() => {
                                                openEditor('new');
                                            }}
                                            className="group min-h-[200px] min-w-0 flex-1 items-center justify-center gap-2 rounded-[22px] border-2 border-dashed border-stroke p-[18px] hover:border-surface-brand"
                                        >
                                            <Icon
                                                name="plus"
                                                size="md"
                                                className="text-content-secondary group-hover:text-content-brand"
                                            />
                                            <RNText className="text-sm font-semibold text-content-secondary group-hover:text-content-brand">
                                                {t('account:addresses.add')}
                                            </RNText>
                                        </Pressable>
                                    );
                                }
                                const address = tile;
                                return (
                                    <View
                                        key={address.id}
                                        testID={`account-address-${address.id}`}
                                        className={cx(
                                            'relative min-w-0 flex-1 flex-col gap-1.5 rounded-[22px] border-2 p-[18px]',
                                            address.isDefault
                                                ? 'border-surface-brand bg-surface-brand-subtle'
                                                : 'border-stroke-subtle bg-surface-raised',
                                        )}
                                    >
                                        {address.isDefault ? (
                                            <View className="absolute end-4 top-4 h-6 justify-center rounded-full bg-surface-brand px-[9px]">
                                                <RNText className="text-xs font-bold text-content-on-brand">
                                                    {t('account:addresses.default')}
                                                </RNText>
                                            </View>
                                        ) : null}
                                        <View
                                            className={cx(
                                                'mb-1.5 h-11 w-11 items-center justify-center rounded-[14px]',
                                                address.isDefault
                                                    ? 'bg-surface-brand'
                                                    : 'bg-surface-base',
                                            )}
                                        >
                                            <Icon
                                                name="home"
                                                size="md"
                                                className={
                                                    address.isDefault
                                                        ? 'text-content-on-brand'
                                                        : 'text-content-primary'
                                                }
                                            />
                                        </View>
                                        <RNText className="font-display text-lg font-bold text-content-primary text-start">
                                            {address.label}
                                        </RNText>
                                        <RNText className="text-sm text-content-primary text-start">
                                            {address.areaName}
                                        </RNText>
                                        <RNText className="text-sm text-content-secondary text-start">
                                            {[
                                                address.line1,
                                                address.line2,
                                                address.building,
                                                address.floor,
                                            ]
                                                .filter(
                                                    (part): part is string =>
                                                        part !== null && part.trim().length > 0,
                                                )
                                                .join(t('account:addresses.partSeparator'))}
                                        </RNText>
                                        <View className="mt-2.5 flex-row flex-wrap gap-1.5">
                                            <TileButton
                                                testID={`account-address-${address.id}-edit`}
                                                label={t('account:addresses.edit')}
                                                onPress={() => {
                                                    openEditor(address.id);
                                                }}
                                            />
                                            <TileButton
                                                testID={`account-address-${address.id}-remove`}
                                                label={t('account:addresses.remove')}
                                                onPress={() => {
                                                    setPendingRemoval({
                                                        id: address.id,
                                                        label: address.label,
                                                    });
                                                }}
                                            />
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    ))}
                </View>
            </QueryStates>

            <Dialog
                testID="account-addresses-remove-dialog"
                open={pendingRemoval !== null}
                title={t('account:addresses.removeTitle')}
                description={t('account:addresses.removeBody', {
                    label: pendingRemoval?.label ?? '',
                })}
                onClose={() => {
                    setPendingRemoval(null);
                }}
                actions={
                    <View className="flex-row flex-wrap gap-2.5">
                        <Button
                            testID="account-addresses-remove-cancel"
                            variant="quiet"
                            label={t('common:action.cancel')}
                            onPress={() => {
                                setPendingRemoval(null);
                            }}
                        />
                        <Button
                            testID="account-addresses-remove-confirm"
                            // Destructive, so `danger`: the dialog's other option is "keep my
                            // address", and a destructive action must not wear the primary fill.
                            variant="danger"
                            label={t('account:addresses.remove')}
                            loading={remove.isPending}
                            onPress={() => {
                                if (pendingRemoval === null) return;
                                remove.mutate(pendingRemoval.id, {
                                    onSuccess: () => {
                                        setPendingRemoval(null);
                                    },
                                });
                            }}
                        />
                    </View>
                }
            />
        </View>
    );
}

function TileButton({
    testID,
    label,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            onPress={onPress}
            className="h-9 justify-center rounded-[10px] border border-stroke bg-surface-raised px-3 hover:bg-surface-brand-subtle"
        >
            <RNText className="text-xs font-semibold text-content-primary">{label}</RNText>
        </Pressable>
    );
}

/** Payment — what is true: cash on delivery, and cash at the counter for pickup. No card is stored. */
function PaymentsPanel() {
    const { t } = useTranslation();

    return (
        <View testID="account-payments" className={`${ACCOUNT_CARD} p-6`}>
            <PanelHead testID="account-payments-title" title={t('account:nav.payments')} />
            <View className="flex-row items-center gap-3.5 rounded-[20px] border-2 border-surface-brand bg-surface-brand-subtle p-4">
                <View className="h-12 w-12 items-center justify-center rounded-2xl bg-surface-raised">
                    <Icon name="basket" size="md" className="text-content-brand" />
                </View>
                <View className="min-w-0 flex-1">
                    <RNText
                        testID="account-payments-cash"
                        className="text-base font-bold text-content-primary text-start"
                    >
                        {t('account:payments.cash')}
                    </RNText>
                    <RNText className="text-sm text-content-secondary text-start">
                        {t('account:payments.cashSub')}
                    </RNText>
                </View>
                <View className="h-[26px] justify-center rounded-full bg-surface-raised px-2.5">
                    <RNText className="text-xs font-bold text-content-primary">
                        {t('account:addresses.default')}
                    </RNText>
                </View>
            </View>
            <View className="mt-2.5 flex-row items-center gap-3.5 rounded-[20px] border-2 border-stroke-subtle p-4">
                <View className="h-12 w-12 items-center justify-center rounded-2xl bg-surface-base">
                    <Icon name="home" size="md" className="text-content-brand" />
                </View>
                <View className="min-w-0 flex-1">
                    <RNText className="text-base font-bold text-content-primary text-start">
                        {t('account:payments.counter')}
                    </RNText>
                    <RNText className="text-sm text-content-secondary text-start">
                        {t('account:payments.counterSub')}
                    </RNText>
                </View>
            </View>
        </View>
    );
}

/** Notifications — the marketing switches, then the privacy record and closing the account. */
function NotificationsPanel() {
    const { t } = useTranslation();
    const router = useRouter();
    const consents = useConsentsQuery();
    const setConsent = useSetConsentMutation();
    const marketing = (consents.data ?? []).filter(isMarketingConsent);
    const setConsentFailure = toFailure(setConsent.error);

    return (
        <View testID="account-marketing" className={`${ACCOUNT_CARD} p-6`}>
            <PanelHead testID="account-marketing-title" title={t('account:nav.notifications')} />

            {setConsentFailure === null ? null : (
                <Callout
                    testID="account-marketing-error"
                    role="alert"
                    tone="danger"
                    title={t('account:marketing.saveFailed')}
                    className="mb-3"
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
                marketing.map((consent, index) => (
                    <View
                        key={consent.definition.key}
                        className={cx(
                            'flex-row items-center gap-3.5 px-1 py-3.5',
                            index === 0 ? '' : 'border-t border-stroke-subtle',
                        )}
                    >
                        <View className="min-w-0 flex-1">
                            <RNText className="text-base font-bold text-content-primary text-start">
                                {consent.definition.title}
                            </RNText>
                            <RNText className="mt-0.5 text-sm text-content-secondary text-start">
                                {consent.definition.text}
                            </RNText>
                        </View>
                        <ShopSwitch
                            testID={`account-marketing-${consent.definition.key}`}
                            label={consent.definition.title}
                            checked={consent.granted}
                            disabled={setConsent.isPending}
                            onChange={(granted) => {
                                setConsent.mutate({ key: consent.definition.key, granted });
                            }}
                        />
                    </View>
                ))
            )}

            <View testID="account-privacy" className="mt-[22px]">
                <LinkRow
                    testID="account-privacy-consents"
                    icon="info"
                    label={t('account:privacy.reviewConsents')}
                    onPress={() => {
                        router.push('/customer/account/consents' as never);
                    }}
                />
                <LinkRow
                    testID="account-privacy-close"
                    icon="close"
                    tone="danger"
                    label={t('account:privacy.closeAccount')}
                    onPress={() => {
                        // A fresh start: whatever an abandoned attempt left in the tab is not this
                        // person's answer today.
                        clearClosureDraft();
                        router.push('/customer/account/close/reason' as never);
                    }}
                />
            </View>
        </View>
    );
}

/**
 * The board's band: the person's initials, name, email and phone on the canopy, and three figures —
 * the active plan, the next delivery and the orders so far.
 */
function AccountBand({
    name,
    email,
    phone,
    plan,
    nextDelivery,
    orders,
}: {
    readonly name: string;
    readonly email: string | null;
    readonly phone: string | null;
    readonly plan: string | null;
    readonly nextDelivery: string | null;
    readonly orders: string | null;
}) {
    const { t } = useTranslation();
    const initials = name
        .split(/\s+/)
        .filter((part) => part !== '')
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('');
    const dash = '—';
    const stats = [
        { key: 'plan', label: t('account:band.activePlan'), value: plan ?? dash },
        { key: 'next', label: t('account:band.nextDelivery'), value: nextDelivery ?? dash },
        { key: 'orders', label: t('account:band.orders'), value: orders ?? dash },
    ];

    return (
        <View
            testID="account-band"
            className="relative mt-1 overflow-hidden rounded-[30px] bg-surface-canopy px-6 pb-[96px] pt-[30px] lg:px-8"
        >
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute -end-[120px] -top-[170px] h-[480px] w-[480px] rounded-full bg-stage-green opacity-15"
            />
            <View className="z-10 flex-row flex-wrap items-center gap-5">
                <View
                    aria-hidden
                    className="h-[72px] w-[72px] items-center justify-center rounded-full bg-surface-brand-subtle"
                >
                    <RNText className="font-display text-2xl font-bold text-content-on-brand-subtle">
                        {initials === '' ? '·' : initials}
                    </RNText>
                </View>
                <View className="min-w-[200px] flex-1">
                    <RNText
                        testID="account-title"
                        accessibilityRole="header"
                        aria-level={1}
                        className="font-display text-3xl font-bold tracking-display text-content-on-canopy text-start"
                    >
                        {name}
                    </RNText>
                    <RNText className="mt-1 text-sm text-content-on-canopy-muted text-start">
                        {[email, phone].filter((part): part is string => part !== null).join(' · ')}
                    </RNText>
                </View>
                <View className="flex-row flex-wrap gap-2.5">
                    {stats.map((stat) => (
                        <View
                            key={stat.key}
                            testID={`account-band-${stat.key}`}
                            className="min-w-[140px] rounded-2xl bg-content-on-canopy/10 px-4 py-3"
                        >
                            <RNText className="text-xs font-semibold text-content-on-canopy-muted text-start">
                                {stat.label}
                            </RNText>
                            <RNText
                                numberOfLines={1}
                                className="mt-0.5 text-base font-bold text-content-on-canopy text-start"
                            >
                                {stat.value}
                            </RNText>
                        </View>
                    ))}
                </View>
            </View>
        </View>
    );
}

export interface AccountScreenProps {
    /** The route's `?returnTo=` — set when another flow opened a section as a detour. */
    readonly returnTo?: string | undefined;
    /**
     * A page of the account drawn inside it — the address editor — so the band and the side menu
     * stay where they are, as the board keeps them. `section` is the menu item it belongs under;
     * choosing another item leaves for that section of the account page.
     */
    readonly section?: AccountSection | undefined;
    readonly children?: ReactNode;
}

export function AccountScreen({ returnTo, section: within, children }: AccountScreenProps) {
    const { t } = useTranslation();
    // The name and email are the session's as soon as it answers; the customer record may lag.
    const { me } = useSession();
    const router = useRouter();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();
    const wide = atLeast('lg');
    const overview = useAccountOverviewQuery();
    const addresses = useAddressesQuery();
    const subscriptions = useSubscriptionsQuery();
    const orders = useMyOrdersQuery({ limit: 20 });
    const dietary = useDietaryProfileQuery();
    const params = useLocalSearchParams<{ section?: string }>();
    const back = useReturnTo(returnTo, '/customer/account');

    // The URL's section, followed during render (not in an effect) so a link to another section
    // pressed while this page is open never paints a frame of the old one.
    const requested: Section = within ?? sectionFrom(params.section) ?? 'orders';
    const [section, setSection] = useState<Section>(requested);
    const [followed, setFollowed] = useState<Section>(requested);
    if (followed !== requested) {
        setFollowed(requested);
        setSection(requested);
    }
    const openSection = (next: Section) => {
        if (children !== undefined) {
            // A page drawn inside the account: the menu leaves it for that section, popping back
            // to the account page when it is underneath rather than stacking another.
            router.dismissTo(accountSectionHref(next) as never);
            return;
        }
        setSection(next);
        router.setParams({ section: next });
    };
    /** This page as it is open now, carrying its own return on to whatever it opens. */
    const here = back.carry(accountSectionHref(section));

    const checklist = overview.data?.checklist ?? null;
    const liveSubscriptions = (subscriptions.data?.items ?? []).filter(isLiveSubscription);
    const loadedOrders = (orders.data?.pages ?? []).flatMap((page) => page.items);
    const orderCount =
        orders.data === undefined
            ? undefined
            : `${formatter.formatNumber(loadedOrders.length)}${orders.hasNextPage ? '+' : ''}`;
    const counts: Partial<Record<Section, string>> = {
        ...(orderCount === undefined ? {} : { orders: orderCount }),
        ...(subscriptions.data === undefined
            ? {}
            : { subscriptions: formatter.formatNumber(liveSubscriptions.length) }),
        ...(addresses.data === undefined
            ? {}
            : { addresses: formatter.formatNumber(addresses.data.length) }),
        ...(dietary.data === undefined || dietary.data.allergens.length === 0
            ? {}
            : { allergies: formatter.formatNumber(dietary.data.allergens.length) }),
    };
    const items: readonly SectionItem[] = SECTIONS.map((value) => ({
        value,
        label: t(`account:nav.${value}`),
        icon: SECTION_ICONS[value],
        count: counts[value],
        testID: `account-tab-${value}`,
    }));
    const navLabel = t('account:nav.label');

    const account = overview.data?.account;
    const phone =
        overview.data?.contacts.find((contact) => contact.kind === 'phone' && contact.isPrimary)
            ?.value ??
        overview.data?.contacts.find((contact) => contact.kind === 'phone')?.value ??
        null;
    const nextSubscription = liveSubscriptions
        .filter((subscription) => subscription.nextDeliveryDate !== null)
        .sort((a, b) => ((a.nextDeliveryDate ?? '') < (b.nextDeliveryDate ?? '') ? -1 : 1))[0];

    const panel = (
        <View testID="account-panel" className="z-auto min-w-0 flex-1 flex-col gap-4">
            {children}
            {children !== undefined || checklist === null ? null : (
                <SetupNotice
                    items={checklist.items}
                    canActivate={checklist.canActivate}
                    returnTo={here}
                />
            )}

            {children !== undefined ? null : (
                <>
                    {section === 'orders' ? <AccountOrdersPanel /> : null}
                    {section === 'subscriptions' ? <SubscriptionsScreen embedded /> : null}
                    {section === 'favorites' ? <FavoritesPanel /> : null}
                    {/* Not gated on the overview: the card's details come from the session. */}
                    {section === 'profile' ? (
                        <AccountProfilePanel
                            onOpenAllergies={() => {
                                openSection('allergies');
                            }}
                        />
                    ) : null}
                    {section === 'allergies' ? <AllergiesPanel testID="account-allergies" /> : null}
                    {section === 'addresses' ? <AddressesPanel here={here} /> : null}
                    {section === 'payments' ? <PaymentsPanel /> : null}
                    {section === 'notifications' ? <NotificationsPanel /> : null}
                </>
            )}
        </View>
    );

    return (
        <View testID="account-screen" className="w-full flex-col pb-10">
            {back.returnTo === null ? null : (
                <View className="mb-3">
                    <SubpageTrail
                        back={back}
                        current={t('account:title')}
                        testID="account-return"
                    />
                </View>
            )}
            <AccountBand
                name={account?.displayName ?? me?.profile.displayName ?? t('account:title')}
                email={account?.loginEmail ?? me?.user.email ?? null}
                phone={phone}
                plan={liveSubscriptions[0]?.planName ?? null}
                nextDelivery={
                    nextSubscription?.nextDeliveryDate === undefined ||
                    nextSubscription.nextDeliveryDate === null
                        ? null
                        : formatter.formatDate(`${nextSubscription.nextDeliveryDate}T12:00:00Z`, {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                          })
                }
                orders={orderCount ?? null}
            />

            {wide ? (
                <View className="z-10 -mt-[58px] flex-row items-start gap-6 px-3 lg:px-6">
                    <SideNav
                        label={navLabel}
                        items={items}
                        value={section}
                        onChange={openSection}
                        footer={<SignOutButton row />}
                    />
                    {panel}
                </View>
            ) : (
                <View className="z-10 -mt-[58px] flex-col gap-4 px-3">
                    <View className="rounded-3xl border border-stroke-subtle bg-surface-raised p-2 shadow-elevation-2">
                        <Tabs
                            testID="account-nav"
                            label={navLabel}
                            items={items.map((item) => ({
                                value: item.value,
                                label: item.label,
                                testID: item.testID,
                            }))}
                            value={section}
                            onChange={openSection}
                        />
                    </View>
                    {panel}
                    <View className="items-start border-t border-stroke-subtle pt-4">
                        <SignOutButton />
                    </View>
                </View>
            )}
        </View>
    );
}
