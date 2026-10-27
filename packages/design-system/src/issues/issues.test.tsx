import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Dimensions, Pressable, Text as RNText } from 'react-native';

import { useContentWidth } from '../hooks/use-content-width.tsx';
import { assertSubtreeIsLogical, withI18n } from '../testing/render.tsx';
import { IssueRevealScope, useIssueGroup } from './issue-group.tsx';
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

/** A part of the page that registers its own group — the form opening, an embedded listing. */
function Part({
    groupKey = 'part',
    items,
    onFallback,
}: {
    readonly groupKey?: string;
    readonly items: readonly IssueCardItem[];
    readonly onFallback?: () => void;
}) {
    const registered = useIssueGroup(
        { key: groupKey, title: 'From the part', items, testID: `group-${groupKey}` },
        { notes: { title: 'Part notes', lines: [{ key: 'one', text: 'A note' }] } },
    );
    if (!registered) onFallback?.();
    return registered ? null : <RNText testID="part-banner">Banner</RNText>;
}

function Host({
    own,
    part,
    partShown = true,
    reveal,
}: {
    readonly own: readonly IssueCardItem[];
    readonly part: readonly IssueCardItem[];
    readonly partShown?: boolean;
    readonly reveal?: () => void;
}) {
    return withI18n(
        <IssueTrayProvider>
            <IssueTrayButton />
            <IssueTrayFrame
                tray={{
                    title: 'To fix',
                    testID: 'tray',
                    groups: [{ key: 'save', title: 'Blocks save', items: own }],
                }}
            >
                {!partShown ? null : reveal === undefined ? (
                    <Part items={part} />
                ) : (
                    <IssueRevealScope reveal={reveal}>
                        <Part items={part} />
                    </IssueRevealScope>
                )}
            </IssueTrayFrame>
        </IssueTrayProvider>,
    );
}

describe('a group registered from inside the frame', () => {
    beforeEach(deskWidth);

    it('is drawn after the page’s own groups and counted by the pill', async () => {
        await act(async () => {
            render(Host({ own: [card('a', 'danger')], part: [card('p', 'warning')] }));
        });

        expect(screen.getByTestId('card-a')).toBeTruthy();
        expect(screen.getByTestId('group-part')).toHaveTextContent(/From the part/);
        expect(screen.getByTestId('card-p')).toBeTruthy();
        expect(screen.getByTestId('issue-tray-button-count')).toHaveTextContent('2');
        expect(screen.getByTestId('tray-notes')).toHaveTextContent(/A note/);
        // Registered, so the part draws no banner of its own.
        expect(screen.queryByTestId('part-banner')).toBeNull();
    });

    it('joins the page’s group of the same key', async () => {
        function Joined() {
            useIssueGroup({ key: 'save', title: 'Blocks save', items: [card('j', 'danger')] });
            return null;
        }
        await act(async () => {
            render(
                withI18n(
                    <IssueTrayFrame
                        tray={{
                            title: 'To fix',
                            testID: 'tray',
                            groups: [
                                {
                                    key: 'save',
                                    title: 'Blocks save',
                                    items: [card('a', 'danger')],
                                    testID: 'group-save',
                                },
                            ],
                        }}
                    >
                        <Joined />
                    </IssueTrayFrame>,
                ),
            );
        });

        expect(screen.getAllByText('Blocks save')).toHaveLength(1);
        expect(screen.getByTestId('group-save')).toHaveTextContent(/Problem a.*Problem j/);
    });

    it('ticks a card the part stops passing, like the page’s own', async () => {
        jest.useFakeTimers();
        const view = await render(Host({ own: [], part: [card('p', 'warning')] }));

        await act(async () => {
            await view.rerender(Host({ own: [], part: [] }));
        });
        expect(screen.queryByTestId('card-p')).toBeNull();
        expect(screen.getByTestId('card-p-resolved')).toBeTruthy();
    });

    it('leaves quietly when the part unmounts — nothing was fixed', async () => {
        jest.useFakeTimers();
        const view = await render(
            Host({ own: [card('a', 'danger')], part: [card('p', 'warning')] }),
        );
        expect(screen.getByTestId('issue-tray-button-count')).toHaveTextContent('2');

        await act(async () => {
            await view.rerender(
                Host({
                    own: [card('a', 'danger')],
                    part: [card('p', 'warning')],
                    partShown: false,
                }),
            );
        });
        expect(screen.queryByTestId('card-p')).toBeNull();
        expect(screen.queryByTestId('card-p-resolved')).toBeNull();
        expect(screen.queryByTestId('tray-notes')).toBeNull();
        expect(screen.getByTestId('issue-tray-button-count')).toHaveTextContent('1');
    });

    it('reveals a hidden part before running the card’s fix', async () => {
        const calls: string[] = [];
        await act(async () => {
            render(
                Host({
                    own: [],
                    part: [
                        card('p', 'warning', () => {
                            calls.push('fix');
                        }),
                    ],
                    reveal: () => {
                        calls.push('reveal');
                    },
                }),
            );
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('card-p-fix'));
        });
        expect(calls).toEqual(['reveal', 'fix']);
    });

    it('is not registered without a frame, and the part keeps its banner', async () => {
        const fallback = jest.fn();
        await act(async () => {
            render(withI18n(<Part items={[card('p', 'warning')]} onFallback={fallback} />));
        });
        expect(screen.getByTestId('part-banner')).toBeTruthy();
        expect(fallback).toHaveBeenCalled();
    });
});

