import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, Pressable, Text as RNText } from 'react-native';

import { assertSubtreeIsLogical, withI18n } from '../testing/render.tsx';
import { IssueTrayButton } from './issue-tray-button.tsx';
import { IssueTrayProvider, useIssueTrayController } from './issue-tray-context.tsx';
import { IssueTrayFrame } from './issue-tray.tsx';
import type { IssueCardItem } from './issue-tray.tsx';
import { spotlightElement } from './spotlight.ts';

/**
 * The issue tray: a screen passes the cards it derives from its state, and the tray draws them —
 * docked from `lg`, a bottom sheet below — with the pill in the top bar saying how much is left.
 */

function card(key: string, tone: IssueCardItem['tone'], onPress?: () => void): IssueCardItem {
    return {
        key,
        tone,
        label: `Problem ${key}`,
        detail: 'Description',
        ...(onPress === undefined ? {} : { action: { onPress } }),
        testID: `card-${key}`,
    };
}

function Page({
    items,
    checking = [],
}: {
    readonly items: readonly IssueCardItem[];
    readonly checking?: readonly { readonly key: string; readonly label: string }[];
}) {
    const controller = useIssueTrayController();
    return (
        <>
            <IssueTrayButton />
            <Pressable testID="nudge" onPress={controller.nudge} />
            <IssueTrayFrame
                controller={controller}
                tray={{
                    title: 'Publish checks',
                    testID: 'tray',
                    groups: [{ key: 'publish', title: 'Blocks publish', items }],
                    checking,
                    passed: [{ key: 'yield', label: 'Yield recorded', note: '1.46 Kg' }],
                    doneLabel: 'Ready to publish',
                }}
            >
                <RNText>The page</RNText>
            </IssueTrayFrame>
        </>
    );
}

function page(props: Parameters<typeof Page>[0], locale: 'en' | 'ar' = 'en') {
    return withI18n(
        <IssueTrayProvider>
            <Page {...props} />
        </IssueTrayProvider>,
        locale,
    );
}

const NARROW_WINDOW = Dimensions.get('window');
const NARROW_SCREEN = Dimensions.get('screen');

function deskWidth() {
    Dimensions.set({
        window: { ...NARROW_WINDOW, width: 1440, height: 900 },
        screen: { ...NARROW_SCREEN, width: 1440, height: 900 },
    });
}

afterEach(() => {
    Dimensions.set({ window: NARROW_WINDOW, screen: NARROW_SCREEN });
    jest.useRealTimers();
});

