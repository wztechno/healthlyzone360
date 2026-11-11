import {
    Button,
    Cascade,
    EmptyState,
    FadeIn,
    Icon,
    cx,
    useBreakpoint,
    useMotion,
} from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Platform, Pressable, Text as RNText, View } from 'react-native';

import { useCan } from '../access/gate.tsx';
import { useSetContextMutation } from '../data/hooks.ts';
import { useDriverJobsQuery } from '../data/driver-jobs-hooks.ts';
import { useKitchenDisplayQuery } from '../data/kitchen-orders-hooks.ts';
import {
    ORDER_PREPARE_PERMISSION,
    ORDER_VIEW_PERMISSION,
} from '../features/kitchen-admin/entity-registry.ts';
import { isShopViewOnly } from '../features/marketplace/shop-view-only.tsx';
import { readLastArea, rememberLastArea } from '../navigation/last-area.ts';
import {
    AREA_ICONS,
    availableWorkspaceAreas,
    permittedNavigation,
    workspaceAreaLabelKey,
} from '../navigation/items.ts';
import { useAccessState, useSession } from '../session/session-provider.tsx';
import { shopperHome } from './forbidden-screen.tsx';

/**
 * Workspace selector.
 *
 * The list is produced by running each area through **the same kernel the route layouts use**, so
 * an entry appears only when its gate would actually open. That is why nothing is greyed out here:
 * a destination that refuses on arrival is a worse experience than one that was never offered, and
 * the kernel already knows the difference.
 *
 * ## A greeting, then one row of tiles at a size that does not move
 *
 * The page opens on the person's name with the part of the day, today's date and the time, the
 * organisation, branch and role as chips, and the way back into the area they last opened. The
 * choice sits under it. The organisation and branch are changed from the top bar
 * (`WorkspaceOrgSwitcher`), beside what they switch.
 *
 * How many areas a person's role grants is a property of their role, and it must not change what a
 * tile *is*: the tiles keep their size and the row centres itself.
 *
 * ## What a tile says
 *
 * Each tile carries what is waiting there, read from the screens' own queries, and only when the
 * person may read them. An area with nothing to read shows its name alone rather than a guess.
 */

/**
 * Sizes as style objects, not Tailwind classes, and the reason is not preference.
 *
 * `w-[240px]`-style arbitrary values only exist in the stylesheet if Tailwind saw them when it last
 * scanned the source. A *newly written* arbitrary value is therefore silently dropped by a Metro
 * process still serving its cached CSS — the class is on the element and means nothing — which is
 * exactly how these tiles came to size themselves to their labels instead of to the number written
 * here. A plain style object is applied by the layout engine itself, so it cannot be cache-dropped
 * and needs no rebuild to take effect.
 *
 * `PAGE_WIDTH` is the board's, and holds five tiles and four 16px gutters on a row. On a phone the
 * tiles run two to a row.
 */
const PAGE_WIDTH = 1232;
const TILE_WIDTH = 232;
const TILE_HEIGHT = 168;

const MINUTE_MS = 60_000;

type PartOfDay = 'morning' | 'afternoon' | 'evening';

const GREETING_KEY = {
    morning: 'access:workspaceSelector.greeting.morning',
    afternoon: 'access:workspaceSelector.greeting.afternoon',
    evening: 'access:workspaceSelector.greeting.evening',
} as const satisfies Readonly<Record<PartOfDay, string>>;

/** The small hours still say good evening: nobody starting a shift at 3am calls it morning. */
function partOfDay(hour: number): PartOfDay {
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    return 'evening';
}

/**
 * The wall clock, turning over on the minute.
 *
 * The first wake is set for the next minute boundary rather than a minute from mount, so the time
 * on the page changes when the person's own clock does instead of up to 59 seconds behind it.
 */
