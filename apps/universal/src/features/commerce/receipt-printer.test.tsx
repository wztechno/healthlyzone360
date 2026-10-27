import { createI18n } from '@healthy360/i18n';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { act } from 'react';
import { I18nextProvider } from 'react-i18next';
import { AccessibilityInfo, Animated, Text } from 'react-native';

import { RECEIPT_FEED_MS, ReceiptPrinter } from './receipt-printer.tsx';
import type { ReceiptPrinterStage } from './receipt-printer.tsx';

/**
 * The checkout's receipt printer.
 *
 * The stepped curve itself is not frozen here — it is a transcription of the reference, and a test
 * of its twenty stops would only preserve today's numbers. What is defended is what a flow relies
 * on: the status line says each stage, the receipt is not read out half-printed, the feed is the
 * paper's own height over the reference's 1.75s, and `onPrinted` always arrives — at once under
 * reduced motion — because checkout and Subscribe wait on it before they offer the next step.
 */

const i18n = createI18n({ locale: 'en' });

const HIDDEN = { includeHiddenElements: true } as const;

function Printer({
    stage,
    onPrinted,
}: {
    readonly stage: ReceiptPrinterStage;
    readonly onPrinted?: () => void;
}) {
    return (
        <I18nextProvider i18n={i18n}>
            <ReceiptPrinter.Root testID="printer" stage={stage} onPrinted={onPrinted}>
                <ReceiptPrinter.Machine>
                    <ReceiptPrinter.Screen>
                        <ReceiptPrinter.Status />
                    </ReceiptPrinter.Screen>
                </ReceiptPrinter.Machine>
                <ReceiptPrinter.Output>
                    <ReceiptPrinter.Paper>
                        <Text>Order H360-1042</Text>
                    </ReceiptPrinter.Paper>
                </ReceiptPrinter.Output>
            </ReceiptPrinter.Root>
        </I18nextProvider>
    );
}

/** The paper is laid out off-screen in the window it feeds through; Jest has no layout pass. */
async function layOutPaper(height: number) {
    await fireEvent(screen.getByTestId('printer-feed', HIDDEN), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 240, height } },
    });
}

function isHidden(testID: string): boolean {
    return screen.getByTestId(testID, HIDDEN).props['aria-hidden'] === true;
}

/** Every timing finishes the moment it starts, and is recorded. */
function instantTimings() {
    return jest.spyOn(Animated, 'timing').mockImplementation(
        () =>
            ({
                start: (callback?: Animated.EndCallback) => {
                    callback?.({ finished: true });
                },
                stop: () => undefined,
                reset: () => undefined,
            }) as Animated.CompositeAnimation,
    );
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe('ReceiptPrinter', () => {
    it('names itself and says each stage on its status line', async () => {
        const view = await render(<Printer stage="idle" />);
        await act(async () => undefined);

        expect(screen.getByTestId('printer').props.accessibilityLabel).toBe('Receipt printer');
        expect(screen.getByTestId('printer-status').props.role).toBe('status');
        expect(screen.getByText('Ready to print')).toBeOnTheScreen();

        await view.rerender(<Printer stage="processing" />);
        expect(screen.getByText('Processing your order')).toBeOnTheScreen();

        await view.rerender(<Printer stage="printing" />);
        expect(screen.getByText('Printing your receipt')).toBeOnTheScreen();

        await view.rerender(<Printer stage="complete" />);
        expect(screen.getByText('Order complete')).toBeOnTheScreen();
    });

    it('keeps the receipt from assistive technology until it has printed', async () => {
        const view = await render(<Printer stage="processing" />);
        await act(async () => undefined);
        expect(isHidden('printer-output')).toBe(true);

        await view.rerender(<Printer stage="printing" />);
        expect(isHidden('printer-output')).toBe(true);

        await view.rerender(<Printer stage="complete" />);
        expect(isHidden('printer-output')).toBe(false);
        expect(screen.getByText('Order H360-1042')).toBeOnTheScreen();
    });

    it('feeds the paper over the reference’s 1.75s once it is measured, then says so', async () => {
        const timing = instantTimings();
        const onPrinted = jest.fn();
        await render(<Printer stage="printing" onPrinted={onPrinted} />);
        await act(async () => undefined);

        // Nothing to feed until the paper has a height.
        const feeds = () =>
            timing.mock.calls.filter(([, config]) => config.duration === RECEIPT_FEED_MS);
        expect(feeds()).toHaveLength(0);
        expect(onPrinted).not.toHaveBeenCalled();

        await act(async () => {
            await layOutPaper(320);
        });

        expect(feeds()).toHaveLength(1);
        // Height cannot ride the native driver.
        expect(feeds()[0]?.[1].useNativeDriver).toBe(false);
        expect(onPrinted).toHaveBeenCalledTimes(1);
    });

    it('prints at once under reduced motion, without waiting for a layout', async () => {
        jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
        const timing = jest.spyOn(Animated, 'timing');
        const onPrinted = jest.fn();

        const view = await render(<Printer stage="processing" onPrinted={onPrinted} />);
        await act(async () => undefined);
        await view.rerender(<Printer stage="printing" onPrinted={onPrinted} />);
        await act(async () => undefined);

        expect(onPrinted).toHaveBeenCalledTimes(1);
        expect(
            timing.mock.calls.filter(([, config]) => config.duration === RECEIPT_FEED_MS),
        ).toHaveLength(0);
    });
});