describe('a list page’s tray', () => {
    beforeEach(deskWidth);

    function List({ items }: { readonly items: readonly IssueCardItem[] }) {
        return withI18n(
            <IssueTrayProvider>
                <IssueTrayButton />
                <IssueTrayFrame
                    tray={{
                        title: 'To fix',
                        testID: 'tray',
                        hideWhenClear: true,
                        groups: [{ key: 'failed', title: 'Didn’t go through', items }],
                    }}
                >
                    <RNText>The list</RNText>
                </IssueTrayFrame>
            </IssueTrayProvider>,
        );
    }

    it('draws nothing — no panel, no pill — while there is nothing to say', async () => {
        await act(async () => {
            render(List({ items: [] }));
        });
        expect(screen.queryByTestId('tray')).toBeNull();
        expect(screen.queryByTestId('issue-tray-button')).toBeNull();
    });

    it('comes in with a card, and goes once the card has ticked away', async () => {
        jest.useFakeTimers();
        const view = await render(List({ items: [card('a', 'warning')] }));
        expect(screen.getByTestId('card-a')).toBeTruthy();
        expect(screen.getByTestId('issue-tray-button-count')).toHaveTextContent('1');

        await act(async () => {
            await view.rerender(List({ items: [] }));
        });
        expect(screen.getByTestId('card-a-resolved')).toBeTruthy();

        await act(async () => {
            jest.advanceTimersByTime(1100);
        });
        expect(screen.queryByTestId('tray')).toBeNull();
        expect(screen.queryByTestId('issue-tray-button')).toBeNull();
    });
});

describe('a page that puts its tray away for a moment', () => {
    beforeEach(deskWidth);

    function Counter() {
        const [count, setCount] = useState(0);
        return (
            <Pressable
                testID="counter"
                onPress={() => {
                    setCount(count + 1);
                }}
            >
                <RNText>{String(count)}</RNText>
            </Pressable>
        );
    }

    function Host({ shown }: { readonly shown: boolean }) {
        return withI18n(
            <IssueTrayFrame tray={shown ? { title: 'To fix', testID: 'tray', groups: [] } : null}>
                <Counter />
            </IssueTrayFrame>,
        );
    }

    it('keeps the page mounted, so nothing it holds is lost', async () => {
        const view = await render(Host({ shown: true }));
        await act(async () => {
            fireEvent.press(screen.getByTestId('counter'));
        });
        expect(screen.getByTestId('counter')).toHaveTextContent('1');

        await act(async () => {
            await view.rerender(Host({ shown: false }));
        });
        expect(screen.queryByTestId('tray')).toBeNull();
        expect(screen.getByTestId('counter')).toHaveTextContent('1');

        await act(async () => {
            await view.rerender(Host({ shown: true }));
        });
        expect(screen.getByTestId('counter')).toHaveTextContent('1');
    });
});

describe('the room the docked tray leaves', () => {
    beforeEach(deskWidth);

    function Width() {
        return <RNText testID="width">{String(useContentWidth().width)}</RNText>;
    }

    it('comes out of the page’s content width, and goes back when the tray closes', async () => {
        await act(async () => {
            render(
                withI18n(
                    <IssueTrayProvider>
                        <IssueTrayButton />
                        <IssueTrayFrame
                            tray={{
                                title: 'To fix',
                                groups: [
                                    {
                                        key: 'save',
                                        title: 'Blocks save',
                                        items: [card('a', 'danger')],
                                    },
                                ],
                            }}
                        >
                            <Width />
                        </IssueTrayFrame>
                    </IssueTrayProvider>,
                ),
            );
        });
        expect(screen.getByTestId('width')).toHaveTextContent(String(1440 - 344));

        await act(async () => {
            fireEvent.press(screen.getByTestId('issue-tray-button'));
        });
        expect(screen.getByTestId('width')).toHaveTextContent('1440');
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