function useMinuteClock(): Date {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | undefined;
        const tick = () => {
            setNow(new Date());
        };
        const timeout = setTimeout(
            () => {
                tick();
                interval = setInterval(tick, MINUTE_MS);
            },
            MINUTE_MS - (Date.now() % MINUTE_MS),
        );
        return () => {
            clearTimeout(timeout);
            if (interval !== undefined) clearInterval(interval);
        };
    }, []);

    return now;
}

/**
 * A shopper has no workspace page. Signed in, they belong in the shop, so a shopper who reaches
 * `/workspace` anyway — a typed URL, an old bookmark — is sent to the shop's home. Everybody the
 * shop is view-only for (`shop-view-only.tsx`) keeps the page.
 */
export function WorkspaceSelectorScreen() {
    const accessState = useAccessState();
    if (!isShopViewOnly(accessState)) return <Redirect href={shopperHome(accessState) as never} />;
    return <WorkspaceHub />;
}

/** The organisation, branch and role the person is working in. */
function useWorkingContext() {
    const { t } = useTranslation();
    const { me } = useSession();
    const context = me?.activeContext ?? null;
    const membership = me?.memberships.find((candidate) => candidate.id === context?.membershipId);
    const branch = membership?.branches.find((candidate) => candidate.id === context?.branchId);
    // The role's name as the invitations word it ("Manager", "Owner"); a role the catalogue does
    // not know falls back to the server's own name for it.
    const firstRole = membership?.roles[0];
    return {
        organisationId: membership?.organisation.id,
        organisationName: membership?.organisation.name ?? t('auth:profile.noContext'),
        branches: membership?.branches ?? [],
        branchId: context?.branchId ?? null,
        branchName: branch?.name,
        role:
            firstRole === undefined
                ? undefined
                : t(`invitations:invite.role.${firstRole.key}`, { defaultValue: firstRole.name }),
    };
}

type BadgeTone = 'waiting' | 'live' | 'quiet';

interface AreaFact {
    readonly badge?: string | undefined;
    readonly tone?: BadgeTone | undefined;
    readonly meta?: string | undefined;
}

/** What each area has waiting. See the file header. */
function useAreaFacts(areas: readonly string[]): Readonly<Record<string, AreaFact>> {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { branchId } = useWorkingContext();
    const canReadOrders = useCan([ORDER_VIEW_PERMISSION, ORDER_PREPARE_PERMISSION], 'any');
    const count = (value: number) => formatter.formatNumber(value);

    const display = useKitchenDisplayQuery(
        canReadOrders && (areas.includes('kitchen') || areas.includes('kds')),
        false,
    );
    const runs = useDriverJobsQuery(areas.includes('driver'));

    const open = display.data?.orders.filter(
        (order) =>
            (order.status === 'placed' || order.status === 'confirmed') &&
            (order.branchId === null || order.branchId === branchId),
    );
    const placed = open?.filter((order) => order.status === 'placed').length ?? 0;
    const waiting = runs.data?.available.length ?? 0;
    const onRoad = runs.data?.jobs.filter((job) => job.status === 'in_transit').length ?? 0;
    const assigned = (runs.data?.jobs.length ?? 0) - onRoad;

    const shop: AreaFact = {
        badge: t('access:workspaceSelector.viewOnly'),
        tone: 'quiet',
        meta: t('access:workspaceSelector.shopPages'),
    };

    return {
        public: shop,
        customer: shop,
        ...(open === undefined
            ? {}
            : {
                  kitchen: {
                      badge: t('access:workspaceSelector.toConfirm', { count: count(placed) }),
                      tone: placed > 0 ? 'waiting' : 'quiet',
                      meta: t('access:workspaceSelector.confirmed', {
                          count: count(open.length - placed),
                      }),
                  },
                  kds: {
                      badge: t('access:workspaceSelector.live'),
                      tone: 'live',
                      meta: t('access:workspaceSelector.onBoard', { count: count(open.length) }),
                  },
              }),
        ...(runs.data === undefined
            ? {}
            : {
                  driver: {
                      badge: t('access:workspaceSelector.waiting', { count: count(waiting) }),
                      tone: waiting > 0 ? 'waiting' : 'quiet',
                      meta: t('access:workspaceSelector.assignedOnRoad', {
                          assigned: count(assigned),
                          onRoad: count(onRoad),
                      }),
                  },
              }),
    };
}

