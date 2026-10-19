import { RESTORE_WINDOW_MS, createScrollMemory, focusedRouteKey } from './scroll-memory.ts';

/**
 * The decision of where a page opens (browse-04), without a scroll view: the port is a spy, the
 * clock is a number the case moves.
 */
function setup() {
    let clock = 1_000;
    const port = { scrollTo: jest.fn<undefined, [number]>() };
    const memory = createScrollMemory({ now: () => clock });
    return {
        memory,
        port,
        advance: (ms: number) => {
            clock += ms;
        },
    };
}

describe('scroll memory', () => {
    it('opens a page reached by going forward at the top', () => {
        const { memory, port } = setup();
        memory.enter('meals-1', port);
        memory.scrolled(1800);

        memory.enter('meal-7', port);
        expect(port.scrollTo).toHaveBeenLastCalledWith(0);
    });

    it('opens a page returned to where the reader left it, once the page is tall enough', () => {
        const { memory, port } = setup();
        memory.enter('meals-1', port);
        memory.scrolled(1800);
        memory.enter('meal-7', port);
        memory.scrolled(300);
        port.scrollTo.mockClear();

        // Back: the menu's entry again. The port is asked for 1800 straight away …
        memory.enter('meals-1', port);
        expect(port.scrollTo).toHaveBeenLastCalledWith(1800);

        // … but the grid is still filling in, so the browser clamps it. That clamped offset is
        // not where the reader was and is not recorded; the next growth tries again.
        memory.scrolled(900);
        expect(memory.offsetOf('meals-1')).toBe(1800);
        memory.measured(port);
        expect(port.scrollTo).toHaveBeenCalledTimes(2);
        expect(port.scrollTo).toHaveBeenLastCalledWith(1800);

        // Arrived: from here on the reader's own scrolling is recorded again.
        memory.scrolled(1800);
        memory.measured(port);
        expect(port.scrollTo).toHaveBeenCalledTimes(2);
        memory.scrolled(2100);
        expect(memory.offsetOf('meals-1')).toBe(2100);
        // The meal page's own place was kept for a Forward.
        expect(memory.offsetOf('meal-7')).toBe(300);
    });

    it('treats a change on the same entry — a filter, a tab, a shelf — as no navigation', () => {
        const { memory, port } = setup();
        memory.enter('meals-1', port);
        memory.scrolled(640);
        port.scrollTo.mockClear();

        memory.enter('meals-1', port);
        expect(port.scrollTo).not.toHaveBeenCalled();
        memory.scrolled(700);
        expect(memory.offsetOf('meals-1')).toBe(700);
    });

    it('gives up a restore the page can no longer reach, and records the reader again', () => {
        const { memory, port, advance } = setup();
        memory.enter('meals-1', port);
        memory.scrolled(2400);
        memory.enter('meal-7', port);
        memory.enter('meals-1', port);

        advance(RESTORE_WINDOW_MS + 1);
        port.scrollTo.mockClear();
        memory.measured(port);
        expect(port.scrollTo).not.toHaveBeenCalled();
        memory.scrolled(500);
        expect(memory.offsetOf('meals-1')).toBe(500);
    });

    it('does nothing at all while its chrome is not the one on screen', () => {
        const { memory, port } = setup();
        memory.enter('meals-1', port);
        memory.scrolled(800);
        port.scrollTo.mockClear();

        memory.enter(null, port);
        memory.scrolled(0);
        memory.measured(port);
        expect(port.scrollTo).not.toHaveBeenCalled();
        expect(memory.offsetOf('meals-1')).toBe(800);
    });
});

describe('focusedRouteKey', () => {
    it('follows the focused route down to the page', () => {
        expect(
            focusedRouteKey({
                index: 1,
                routes: [
                    { key: 'customer-1' },
                    {
                        key: 'marketplace-1',
                        state: {
                            index: 1,
                            routes: [{ key: 'meals-1' }, { key: 'meal-7' }],
                        },
                    },
                ],
            }),
        ).toBe('meal-7');
    });

    it('stops at the deepest route that has a key yet, and is null with no state', () => {
        expect(
            focusedRouteKey({ index: 0, routes: [{ key: 'marketplace-1', state: { routes: [{}] } }] }),
        ).toBe('marketplace-1');
        expect(focusedRouteKey(undefined)).toBeNull();
    });
});
