import { act } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

/**
 * Runs part of a test at a desk's width (1440 × 900), then puts the phone shape back.
 *
 * What the issue tray needs: from `lg` it is docked beside the page and open, so its cards are on
 * screen; below `lg` it is a bottom sheet, closed until its pill is pressed — and the pill is the
 * shell's top bar, which a screen rendered on its own does not draw.
 *
 * `Dimensions.set` rather than a mocked `useBreakpoint`, as the other desk-width blocks do: the
 * layout reads the real window, and a stubbed hook would only prove the stub. Inside `act`, so a
 * screen already on the page lays itself out again at the new width.
 */
export async function withDeskWidth(run: () => Promise<void>): Promise<void> {
    const narrowWindow = Dimensions.get('window');
    const narrowScreen = Dimensions.get('screen');
    await act(async () => {
        Dimensions.set({
            window: { ...narrowWindow, width: 1440, height: 900 },
            screen: { ...narrowScreen, width: 1440, height: 900 },
        });
    });
    try {
        await run();
    } finally {
        await act(async () => {
            Dimensions.set({ window: narrowWindow, screen: narrowScreen });
        });
    }
}
