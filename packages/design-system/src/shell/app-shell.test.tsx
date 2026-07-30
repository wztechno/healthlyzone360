import { fireEvent, screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { Text } from '../primitives/text.tsx';
import { OfflineIndicator } from '../status/offline-indicator.tsx';
import { assertSubtreeIsLogical, renderWithI18n } from '../testing/render.tsx';
import { APP_SHELL_VARIANTS, AppShell } from './app-shell.tsx';
import type { NavigationItem } from './app-shell.tsx';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions');

const mockedDimensions = useWindowDimensions as unknown as jest.Mock;

function setViewport(width: number) {
    mockedDimensions.mockReturnValue({ width, height: 900, scale: 2, fontScale: 1 });
}

const navigation: readonly NavigationItem[] = [
    { key: 'overview', label: 'Overview', icon: 'organisation', active: true, onPress: jest.fn(), testID: 'nav-overview' },
    { key: 'devices', label: 'Devices', icon: 'device', onPress: jest.fn(), testID: 'nav-devices' },
];

beforeEach(() => {
    setViewport(1440);
});

describe('AppShell — variant matrix', () => {
    it.each(APP_SHELL_VARIANTS)('renders its children in the %s variant', async (variant) => {
        await renderWithI18n(
            <AppShell testID="shell" variant={variant} title="Healthy360" navigation={navigation}>
                <Text testID="content">Body</Text>
            </AppShell>,
        );
        expect(screen.getByTestId('content')).toBeTruthy();
    });

    it.each(APP_SHELL_VARIANTS)('renders the banner slot in the %s variant', async (variant) => {
        await renderWithI18n(
            <AppShell
                testID="shell"
                variant={variant}
                banner={<OfflineIndicator testID="net" state="offline" />}
            >
                <Text>Body</Text>
            </AppShell>,
        );
        expect(screen.getByTestId('net')).toBeTruthy();
    });
});

describe('AppShell — public', () => {
    it('has a top bar with the title as the page heading', async () => {
        await renderWithI18n(
            <AppShell testID="shell" variant="public" title="Healthy360">
                <Text>Body</Text>
            </AppShell>,
        );
        expect(screen.getByTestId('shell-topbar').props.role).toBe('banner');
        expect(screen.getByTestId('shell-title').props.accessibilityRole).toBe('header');
        expect(screen.getByTestId('shell-title')).toHaveTextContent(/Healthy360/);
    });

    it('falls back to the product name when no title is given', async () => {
        await renderWithI18n(
            <AppShell testID="shell" variant="public">
                <Text>Body</Text>
            </AppShell>,
        );
        expect(screen.getByTestId('shell-title')).toHaveTextContent(/Healthy360/);
    });
});

describe('AppShell — auth', () => {
    it('is a centred card with no navigation at all', async () => {
        await renderWithI18n(
            <AppShell testID="shell" variant="auth" title="Sign in" navigation={navigation}>
                <Text testID="form">Form</Text>
            </AppShell>,
        );

        expect(screen.getByTestId('shell-card').props.role).toBe('main');
        expect(screen.queryByTestId('shell-navigation')).toBeNull();
        expect(screen.queryByTestId('shell-topbar')).toBeNull();
        expect(screen.getByTestId('form')).toBeTruthy();
    });
});

describe('AppShell — workspace', () => {
    it('shows a persistent sidebar at lg and above', async () => {
        setViewport(1280);
        await renderWithI18n(
            <AppShell testID="shell" variant="workspace" navigation={navigation}>
                <Text>Body</Text>
            </AppShell>,
        );

        expect(screen.getByTestId('shell-sidebar')).toBeTruthy();
        expect(screen.queryByTestId('shell-menu')).toBeNull();
    });

    /**
     * Below `lg` the sidebar must be *absent*, not merely hidden: hidden navigation stays in the
     * accessibility tree and the tab order, which strands keyboard and screen reader users.
     */
    it('replaces the sidebar with a drawer trigger below lg', async () => {
        setViewport(720);
        await renderWithI18n(
            <AppShell testID="shell" variant="workspace" navigation={navigation}>
                <Text>Body</Text>
            </AppShell>,
        );

        expect(screen.queryByTestId('shell-sidebar')).toBeNull();
        expect(screen.getByTestId('shell-menu')).toBeTruthy();
        expect(screen.queryByTestId('nav-overview')).toBeNull();
    });

    it('opens the drawer from the menu control', async () => {
        setViewport(720);
        await renderWithI18n(
            <AppShell testID="shell" variant="workspace" navigation={navigation}>
                <Text>Body</Text>
            </AppShell>,
        );

        await fireEvent.press(screen.getByTestId('shell-menu'));
        expect(screen.getByTestId('shell-drawer')).toBeTruthy();
        expect(screen.getByTestId('nav-overview')).toBeTruthy();
    });

    it('closes the drawer when a destination is chosen', async () => {
        setViewport(720);
        const onPress = jest.fn();
        await renderWithI18n(
            <AppShell
                testID="shell"
                variant="workspace"
                navigation={[
                    { key: 'devices', label: 'Devices', onPress, testID: 'nav-devices' },
                ]}
            >
                <Text>Body</Text>
            </AppShell>,
        );

        await fireEvent.press(screen.getByTestId('shell-menu'));
        await fireEvent.press(screen.getByTestId('nav-devices'));

        expect(onPress).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('nav-devices')).toBeNull();
    });

    it('marks the active destination as the current page', async () => {
        await renderWithI18n(
            <AppShell testID="shell" variant="workspace" navigation={navigation}>
                <Text>Body</Text>
            </AppShell>,
        );

        expect(screen.getByTestId('nav-overview').props['aria-current']).toBe('page');
        expect(screen.getByTestId('nav-devices').props['aria-current']).toBeUndefined();
    });

    it('names the navigation landmark', async () => {
        await renderWithI18n(
            <AppShell testID="shell" variant="workspace" navigation={navigation}>
                <Text>Body</Text>
            </AppShell>,
        );
        const nav = screen.getByTestId('shell-navigation');
        expect(nav.props.role).toBe('navigation');
        expect(nav.props['aria-label']).toBe('Main navigation');
    });

    it('renders exactly the items it is given — filtering is the caller’s job', async () => {
        await renderWithI18n(
            <AppShell
                testID="shell"
                variant="workspace"
                navigation={[{ key: 'a', label: 'Only one', onPress: jest.fn(), testID: 'nav-a' }]}
            >
                <Text>Body</Text>
            </AppShell>,
        );

        expect(screen.getByTestId('nav-a')).toBeTruthy();
        expect(screen.queryByTestId('nav-devices')).toBeNull();
    });

    it('draws no sidebar at all when there is nothing permitted to show', async () => {
        await renderWithI18n(
            <AppShell testID="shell" variant="workspace" navigation={[]}>
                <Text>Body</Text>
            </AppShell>,
        );
        expect(screen.queryByTestId('shell-sidebar')).toBeNull();
        expect(screen.queryByTestId('shell-menu')).toBeNull();
    });
});