function initialsOf(name: string): string {
    return name
        .split(/\s+/u)
        .filter((word) => word !== '')
        .slice(0, 2)
        .map((word) => word.charAt(0).toUpperCase())
        .join('');
}

/** The organisation's round mark, on the button and in the menu. */
function OrganisationMark({ name }: { readonly name: string }) {
    return (
        <View className="h-9 w-9 items-center justify-center rounded-full bg-surface-canopy">
            <RNText className="font-display text-xs font-bold text-content-on-canopy">
                {initialsOf(name)}
            </RNText>
        </View>
    );
}

/** A section's small heading inside the menu. */
function MenuHeading({ children }: { readonly children: string }) {
    return (
        <RNText className="px-2.5 pb-1.5 pt-2.5 text-xs font-semibold text-content-secondary text-start">
            {children}
        </RNText>
    );
}

/**
 * The start of the workspace page's top bar: the brand, then a button that says where the person is
 * working and opens the menu to change it. Picking another branch changes it there and then; another
 * organisation goes through the picker.
 *
 * Its own trigger and panel rather than `Popover`, whose trigger is one line of text. Escape and a
 * press outside close it, as they do there.
 */
export function WorkspaceOrgSwitcher() {
    const { t } = useTranslation();
    const router = useRouter();
    const { atLeast } = useBreakpoint();
    const { organisationId, organisationName, branches, branchId, branchName, role } =
        useWorkingContext();
    const setContext = useSetContextMutation();
    /*
     * With several branches and none chosen, the menu opens by itself and the button says what is
     * wanted: the kitchen and its display need a branch, and this is where one is picked, rather
     * than on a page of its own. `null` is "not touched yet", so a person who closes it is not
     * shown it again.
     */
    const needsBranch = branches.length > 1 && branchId === null;
    const [toggled, setOpen] = useState<boolean | null>(null);
    const open = toggled ?? needsBranch;
    const branchLine = branchName ?? (needsBranch ? t('auth:branchPicker.title') : undefined);
    const containerRef = useRef<View | null>(null);

    useEffect(() => {
        if (Platform.OS !== 'web' || !open || typeof document === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        const onPointerDown = (event: Event) => {
            const node = containerRef.current as unknown as {
                readonly contains?: (target: unknown) => boolean;
            } | null;
            if (node?.contains?.(event.target) !== true) setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [open]);

    return (
        <View className="z-auto min-w-0 flex-row items-center gap-3">
            {atLeast('md') ? (
                <>
                    <View className="flex-row items-center gap-2.5 ps-1">
                        <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-brand">
                            <Icon name="leaf" size="md" className="text-content-on-brand" />
                        </View>
                        <RNText className="font-display text-xl font-bold tracking-display text-content-primary">
                            {t('common:app.name')}
                        </RNText>
                    </View>
                    <View className="mx-1.5 h-7 w-px bg-stroke-subtle" />
                </>
            ) : null}
            <View ref={containerRef} className="z-auto min-w-0 flex-col">
                <Pressable
                    testID="workspace-org-trigger"
                    role="button"
                    accessibilityRole="button"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    accessibilityLabel={t('auth:workspace.switchOrganisation')}
                    onPress={() => {
                        setOpen(!open);
                    }}
                    className={cx(
                        'h-12 min-w-0 flex-row items-center gap-2.5 rounded-full border pe-3.5 ps-1.5',
                        'transition duration-normal ease-standard hover:border-stroke hover:bg-surface-brand-subtle',
                        open
                            ? 'border-stroke bg-surface-brand-subtle'
                            : 'border-transparent bg-surface-base',
                    )}
                >
                    <OrganisationMark name={organisationName} />
                    <View className="min-w-0 shrink">
                        <RNText
                            numberOfLines={1}
                            className="text-sm font-bold text-content-primary text-start"
                        >
                            {organisationName}
                        </RNText>
                        {branchLine === undefined ? null : (
                            <RNText
                                numberOfLines={1}
                                className="text-xs text-content-secondary text-start"
                            >
                                {branchLine}
                            </RNText>
                        )}
                    </View>
                    <View className={open ? 'rotate-180' : ''}>
                        <Icon name="chevronDown" size="md" className="text-content-secondary" />
                    </View>
                </Pressable>

                {open ? (
                    <View
                        testID="workspace-org-menu"
                        className="absolute top-full z-tooltip mt-2.5 w-[340px] flex-col rounded-[20px] border border-stroke-subtle bg-surface-raised p-2 shadow-elevation-3 web:max-w-[92vw]"
                    >
                        <MenuHeading>{t('auth:profile.organisation')}</MenuHeading>
                        <View className="min-h-14 flex-row items-center gap-2.5 rounded-[14px] bg-surface-brand-subtle p-2">
                            <OrganisationMark name={organisationName} />
                            <View className="min-w-0 flex-1">
                                <RNText
                                    numberOfLines={1}
                                    className="text-sm font-bold text-content-primary text-start"
                                >
                                    {organisationName}
                                </RNText>
                                {role === undefined ? null : (
                                    <RNText
                                        numberOfLines={1}
                                        className="text-xs text-content-secondary text-start"
                                    >
                                        {role}
                                    </RNText>
                                )}
                            </View>
                            <Icon name="check" size="md" className="text-content-on-brand-subtle" />
                        </View>

                        {branches.length === 0 ? null : (
                            <>
                                <MenuHeading>{t('auth:profile.branch')}</MenuHeading>
                                {branches.map((branch) => {
                                    const current = branch.id === branchId;
                                    return (
                                        <Pressable
                                            key={branch.id}
                                            testID={`workspace-branch-${branch.id}`}
                                            role="radio"
                                            aria-checked={current}
                                            disabled={setContext.isPending}
                                            onPress={() => {
                                                setOpen(false);
                                                if (current || organisationId === undefined) return;
                                                setContext.mutate({
                                                    organisationId,
                                                    branchId: branch.id,
                                                });
                                            }}
                                            className={cx(
                                                'min-h-14 flex-row items-center gap-2.5 rounded-[14px] p-2',
                                                current
                                                    ? 'bg-surface-brand-subtle'
                                                    : 'hover:bg-surface-base',
                                            )}
                                        >
                                            <View className="h-9 w-9 items-center justify-center rounded-full bg-surface-brand-subtle">
                                                <Icon
                                                    name="mapPin"
                                                    size="sm"
                                                    className="text-content-on-brand-subtle"
                                                />
                                            </View>
                                            <RNText
                                                numberOfLines={1}
                                                className="min-w-0 flex-1 text-sm font-bold text-content-primary text-start"
                                            >
                                                {branch.name}
                                            </RNText>
                                            {current ? (
                                                <Icon
                                                    name="check"
                                                    size="md"
                                                    className="text-content-on-brand-subtle"
                                                />
                                            ) : null}
                                        </Pressable>
                                    );
                                })}
                            </>
                        )}

                        <Pressable
                            testID="workspace-switch-organisation"
                            role="link"
                            onPress={() => {
                                setOpen(false);
                                router.push('/select-organisation');
                            }}
                            className="mt-1.5 min-h-12 flex-row items-center justify-between border-t border-stroke-subtle px-2.5"
                        >
                            <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                                {t('auth:workspace.switchOrganisation')}
                            </RNText>
                            <Icon
                                name="arrowForward"
                                size="md"
                                className="text-content-on-brand-subtle"
                            />
                        </Pressable>
                    </View>
                ) : null}
            </View>
        </View>
    );
}

function WorkspaceHub() {
    const { t } = useTranslation();
    const router = useRouter();
    const accessState = useAccessState();
    const { me } = useSession();
    const formatter = useFormatter();
    const { stagger } = useMotion();
    const { atLeast } = useBreakpoint();
    const now = useMinuteClock();

    const areas = availableWorkspaceAreas(accessState);
    /*
     * The account pages, which the admin bottom bar used to carry: every workspace page leads back
     * here (its Workspaces button), so they sit under the areas, one press away.
     */
    const accountPages = permittedNavigation(accessState).filter(
        (item) => item.key === 'profile' || item.key === 'devices',
    );
    const { organisationName, branchName, role } = useWorkingContext();
    const facts = useAreaFacts(areas.map((option) => option.area));

    // The first name when the profile has one; the display name otherwise, which is never blank.
    const givenName = me?.profile.givenName?.trim() ?? '';
    const name = givenName === '' ? (me?.profile.displayName ?? '') : givenName;
    const greeting = t(GREETING_KEY[partOfDay(now.getHours())], { name });
    const today = t('access:workspaceSelector.today', {
        date: formatter.formatDate(now, { dateStyle: 'full' }),
        time: formatter.formatDate(now, { timeStyle: 'short' }),
    });

    const tiles = areas.map((option) => ({
        key: option.area,
        testID: `workspace-area-${option.area}`,
        name: t(workspaceAreaLabelKey(option.area)),
        icon: AREA_ICONS[option.area],
        href: option.href,
        area: option.area,
        fact: facts[option.area],
    }));
    const [last] = useState(readLastArea);
    const resume = tiles.find((tile) => tile.area === last?.area);
    const wide = atLeast('md');

    return (
        <View style={{ width: PAGE_WIDTH, maxWidth: '100%', alignSelf: 'center' }}>
            <Cascade testID="workspace-selector-screen" space="none">
                {/*
                 * The board's opening: the live date, the greeting set large, the organisation,
                 * branch and role as chips — and at its end the dark card back into the area they
                 * last opened, when there is one.
                 */}
                <View
                    testID="workspace-hero"
                    className="flex-col gap-6 pt-4 lg:flex-row lg:items-end lg:justify-between"
                >
                    <View className="min-w-0 flex-col lg:flex-1">
                        <View className="flex-row items-center gap-2">
                            <LiveDot />
                            <RNText
                                testID="workspace-hero-subtitle"
                                className="text-base font-medium tabular-nums text-content-secondary text-start"
                            >
                                {today}
                            </RNText>
                        </View>
                        <RNText
                            testID="workspace-hero-title"
                            accessibilityRole="header"
                            aria-level={1}
                            className="mt-2.5 font-display text-4xl font-bold leading-[44px] tracking-display text-content-primary text-start md:text-5xl md:leading-[56px]"
                        >
                            {greeting}
                        </RNText>
                        <View
                            testID="workspace-hero-chips"
                            className="mt-4 flex-row flex-wrap items-center gap-2"
                        >
                            {(branchName === undefined
                                ? [organisationName]
                                : [organisationName, branchName]
                            ).map((chip) => (
                                <View
                                    key={chip}
                                    className="h-8 justify-center rounded-full border border-stroke-subtle bg-surface-raised px-3.5"
                                >
                                    <RNText className="text-sm font-semibold text-content-primary">
                                        {chip}
                                    </RNText>
                                </View>
                            ))}
                            {role === undefined ? null : (
                                <View className="h-8 justify-center rounded-full bg-surface-brand-subtle px-3.5">
                                    <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                                        {role}
                                    </RNText>
                                </View>
                            )}
                        </View>
                    </View>

                    {resume === undefined || last === null ? null : (
                        <ResumeCard
                            name={resume.name}
                            icon={resume.icon}
                            detail={resume.fact?.meta}
                            when={formatter.formatRelativeTime(last.at, now)}
                            onPress={() => {
                                rememberLastArea(resume.area);
                                router.push(resume.href as never);
                            }}
                        />
                    )}
                </View>

                {areas.length === 0 ? (
                    <View className="mt-10">
                        <EmptyState
                            testID="workspace-selector-empty"
                            title={t('access:workspaceSelector.empty')}
                            body={t('access:workspaceSelector.emptyBody')}
                            actions={
                                <Button
                                    testID="workspace-selector-switch"
                                    label={t('auth:workspace.switchOrganisation')}
                                    onPress={() => {
                                        router.replace('/select-organisation');
                                    }}
                                />
                            }
                        />
                    </View>
                ) : (
                    <View testID="workspace-area-panel" className="flex-col">
                        <RNText
                            testID="workspace-selector-title"
                            accessibilityRole="header"
                            aria-level={2}
                            className="mb-[18px] mt-11 text-center font-display text-2xl font-bold text-content-primary"
                        >
                            {t('access:workspaceSelector.title')}
                        </RNText>

                        {/*
                         * `flex-wrap` with `justify-center`, not `grid`: this screen is reached on
                         * iOS and Android too. Each row centres on its own, so two destinations sit
                         * together in the middle rather than stranded at the leading edge.
                         */}
                        <View
                            className={cx(
                                'flex-row flex-wrap gap-4',
                                wide ? 'justify-center' : 'justify-between',
                            )}
                            testID="workspace-area-grid"
                        >
                            {tiles.map((tile, index) => (
                                // Each tile rises a step behind the one before it.
                                <View
                                    key={tile.key}
                                    style={{
                                        width: wide ? TILE_WIDTH : '47%',
                                        height: TILE_HEIGHT,
                                    }}
                                >
                                    <FadeIn className="flex-1" delayMs={stagger(index + 2)}>
                                        <WorkspaceTile
                                            testID={tile.testID}
                                            name={tile.name}
                                            icon={tile.icon}
                                            fact={tile.fact}
                                            showArrow={wide}
                                            accessibilityLabel={t('access:workspaceSelector.open', {
                                                area: tile.name,
                                            })}
                                            onPress={() => {
                                                rememberLastArea(tile.area);
                                                router.push(tile.href as never);
                                            }}
                                        />
                                    </FadeIn>
                                </View>
                            ))}
                        </View>

                        {accountPages.length === 0 ? null : (
                            <>
                                <RNText className="mb-3 mt-[30px] text-center text-sm font-semibold text-content-secondary">
                                    {t('access:workspaceSelector.yourAccount')}
                                </RNText>
                                <View className="flex-row flex-wrap justify-center gap-3">
                                    {accountPages.map((item, index) => (
                                        <FadeIn
                                            key={item.key}
                                            delayMs={stagger(tiles.length + index + 2)}
                                        >
                                            <AccountRow
                                                testID={`workspace-${item.key}`}
                                                name={t(item.labelKey)}
                                                icon={item.icon}
                                                onPress={() => {
                                                    router.push(item.href as never);
                                                }}
                                            />
                                        </FadeIn>
                                    ))}
                                </View>
                            </>
                        )}
                    </View>
                )}
            </Cascade>
        </View>
    );
}

/** The board's live dot beside the date: the brand's green, pinging softly. */
function LiveDot() {
    const { enabled } = useMotion();
    const [ping] = useState(() => new Animated.Value(0));
    useEffect(() => {
        if (!enabled) return undefined;
        const loop = Animated.loop(
            Animated.timing(ping, {
                toValue: 1,
                duration: 2400,
                easing: Easing.out(Easing.quad),
                useNativeDriver: Platform.OS !== 'web',
            }),
        );
        loop.start();
        return () => {
            loop.stop();
        };
    }, [enabled, ping]);
    return (
        <View aria-hidden className="h-2 w-2 items-center justify-center">
            <Animated.View
                className="absolute h-2 w-2 rounded-full bg-surface-brand"
                style={{
                    opacity: ping.interpolate({
                        inputRange: [0, 0.8, 1],
                        outputRange: [0.45, 0, 0],
                    }),
                    transform: [
                        { scale: ping.interpolate({ inputRange: [0, 1], outputRange: [1, 3] }) },
                    ],
                }}
            />
            <View className="h-2 w-2 rounded-full bg-surface-brand" />
        </View>
    );
}

/** The way back into the area this browser last opened, on the board's dark card. */
function ResumeCard({
    name,
    icon,
    detail,
    when,
    onPress,
}: {
    readonly name: string;
    readonly icon: IconName;
    readonly detail: string | undefined;
    readonly when: string;
    readonly onPress: () => void;
}) {
    const { t } = useTranslation();
    return (
        <Pressable
            testID="workspace-resume"
            role="button"
            accessibilityRole="button"
            onPress={onPress}
            className="relative w-full overflow-hidden rounded-3xl bg-surface-canopy p-[18px] shadow-elevation-3 transition duration-normal ease-standard hover:-translate-y-0.5 lg:w-[400px]"
        >
            <View
                aria-hidden
                className="absolute -end-[50px] -top-[60px] h-[170px] w-[170px] rounded-full bg-stage-green opacity-15"
            />
            <View className="flex-row items-center justify-between gap-3">
                <RNText className="text-xs font-semibold text-stage-green text-start">
                    {t('access:workspaceSelector.resume')}
                </RNText>
                <RNText className="text-xs text-content-on-canopy-muted">{when}</RNText>
            </View>
            <View className="mt-3 flex-row items-center gap-3.5">
                <View className="h-[52px] w-[52px] items-center justify-center rounded-full bg-content-on-canopy/15">
                    <Icon name={icon} size="lg" className="text-content-on-canopy" />
                </View>
                <View className="min-w-0 flex-1">
                    <RNText
                        numberOfLines={1}
                        className="font-display text-lg font-bold text-content-on-canopy text-start"
                    >
                        {name}
                    </RNText>
                    {detail === undefined ? null : (
                        <RNText
                            numberOfLines={1}
                            className="mt-0.5 text-sm text-content-on-canopy-muted text-start"
                        >
                            {detail}
                        </RNText>
                    )}
                </View>
                <View className="h-9 w-9 items-center justify-center rounded-full bg-stage-green">
                    <Icon name="arrowForward" size="md" className="text-surface-canopy" />
                </View>
            </View>
        </Pressable>
    );
}

const BADGE_CLASS: Readonly<Record<BadgeTone, { fill: string; ink: string }>> = {
    waiting: { fill: 'bg-warning-subtle', ink: 'text-warning-strong' },
    live: { fill: 'bg-surface-brand-subtle', ink: 'text-content-on-brand-subtle' },
    quiet: { fill: 'border border-stroke-subtle bg-surface-base', ink: 'text-content-secondary' },
};

interface WorkspaceTileProps {
    readonly testID: string;
    readonly name: string;
    readonly icon: IconName;
    readonly fact: AreaFact | undefined;
    readonly showArrow: boolean;
    readonly accessibilityLabel: string;
    readonly onPress: () => void;
}

/**
 * One destination, as the board draws it: the icon disc at the top, the name large at the foot,
 * and an arrow in the corner. Hover, focus and press light it from one flag — the tile lifts, its
 * border and disc turn brand green, and the arrow inks and steps forward.
 */
function WorkspaceTile({
    testID,
    name,
    icon,
    fact,
    showArrow,
    accessibilityLabel,
    onPress,
}: WorkspaceTileProps) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [pressed, setPressed] = useState(false);
    const lit = hovered || focused || pressed;
    const badge = BADGE_CLASS[fact?.tone ?? 'quiet'];

    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            focusable
            onPress={onPress}
            onHoverIn={() => {
                setHovered(true);
            }}
            onHoverOut={() => {
                setHovered(false);
            }}
            onFocus={() => {
                setFocused(true);
            }}
            onBlur={() => {
                setFocused(false);
            }}
            onPressIn={() => {
                setPressed(true);
            }}
            onPressOut={() => {
                setPressed(false);
            }}
            className={cx(
                'relative flex-1 flex-col rounded-[20px] border bg-surface-raised p-4',
                'transition duration-normal ease-standard active:opacity-85',
                lit
                    ? '-translate-y-1 border-surface-brand shadow-elevation-card-hover'
                    : 'border-stroke-subtle shadow-elevation-card',
            )}
        >
            <View
                className={cx(
                    'flex-row items-start justify-between',
                    showArrow ? 'gap-2' : 'gap-1',
                )}
            >
                <View
                    className={cx(
                        'items-center justify-center rounded-full',
                        showArrow ? 'h-11 w-11' : 'h-10 w-10',
                        'transition duration-normal ease-standard',
                        lit ? 'scale-105 bg-surface-brand' : 'bg-surface-brand-subtle',
                    )}
                >
                    {/* Unlabelled on purpose: the name below is the accessible content. */}
                    <Icon
                        name={icon}
                        size="md"
                        className={lit ? 'text-content-on-brand' : 'text-content-on-brand-subtle'}
                    />
                </View>
                {fact?.badge === undefined ? null : (
                    <View
                        testID={`${testID}-badge`}
                        className={cx(
                            'h-7 shrink justify-center rounded-full',
                            showArrow ? 'px-2.5' : 'px-2',
                            badge.fill,
                        )}
                    >
                        <RNText
                            numberOfLines={1}
                            className={cx(
                                'font-bold tabular-nums',
                                showArrow ? 'text-xs' : 'text-[11px]',
                                badge.ink,
                            )}
                        >
                            {fact.badge}
                        </RNText>
                    </View>
                )}
            </View>
            <RNText className="mt-auto font-display text-lg font-bold leading-6 text-content-primary text-start">
                {name}
            </RNText>
            {fact?.meta === undefined ? null : (
                <RNText
                    testID={`${testID}-meta`}
                    className={cx(
                        'mt-1 text-xs tabular-nums text-content-secondary text-start',
                        showArrow ? 'pe-10' : undefined,
                    )}
                >
                    {fact.meta}
                </RNText>
            )}
            {showArrow ? (
                <View
                    className={cx(
                        'absolute bottom-4 end-4 h-8 w-8 items-center justify-center rounded-full',
                        'transition duration-normal ease-standard',
                        lit ? 'bg-content-primary' : 'bg-surface-base',
                    )}
                >
                    <Icon
                        name="arrowForward"
                        size="sm"
                        className={lit ? 'text-surface-base' : 'text-content-primary'}
                    />
                </View>
            ) : null}
        </Pressable>
    );
}

/** An account page under the areas: the board's pill row — a small disc, the name, a chevron. */
function AccountRow({
    testID,
    name,
    icon,
    onPress,
}: {
    readonly testID: string;
    readonly name: string;
    readonly icon: IconName;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            onPress={onPress}
            className="h-[60px] min-w-[220px] flex-row items-center gap-3 rounded-full border border-stroke-subtle bg-surface-raised pe-4 ps-2.5 transition duration-normal ease-standard hover:border-stroke hover:bg-surface-brand-subtle"
        >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-brand-subtle">
                <Icon name={icon} size="md" className="text-content-on-brand-subtle" />
            </View>
            <RNText className="text-base font-semibold text-content-primary">{name}</RNText>
            <View className="ms-auto">
                <Icon name="chevronEnd" size="sm" className="text-content-secondary" />
            </View>
        </Pressable>
    );
}
