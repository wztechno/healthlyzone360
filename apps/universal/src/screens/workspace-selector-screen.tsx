import {
    Button,
    Cascade,
    EmptyState,
    FadeIn,
    Icon,
    cx,
    useMotion,
} from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Platform, Pressable, Text as RNText, View } from 'react-native';

import { isShopViewOnly } from '../features/marketplace/shop-view-only.tsx';
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
 * ## A greeting, then one panel, centred, at a size that does not move
 *
 * The page opens on a soft-green band — the person's name with the part of the day, today's date and
 * the time, the organisation and branch they are working in, and at its inline end the switches
 * that change them — and the choice sits in a single centred panel under it. Everything on the page
 * shares one centre line and one width.
 *
 * ## One screen, no scroll
 *
 * The hub is a place to pick from, not to read, so the whole of it fits a laptop's viewport: the
 * switches sit in the band beside what they switch rather than under a rule at the panel's foot, and
 * the band, the panel and the tiles are set compact. Two rows of tiles and the band clear a 1366×768
 * screen with the browser's own chrome.
 *
 * The panel's width and the tiles inside it are **fixed**, and that is the point rather than an
 * accident. How many areas a person's role grants is a property of their role, and it must not
 * change what a tile *is* — an owner with five destinations and a buyer with two should recognise
 * the same page. So the tiles keep their size and centre themselves inside a panel that also keeps
 * its size; only how many sit on a row changes.
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
 * `PAGE_WIDTH` is the board's: four 296px tiles and three 16px gutters on a row. `maxWidth: '100%'`
 * is what keeps that honest on a phone, where a fixed width would run off the side of the screen.
 */
const PAGE_WIDTH = 1232;
const TILE_WIDTH = 296;
const TILE_HEIGHT = 204;

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

