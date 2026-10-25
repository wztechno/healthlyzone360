import {
    Button,
    Card,
    Cascade,
    EmptyState,
    FadeIn,
    Heading,
    Icon,
    Inline,
    Stack,
    Text,
    cx,
    useMotion,
} from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import {
    AREA_ICONS,
    availableWorkspaceAreas,
    permittedNavigation,
    workspaceAreaLabelKey,
} from '../navigation/items.ts';
import { useAccessState, useSession } from '../session/session-provider.tsx';

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
 * the time, and the organisation and branch they are working in — and the choice sits in a single
 * centred panel under it: the destinations inside it, and the context switches under a rule at its
 * foot. Everything on the page shares one centre line and one width.
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
 * `PANEL_WIDTH` is sized to hold five tiles on one row — `5 x 170 + 4 x 12` gutters is 898, inside
 * 960 less the panel's own 24px padding. `maxWidth: '100%'` is what keeps that honest on a phone,
 * where a fixed 960 would otherwise run off the side of the screen.
 */
const PANEL_WIDTH = 960;
const TILE_WIDTH = 170;
const TILE_HEIGHT = 130;

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

export function WorkspaceSelectorScreen() {
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
     * here (its Workspaces button), so they are tiles beside the areas, one press away.
     */
    const accountPages = permittedNavigation(accessState).filter(
        (item) => item.key === 'profile' || item.key === 'devices',
    );
    const context = me?.activeContext ?? null;
    const membership = me?.memberships.find((candidate) => candidate.id === context?.membershipId);
    const organisationName = membership?.organisation.name ?? t('auth:profile.noContext');
    const branch = membership?.branches.find((candidate) => candidate.id === context?.branchId);

    // The first name when the profile has one; the display name otherwise, which is never blank.
    const givenName = me?.profile.givenName?.trim() ?? '';
    const name = givenName === '' ? (me?.profile.displayName ?? '') : givenName;
    const greeting = t(GREETING_KEY[partOfDay(now.getHours())], { name });
    const today = t('access:workspaceSelector.today', {
        date: formatter.formatDate(now, { dateStyle: 'full' }),
        time: formatter.formatDate(now, { timeStyle: 'short' }),
    });

    /*
     * Filled, both of them: these are the page's own actions — the ways out of the hub — and the
     * only buttons on it, so there is no primary for them to compete with.
     */
    const contextSwitches = (
        <Inline space="sm" justify="center" wrap>
            <Button
                testID="workspace-switch-organisation"
                variant="primary"
                size="sm"
                label={t('auth:workspace.switchOrganisation')}
                onPress={() => {
                    router.push('/select-organisation');
                }}
            />
            {membership !== undefined && membership.branches.length > 1 ? (
                <Button
                    testID="workspace-switch-branch"
                    variant="primary"
                    size="sm"
                    label={t('auth:workspace.switchBranch')}
                    onPress={() => {
                        router.push('/select-branch');
                    }}
                />
            ) : null}
        </Inline>
    );

    const tiles = [
        ...areas.map((option) => ({
            key: option.area,
            testID: `workspace-area-${option.area}`,
            name: t(workspaceAreaLabelKey(option.area)),
            icon: AREA_ICONS[option.area],
            href: option.href,
        })),
        ...accountPages.map((item) => ({
            key: item.key,
            testID: `workspace-${item.key}`,
            name: t(item.labelKey),
            icon: item.icon,
            href: item.href,
        })),
    ];

    return (
        <View style={{ width: PANEL_WIDTH, maxWidth: '100%', alignSelf: 'center' }}>
            <Cascade testID="workspace-selector-screen" space="lg">
                {/*
                 * The product's soft green — `Card tone="brand"`, the fill behind the tiles' icons
                 * — rather than the dark canopy of `PageHero`. Every word on it is the dark green
                 * that `colour.test.ts` checks against that fill; no other ink is tested there.
                 */}
                <Card testID="workspace-hero" tone="brand" padding="lg">
                    <Stack space="sm">
                        {/*
                         * React Native's `Text`, because no `Heading` level is this size: the
                         * greeting is set as large as `PageHero` sets its title.
                         */}
                        <RNText
                            testID="workspace-hero-title"
                            accessibilityRole="header"
                            aria-level={1}
                            className="text-5xl leading-[1.05] tracking-display text-content-on-brand-subtle text-start"
                        >
                            {greeting}
                        </RNText>
                        <Text testID="workspace-hero-subtitle" tone="brand">
                            {today}
                        </Text>
                        <View
                            testID="workspace-hero-chips"
                            className="flex-row flex-wrap items-center gap-2 pt-1"
                        >
                            {(branch === undefined
                                ? [organisationName]
                                : [organisationName, branch.name]
                            ).map((chip) => (
                                <View
                                    key={chip}
                                    className="rounded-full bg-surface-raised px-4 py-1.5"
                                >
                                    <RNText className="text-sm font-medium text-content-on-brand-subtle">
                                        {chip}
                                    </RNText>
                                </View>
                            ))}
                        </View>
                    </Stack>
                </Card>

                {areas.length === 0 ? (
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
                ) : (
                    <Card testID="workspace-area-panel" padding="lg">
                        <Stack space="md">
                            <Heading level={2} testID="workspace-selector-title" align="center">
                                {t('access:workspaceSelector.title')}
                            </Heading>

                            {/*
                             * `flex-wrap` with `justify-center`, and not the `grid` utilities the
                             * kitchen hub uses further down its own file: `grid` is a web-only
                             * escape hatch, and unlike that hub this screen is reached on iOS and
                             * Android too. Wrapping also gives the centring for free — a row that
                             * cannot fit the next tile starts a new one, and each row centres on
                             * its own, so two destinations sit together in the middle rather than
                             * stranded at the leading edge.
                             */}
                            <View
                                className="flex-row flex-wrap justify-center gap-3"
                                testID="workspace-area-grid"
                            >
                                {tiles.map((tile, index) => (
                                    // Each tile fades in a step behind the one before it, after
                                    // the hero and the panel have risen into place.
                                    <FadeIn key={tile.key} delayMs={stagger(index + 2)}>
                                        <View style={{ width: TILE_WIDTH, height: TILE_HEIGHT }}>
                                            <WorkspaceTile
                                                testID={tile.testID}
                                                name={tile.name}
                                                icon={tile.icon}
                                                accessibilityLabel={t(
                                                    'access:workspaceSelector.open',
                                                    { area: tile.name },
                                                )}
                                                onPress={() => {
                                                    router.push(tile.href as never);
                                                }}
                                            />
                                        </View>
                                    </FadeIn>
                                ))}
                            </View>

                            {/*
                             * A rule, then the context switches. Changing organisation or branch is
                             * a different kind of action from picking a destination — it changes
                             * what the destinations *are* — so it is separated rather than left to
                             * read as a sixth tile.
                             */}
                            <View className="self-stretch border-t border-stroke-subtle" />
                            {contextSwitches}
                        </Stack>
                    </Card>
                )}
            </Cascade>
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
 * One destination.
 *
 * Not a `Card interactive`, because the tile answers the pointer with more than the card's lift: its
 * border and its icon disc turn brand green, and a press dims it. A `hover:` class on the tile
 * styles the tile, not the disc inside it, so the tile keeps hover, press and keyboard focus as
 * state and lights both from one flag. Focus lights it the same way hover does, so a keyboard user
 * sees where they are.
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
                // `flex-1` fills the fixed box around it rather than `h-full`, which `card.tsx`
                // warns against: a percentage height resolved against a ScrollView's grown content
                // is not the height you meant.
                'flex-1 items-center justify-center gap-3 rounded-xl border bg-surface-raised p-4',
                // The lift and the press are the card's own utilities, so they are already in the
                // stylesheet; the state only has to say what colour the tile is.
                'transition duration-normal ease-standard hover:-translate-y-1 active:opacity-80',
                lit
                    ? 'border-surface-brand shadow-elevation-card-hover'
                    : 'border-stroke-subtle shadow-elevation-card',
            )}
        >
            <View
                className={cx(
                    'h-12 w-12 items-center justify-center rounded-full',
                    'transition duration-normal ease-standard',
                    lit ? 'bg-surface-brand' : 'bg-surface-brand-subtle',
                )}
            >
                {/*
                 * Unlabelled on purpose. The name below is the accessible content; a labelled icon
                 * would have the tile announce the same area twice, once as a glyph and once as a
                 * word.
                 */}
                <Icon
                    name={icon}
                    size="lg"
                    className={lit ? 'text-content-on-brand' : 'text-content-on-brand-subtle'}
                />
            </View>
            <Text variant="bodyStrong" align="center">
                {name}
            </Text>
        </Pressable>
    );
}
