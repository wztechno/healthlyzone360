/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

import { useBreakpoint } from './use-breakpoint.ts';
import { useHydrated } from './use-hydrated.ts';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions');

const mockedDimensions = useWindowDimensions as unknown as jest.Mock;

// The workspace has no `@types/react-dom`; this is the one call the test needs from it.
const { hydrateRoot } = jest.requireActual<{
    hydrateRoot: (
        container: Element,
        children: ReactNode,
        options: { onRecoverableError: (error: unknown) => void },
    ) => unknown;
}>('react-dom/client');

function Probe() {
    const hydrated = useHydrated();
    const { breakpoint } = useBreakpoint();
    return <span>{`${hydrated ? 'client' : 'server'} ${breakpoint}`}</span>;
}

/**
 * The static web export renders every page once at build time with a zero-width window. A desktop
 * browser that hydrated that HTML at its own width drew a different header and React threw error
 * 418, so the hooks have to hydrate on the build's answer and only then move to the browser's.
 */
describe('useHydrated', () => {
    it('hydrates the build-time HTML without a mismatch, then re-renders at the real width', async () => {
        mockedDimensions.mockReturnValue({ width: 1440, height: 900, scale: 1, fontScale: 1 });
        const container = document.createElement('div');
        // What the export writes for this component: no window, so the zero-width breakpoint.
        container.innerHTML = '<span>server xs</span>';
        const onRecoverableError = jest.fn();

        await act(async () => {
            hydrateRoot(container, <Probe />, { onRecoverableError });
        });

        expect(onRecoverableError).not.toHaveBeenCalled();
        expect(container.textContent).toBe('client xl');
    });
});