function WorkspaceHub() {
    const { t } = useTranslation();
    const router = useRouter();
    const accessState = useAccessState();
    const { me } = useSession();
    const formatter = useFormatter();
    const { stagger } = useMotion();
    const now = useMinuteClock();

    const areas = availableWorkspaceAreas(accessState);
    /*
     * The account pages, which the admin bottom bar used to carry: every workspace page leads back
     * here (its Workspaces button), so they sit under the areas, one press away.
     */
    const accountPages = permittedNavigation(accessState).filter(
        (item) => item.key === 'profile' || item.key === 'devices',
    );
    const context = me?.activeContext ?? null;
    const membership = me?.memberships.find((candidate) => candidate.id === context?.membershipId);
    const organisationName = membership?.organisation.name ?? t('auth:profile.noContext');
    const branch = membership?.branches.find((candidate) => candidate.id === context?.branchId);
    // The role's name as the invitations word it ("Manager", "Owner"); a role the catalogue does
    // not know falls back to the server's own name for it.
    const firstRole = membership?.roles[0];
    const role =
        firstRole === undefined
            ? undefined
            : t(`invitations:invite.role.${firstRole.key}`, { defaultValue: firstRole.name });

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
    }));

    return (
        <View style={{ width: PAGE_WIDTH, maxWidth: '100%', alignSelf: 'center' }}>
            <Cascade testID="workspace-selector-screen" space="none">
                {/*
                 * The board's opening: the live date, the greeting set large, the organisation,
                 * branch and role as chips — and at its end the dark card that says where the
                 * person is working, which is the way to change it.
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
                            {(branch === undefined
                                ? [organisationName]
                                : [organisationName, branch.name]
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

                    <ContextCard
                        organisation={organisationName}
                        branch={branch?.name}
                        canSwitchBranch={membership !== undefined && membership.branches.length > 1}
                        onSwitchOrganisation={() => {
                            router.push('/select-organisation');
                        }}
                        onSwitchBranch={() => {
                            router.push('/select-branch');
                        }}
                    />
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
                            className="flex-row flex-wrap justify-center gap-4"
                            testID="workspace-area-grid"
                        >
                            {tiles.map((tile, index) => (
                                // Each tile rises a step behind the one before it.
                                <FadeIn key={tile.key} delayMs={stagger(index + 2)}>
                                    <View
                                        style={{
                                            width: TILE_WIDTH,
                                            height: TILE_HEIGHT,
                                            maxWidth: '100%',
                                        }}
                                    >
                                        <WorkspaceTile
                                            testID={tile.testID}
                                            name={tile.name}
                                            icon={tile.icon}
                                            accessibilityLabel={t('access:workspaceSelector.open', {
                                                area: tile.name,
                                            })}
                                            onPress={() => {
                                                router.push(tile.href as never);
                                            }}
                                        />
                                    </View>
                                </FadeIn>
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

/**
 * Where the person is working, on the board's dark card — the place its "Pick up where you left
 * off" card sits. The organisation's initials, its name and the branch, and the switches that change
 * them. Nothing here records a last-visited area, so the card says what is true now instead.
 */
function ContextCard({
    organisation,
    branch,
    canSwitchBranch,
    onSwitchOrganisation,
    onSwitchBranch,
}: {
    readonly organisation: string;
    readonly branch: string | undefined;
    readonly canSwitchBranch: boolean;
    readonly onSwitchOrganisation: () => void;
    readonly onSwitchBranch: () => void;
}) {
    const { t } = useTranslation();
    const initials = organisation
        .split(/\s+/u)
        .filter((word) => word !== '')
        .slice(0, 2)
        .map((word) => word.charAt(0).toUpperCase())
        .join('');
    return (
        <View className="relative w-full overflow-hidden rounded-3xl bg-surface-canopy p-[18px] shadow-elevation-3 lg:w-[400px]">
            <View
                aria-hidden
                className="absolute -end-[50px] -top-[60px] h-[170px] w-[170px] rounded-full bg-stage-green opacity-15"
            />
            <RNText className="text-xs font-semibold text-stage-green text-start">
                {t('access:workspaceSelector.workingIn')}
            </RNText>
            <View className="mt-3 flex-row items-center gap-3.5">
                <View className="h-[52px] w-[52px] items-center justify-center rounded-full bg-content-on-canopy/15">
                    <RNText className="font-display text-base font-bold text-content-on-canopy">
                        {initials}
                    </RNText>
                </View>
                <View className="min-w-0 flex-1">
                    <RNText
                        numberOfLines={1}
                        className="font-display text-lg font-bold text-content-on-canopy text-start"
                    >
                        {organisation}
                    </RNText>
                    {branch === undefined ? null : (
                        <RNText
                            numberOfLines={1}
                            className="mt-0.5 text-sm text-content-on-canopy-muted text-start"
                        >
                            {branch}
                        </RNText>
                    )}
                </View>
            </View>
            <View className="mt-4 flex-row flex-wrap gap-2">
                <Pressable
                    testID="workspace-switch-organisation"
                    role="button"
                    accessibilityRole="button"
                    onPress={onSwitchOrganisation}
                    className="h-10 flex-row items-center gap-2 rounded-full bg-stage-green pe-3 ps-4 hover:opacity-90"
                >
                    <RNText className="text-sm font-bold text-surface-canopy">
                        {t('auth:workspace.switchOrganisation')}
                    </RNText>
                    <Icon name="arrowForward" size="sm" className="text-surface-canopy" />
                </Pressable>
                {canSwitchBranch ? (
                    <Pressable
                        testID="workspace-switch-branch"
                        role="button"
                        accessibilityRole="button"
                        onPress={onSwitchBranch}
                        className="h-10 justify-center rounded-full border border-content-on-canopy/30 px-4 hover:bg-content-on-canopy/10"
                    >
                        <RNText className="text-sm font-bold text-content-on-canopy">
                            {t('auth:workspace.switchBranch')}
                        </RNText>
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
}

interface WorkspaceTileProps {
    readonly testID: string;
    readonly name: string;
    readonly icon: IconName;
    readonly accessibilityLabel: string;
    readonly onPress: () => void;
}

/**
 * One destination, as the board draws it: the icon disc at the top, the name large at the foot,
 * and an arrow in the corner. Hover, focus and press light it from one flag — the tile lifts, its
 * border and disc turn brand green, and the arrow inks and steps forward.
 */
function WorkspaceTile({ testID, name, icon, accessibilityLabel, onPress }: WorkspaceTileProps) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [pressed, setPressed] = useState(false);
    const lit = hovered || focused || pressed;

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
                'relative flex-1 flex-col rounded-3xl border bg-surface-raised p-5',
                'transition duration-normal ease-standard active:opacity-85',
                lit
                    ? '-translate-y-1 border-surface-brand shadow-elevation-card-hover'
                    : 'border-stroke-subtle shadow-elevation-card',
            )}
        >
            <View
                className={cx(
                    'h-[52px] w-[52px] items-center justify-center rounded-full',
                    'transition duration-normal ease-standard',
                    lit ? 'scale-105 bg-surface-brand' : 'bg-surface-brand-subtle',
                )}
            >
                {/* Unlabelled on purpose: the name below is the accessible content. */}
                <Icon
                    name={icon}
                    size="lg"
                    className={lit ? 'text-content-on-brand' : 'text-content-on-brand-subtle'}
                />
            </View>
            <RNText className="mt-auto pe-12 font-display text-2xl font-bold leading-7 text-content-primary text-start">
                {name}
            </RNText>
            <View
                className={cx(
                    'absolute bottom-5 end-5 h-9 w-9 items-center justify-center rounded-full',
                    'transition duration-normal ease-standard',
                    lit ? 'bg-content-primary' : 'bg-surface-base',
                )}
            >
                <Icon
                    name="arrowForward"
                    size="md"
                    className={lit ? 'text-surface-base' : 'text-content-primary'}
                />
            </View>
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