describe('the issue tray at a desk', () => {
    beforeEach(deskWidth);

    it('docks beside the page, open, with the pill counting what blocks', async () => {
        await act(async () => {
            render(page({ items: [card('a', 'danger'), card('b', 'warning'), card('c', 'info')] }));
        });

        expect(screen.getByTestId('tray-frame')).toBeTruthy();
        expect(screen.getByTestId('card-a')).toBeTruthy();
        expect(screen.getByTestId('card-b')).toBeTruthy();
        // A heads-up is drawn but never counted.
        expect(screen.getByTestId('issue-tray-button-count')).toHaveTextContent('2');
        expect(screen.getByTestId('issue-tray-button').props.accessibilityState.expanded).toBe(
            true,
        );
        // The passed checks are listed, so "done" is visible rather than merely absent.
        expect(screen.getByTestId('tray-passed')).toHaveTextContent(/Yield recorded/);
    });

    it('has no way to dismiss a card — only its fix, which is the screen’s', async () => {
        const fix = jest.fn();
        await act(async () => {
            render(page({ items: [card('a', 'warning', fix)] }));
        });

        expect(screen.queryByTestId('card-a-dismiss')).toBeNull();
        await act(async () => {
            fireEvent.press(screen.getByTestId('card-a-fix'));
        });
        expect(fix).toHaveBeenCalledTimes(1);
        // Pressing Fix does not remove the card: only the screen's state can.
        expect(screen.getByTestId('card-a')).toBeTruthy();
    });

    it('ticks a card the screen stops passing, counts it done, then lets it go', async () => {
        jest.useFakeTimers();
        const view = await render(page({ items: [card('a', 'warning'), card('b', 'warning')] }));
        expect(screen.getByTestId('tray-progress')).toHaveTextContent('1 of 3 done');

        await act(async () => {
            await view.rerender(page({ items: [card('b', 'warning')] }));
        });

        // Gone from the open set at once, still shown — green and ticked — on its way out.
        expect(screen.queryByTestId('card-a')).toBeNull();
        expect(screen.getByTestId('card-a-resolved')).toBeTruthy();
        expect(screen.getByTestId('tray-progress')).toHaveTextContent('2 of 3 done');
        expect(screen.getByTestId('issue-tray-button-count')).toHaveTextContent('1');

        await act(async () => {
            jest.advanceTimersByTime(1100);
        });
        expect(screen.queryByTestId('card-a-resolved')).toBeNull();
    });

    it('brings a card back when its fix is undone, and says All set when nothing is left', async () => {
        jest.useFakeTimers();
        const view = await render(page({ items: [card('a', 'warning')] }));

        await act(async () => {
            await view.rerender(page({ items: [] }));
        });
        await act(async () => {
            await view.rerender(page({ items: [card('a', 'warning')] }));
        });
        expect(screen.getByTestId('card-a')).toBeTruthy();
        expect(screen.queryByTestId('card-a-resolved')).toBeNull();

        await act(async () => {
            await view.rerender(page({ items: [] }));
        });
        await act(async () => {
            jest.advanceTimersByTime(1100);
        });
        expect(screen.getByTestId('tray-clear')).toHaveTextContent(/All set/);
        expect(screen.getByTestId('tray-clear')).toHaveTextContent(/Ready to publish/);
        expect(screen.getByTestId('issue-tray-button')).toHaveTextContent(/All set/);
    });

    it('does not say All set while a check is still being worked out', async () => {
        await act(async () => {
            render(page({ items: [], checking: [{ key: 'costed', label: 'Every line costed' }] }));
        });

        expect(screen.queryByTestId('tray-clear')).toBeNull();
        expect(screen.getByTestId('tray-checking')).toHaveTextContent(/Every line costed/);
        expect(screen.getByTestId('issue-tray-button')).toHaveTextContent(/Checking/);
    });

    it('closes and opens from the pill', async () => {
        await act(async () => {
            render(page({ items: [card('a', 'danger')] }));
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('issue-tray-button'));
        });
        expect(screen.queryByTestId('card-a')).toBeNull();
        await act(async () => {
            fireEvent.press(screen.getByTestId('issue-tray-button'));
        });
        expect(screen.getByTestId('card-a')).toBeTruthy();
    });

    it('is drawn with logical properties only, in Arabic too', async () => {
        await act(async () => {
            render(page({ items: [card('a', 'danger'), card('b', 'info')] }, 'ar'));
        });
        assertSubtreeIsLogical(screen.getByTestId('tray-frame'));
    });
});

describe('the issue tray on a phone', () => {
    it('is a closed sheet until something nudges it open', async () => {
        await act(async () => {
            render(page({ items: [card('a', 'danger')] }));
        });

        expect(screen.queryByTestId('tray-frame')).toBeNull();
        expect(screen.queryByTestId('card-a')).toBeNull();
        expect(screen.getByTestId('issue-tray-button-count')).toHaveTextContent('1');

        // A refused save nudges: the sheet opens on its card.
        await act(async () => {
            fireEvent.press(screen.getByTestId('nudge'));
        });
        expect(screen.getByTestId('tray-sheet')).toBeTruthy();
        expect(screen.getByTestId('card-a')).toBeTruthy();
    });
});

describe('the pill', () => {
    it('is not drawn on a page with no tray', async () => {
        await act(async () => {
            render(
                withI18n(
                    <IssueTrayProvider>
                        <IssueTrayButton />
                    </IssueTrayProvider>,
                ),
            );
        });
        expect(screen.queryByTestId('issue-tray-button')).toBeNull();
    });
});

describe('spotlightElement', () => {
    it('does nothing where there is no document to point into', () => {
        expect(() => {
            spotlightElement('anything');
        }).not.toThrow();
    });
});