describe('AppShell — rail', () => {
    it('keeps a narrow icon rail even on a tablet-width viewport', async () => {
        setViewport(820);
        await renderWithI18n(
            <AppShell testID="shell" variant="rail" navigation={navigation}>
                <Text>Body</Text>
            </AppShell>,
        );

        const sidebar = screen.getByTestId('shell-sidebar');
        expect(sidebar.props.className).toContain('w-[88px]');
        expect(sidebar.props.className).toContain('border-e');
    });
});

describe('AppShell — kiosk', () => {
    it('renders no chrome whatsoever', async () => {
        await renderWithI18n(
            <AppShell testID="shell" variant="kiosk" title="POS" navigation={navigation}>
                <Text testID="content">Body</Text>
            </AppShell>,
        );

        expect(screen.queryByTestId('shell-topbar')).toBeNull();
        expect(screen.queryByTestId('shell-navigation')).toBeNull();
        expect(screen.getByTestId('content')).toBeTruthy();
    });
});

describe('AppShell — driver', () => {
    it('renders a bottom tab bar with selectable tabs', async () => {
        await renderWithI18n(
            <AppShell testID="shell" variant="driver" navigation={navigation}>
                <Text>Body</Text>
            </AppShell>,
        );

        expect(screen.getByTestId('shell-tabs').props.accessibilityRole).toBe('tablist');
        expect(screen.getByTestId('nav-overview').props.accessibilityRole).toBe('tab');
        expect(screen.getByTestId('nav-overview').props.accessibilityState).toMatchObject({
            selected: true,
        });
    });
});

describe('AppShell — direction safety', () => {
    it.each(APP_SHELL_VARIANTS)('uses no physical direction utility in the %s variant', async (
        variant,
    ) => {
        await renderWithI18n(
            <AppShell testID="shell" variant={variant} title="Healthy360" navigation={navigation}>
                <Text>محتوى</Text>
            </AppShell>,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('shell'));
    });
});
