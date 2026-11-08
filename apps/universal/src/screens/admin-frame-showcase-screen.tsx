import {
    AppShell,
    Icon,
    Inline,
    RailAccount,
    ShellRailButton,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { NavigationItem } from '@healthy360/design-system';
import { useState } from 'react';
import { Text as RNText, View } from 'react-native';

import { AreaRailTop, DESK_SIDEBAR_WIDTH } from '../shell/area-brand-block.tsx';
import { LocaleToggle } from '../shell/locale-toggle.tsx';
import { ThemeToggle } from '../shell/theme-toggle.tsx';

interface Page {
    readonly key: string;
    readonly label: string;
    readonly group?: string;
    readonly groupIcon?: NavigationItem['groupIcon'];
    readonly count?: number;
}

const PAGES: readonly Page[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'queue', label: 'Queue', group: 'Order desk', groupIcon: 'receipt', count: 4 },
    { key: 'new-order', label: 'New order', group: 'Order desk', groupIcon: 'receipt' },
    { key: 'calendar', label: 'Calendar', group: 'Order desk', groupIcon: 'receipt' },
    { key: 'review', label: 'Review', group: 'Workbench', groupIcon: 'clipboardCheck', count: 7 },
    { key: 'exceptions', label: 'Exceptions', group: 'Workbench', count: 2 },
    { key: 'ingredients', label: 'Ingredients', group: 'Catalogue', groupIcon: 'chefHat' },
    { key: 'recipes', label: 'Recipes', group: 'Catalogue' },
    { key: 'price-lists', label: 'Price lists', group: 'Commercial', groupIcon: 'tag' },
    { key: 'batch', label: 'Batch planner', group: 'Operations', groupIcon: 'package' },
    { key: 'team', label: 'Team', group: 'Access', groupIcon: 'shield' },
];

/**
 * `/showcase-admin-frame` — the staff frame from the admin redesign canvas (2026-11-07): the
 * floating module rail with its leaf, amber module counts, Workspaces and the account avatar (its
 * card is option B — the name, role · branch and Sign out); the floating page panel with the
 * module's name and its « close; the pill top bar with the trail, the search pill, ع / EN, the
 * Workspaces button and the theme switch. Every control works on the page's own state.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */
export function AdminFrameShowcaseScreen() {
    const [active, setActive] = useState('review');
    const [signedOut, setSignedOut] = useState(0);
    const current = PAGES.find((page) => page.key === active);

    const navigation: readonly NavigationItem[] = PAGES.map((page) => ({
        key: page.key,
        label: page.label,
        icon: page.group === undefined ? 'dashboard' : undefined,
        group: page.group,
        groupIcon: page.groupIcon,
        count: page.count,
        active: page.key === active,
        testID: `frame-nav-${page.key}`,
        onPress: () => {
            setActive(page.key);
        },
    }));

    return (
        <Stack space="sm">
            <Text tone="secondary">
                {`Sign out pressed ${String(signedOut)} times. Widen the window past 1024px for the rail.`}
            </Text>
            <View
                className="overflow-hidden rounded-xl border border-stroke-subtle"
                style={{ height: 760 }}
            >
                <AppShell
                    testID="frame"
                    variant="workspace"
                    title="Kitchen"
                    pathname={`/kitchen/${active}`}
                    navigation={navigation}
                    sidebarWidth={DESK_SIDEBAR_WIDTH}
                    sidebarStartCollapsed={<AreaRailTop testID="frame-rail-top" />}
                    railEnd={
                        <>
                            <ShellRailButton
                                testID="frame-workspaces-rail"
                                label="Workspaces"
                                icon="gridDots"
                                onPress={() => undefined}
                            />
                            <RailAccount
                                testID="frame-account"
                                name="Hala"
                                detail="Owner · Main kitchen"
                                label="Hala, account"
                                menuLabel="Account"
                                signOutLabel="Sign out"
                                onSignOut={() => {
                                    setSignedOut((count) => count + 1);
                                }}
                            />
                        </>
                    }
                    topbarTitle={
                        <Inline space="xs" wrap={false}>
                            <Text tone="secondary">Kitchen</Text>
                            <Text tone="secondary">/</Text>
                            <Text variant="bodyStrong">{current?.label ?? ''}</Text>
                        </Inline>
                    }
                    topbarSearch={
                        <View className="h-11 min-w-0 max-w-[420px] flex-1 flex-row items-center gap-2.5 rounded-full bg-surface-sunken pe-2 ps-4">
                            <Icon name="searchLens" className="text-content-secondary" />
                            <RNText className="min-w-0 flex-1 text-sm font-medium text-content-secondary text-start">
                                Search pages…
                            </RNText>
                            <RNText className="rounded-lg border border-stroke-subtle bg-surface-raised px-2 py-1 text-xs font-semibold text-content-secondary">
                                Ctrl K
                            </RNText>
                        </View>
                    }
                    topbarEnd={
                        <Inline space="xs" wrap={false}>
                            <LocaleToggle round />
                            <ThemeToggle />
                        </Inline>
                    }
                >
                    <Text variant="display">{current?.label ?? ''}</Text>
                    <Text tone="secondary">Page content</Text>
                </AppShell>
            </View>
        </Stack>
    );
}
