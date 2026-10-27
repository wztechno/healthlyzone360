import { Icon, cx, useMotion, useTheme } from '@healthy360/design-system';
import { createContext, useContext, useEffect, useEffectEvent, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, Easing, Text as RNText, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

/**
 * The receipt printer that sits beside Place order and Subscribe.
 *
 * Idle while the customer reviews; "Processing" while the request is out; then the receipt feeds
 * down out of the slot, a line at a time, and the screen reads "Order complete". The paper is the
 * full receipt and stays until the customer moves on.
 *
 * ## A recreation, not a port
 *
 * The reference is a web-only experiment — motion/react, CSS clip-path, SVG textures and a grey
 * ramp. None of it is copied. The motion is RN `Animated` through `useMotion()`, the colours are
 * token classes, and the torn edge is a row of rotated squares because the design system has no
 * drawing library (`react-native-svg` is a native module it declined). What *is* kept is the
 * reference's timing: the 1.75s feed and its twenty stepped stops, the 160ms glyph swap and the
 * 180ms label rise.
 *
 * ## How the paper feeds
 *
 * The paper is pinned to the bottom of a clipping window and the window grows. So the torn edge
 * comes out first, exactly as a real printer pushes paper out of a slot, and one animated height
 * does the whole job. Height cannot ride the native driver, so the feed runs on the JS thread —
 * a single value over 1.75s, which is well inside what that thread can hold.
 *
 * The animated views carry no `className`: NativeWind resolving a class on a view reads its style
 * once, which would freeze an interpolation at its first frame (see `ui/sprout-mark.tsx`).
 *
 * ## Under reduced motion it does not move
 *
 * The paper is simply there, the spinner is a still glyph, and `onPrinted` fires straight away, so
 * a flow that waits on it never stalls.
 */
export const RECEIPT_PRINTER_STAGES = ['idle', 'processing', 'printing', 'complete'] as const;
export type ReceiptPrinterStage = (typeof RECEIPT_PRINTER_STAGES)[number];
export type ReceiptFeedMotion = 'smooth' | 'stepped';

/** The reference's feed, in milliseconds. */
export const RECEIPT_FEED_MS = 1750;

/**
 * The reference's stepped feed: a short push, a pause, a short push — ten lines. These are its
 * keyframe times, and the share of the paper out of the slot at each one (its `translateY` stops
 * read as "how much is showing").
 */
const FEED_TIMES = [
    0, 0.075, 0.105, 0.18, 0.21, 0.285, 0.315, 0.39, 0.42, 0.495, 0.525, 0.6, 0.63, 0.705, 0.735,
    0.81, 0.84, 0.915, 0.945, 1,
];
const FEED_SHOWING = [
    0, 0.09, 0.09, 0.19, 0.19, 0.3, 0.3, 0.42, 0.42, 0.55, 0.55, 0.68, 0.68, 0.8, 0.8, 0.9, 0.9,
    0.97, 0.97, 1,
];

/** The glyph swap and the label rise, from the reference. */
const GLYPH_MS = 160;
const LABEL_MS = 180;
const LABEL_RISE = 4;

/** One tooth of the torn edge, in units. Its depth is half of it. */
const TOOTH = 10;

interface ReceiptPrinterContextValue {
    readonly stage: ReceiptPrinterStage;
    readonly feedMotion: ReceiptFeedMotion;
    /** Motion wanted, and allowed by the person's settings. */
    readonly move: boolean;
    readonly onPrinted: () => void;
    readonly testID: string | undefined;
}

const ReceiptPrinterContext = createContext<ReceiptPrinterContextValue | null>(null);

function useReceiptPrinter(component: string): ReceiptPrinterContextValue {
    const context = useContext(ReceiptPrinterContext);
    if (context === null) {
        throw new Error(`${component} must be used inside ReceiptPrinter.Root.`);
    }
    return context;
}

function part(testID: string | undefined, name: string): string | undefined {
    return testID === undefined ? undefined : `${testID}-${name}`;
}

const hidden = {
    'aria-hidden': true,
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants',
} as const;

/* ── root ───────────────────────────────────────────────────────────────────────────────────── */

export interface ReceiptPrinterRootProps {
    readonly stage: ReceiptPrinterStage;
    /** False draws every stage in its resting frame — a receipt that has already printed. */
    readonly animate?: boolean | undefined;
    /** Paper a line at a time (the reference), or one continuous push. */
    readonly feedMotion?: ReceiptFeedMotion | undefined;
    /** The paper is all the way out. Moves the parent to `complete`. */
    readonly onPrinted?: (() => void) | undefined;
    /** Accessible name. Defaults to "Receipt printer". */
    readonly label?: string | undefined;
    readonly children: ReactNode;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

function ReceiptPrinterRoot({
    stage,
    animate = true,
    feedMotion = 'stepped',
    onPrinted,
    label,
    children,
    className,
    testID,
}: ReceiptPrinterRootProps) {
    const { t } = useTranslation();
    const { enabled } = useMotion();
    const name = label ?? t('commerce:receipt.printerLabel');

    const context: ReceiptPrinterContextValue = {
        stage,
        feedMotion,
        move: animate && enabled,
        onPrinted: () => {
            onPrinted?.();
        },
        testID,
    };

    return (
        <ReceiptPrinterContext.Provider value={context}>
            <View
                testID={testID}
                role="group"
                aria-label={name}
                accessibilityLabel={name}
                className={cx('w-full flex-col items-center', className)}
            >
                {children}
            </View>
        </ReceiptPrinterContext.Provider>
    );
}

/* ── the machine ────────────────────────────────────────────────────────────────────────────── */

export interface ReceiptPrinterPartProps {
    readonly children?: ReactNode;
    readonly className?: string | undefined;
}

/** The body, with the slot the paper comes out of along its foot. */
function ReceiptPrinterMachine({ children, className }: ReceiptPrinterPartProps) {
    const { testID } = useReceiptPrinter('ReceiptPrinter.Machine');
    return (
        <View
            testID={part(testID, 'machine')}
            className={cx(
                'w-full rounded-2xl border border-brand-900 bg-surface-canopy p-3 pb-8 shadow-elevation-4',
                className,
            )}
        >
            {children}
            <View
                {...hidden}
                className="absolute bottom-3 end-6 start-6 h-2 rounded bg-brand-950"
            />
        </View>
    );
}

/** A row above the screen, for a mark or a light. */
function ReceiptPrinterHeader({ children, className }: ReceiptPrinterPartProps) {
    return (
        <View className={cx('mb-2 flex-row items-center justify-between', className)}>
            {children}
        </View>
    );
}

/** The inset display the status line sits in. */
function ReceiptPrinterScreen({ children, className }: ReceiptPrinterPartProps) {
    return (
        <View
            className={cx(
                'overflow-hidden rounded-lg border border-brand-950 bg-brand-950 px-4 py-3',
                className,
            )}
        >
            {children}
        </View>
    );
}

/* ── the status line ────────────────────────────────────────────────────────────────────────── */

/** Fades a child in on mount, scaling up (the glyph) or rising (the label). */
function Arrive({
    enter,
    kind,
    children,
}: {
    readonly enter: boolean;
    readonly kind: 'glyph' | 'label';
    readonly children: ReactNode;
}) {
    const { easing } = useMotion();
    const [progress] = useState(() => new Animated.Value(enter ? 0 : 1));

    useEffect(() => {
        if (!enter) return undefined;
        const animation = Animated.timing(progress, {
            toValue: 1,
            duration: kind === 'glyph' ? GLYPH_MS : LABEL_MS,
            easing: easing.decelerate,
            useNativeDriver: true,
        });
        animation.start();
        return () => {
            animation.stop();
        };
    }, [enter, kind, progress, easing]);

    if (!enter) return <View>{children}</View>;

    return (
        <Animated.View
            style={{
                opacity: progress,
                transform: [
                    kind === 'glyph'
                        ? {
                              scale: progress.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [0.94, 1],
                              }),
                          }
                        : {
                              translateY: progress.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [LABEL_RISE, 0],
                              }),
                          },
                ],
            }}
        >
            {children}
        </Animated.View>
    );
}

export interface ReceiptPrinterStatusProps {
    /** Custom wording for the current stage. Defaults to the stage's own label. */
    readonly children?: ReactNode;
    readonly className?: string | undefined;
}

function ReceiptPrinterStatus({ children, className }: ReceiptPrinterStatusProps) {
    const { t } = useTranslation();
    const { tokens } = useTheme();
    const { stage, move, testID } = useReceiptPrinter('ReceiptPrinter.Status');

    /*
     * Only a *change* of stage animates: a printer that mounts already complete (a revisited
     * confirmation) draws its last frame at once, as the reference's `initial={false}` does.
     * Tracked in state and adjusted while rendering, React's own pattern for "the previous prop".
     */
    const [seen, setSeen] = useState(stage);
    const [changed, setChanged] = useState(false);
    if (seen !== stage) {
        setSeen(stage);
        setChanged(true);
    }
    const enter = changed && move;

    const working = stage === 'processing' || stage === 'printing';
    const glyph = working ? 'working' : stage;

    return (
        <View className={cx('min-w-0 flex-row items-center gap-2.5', className)}>
            <View {...hidden} className="h-5 w-5 items-center justify-center">
                <Arrive key={glyph} enter={enter} kind="glyph">
                    {glyph === 'working' ? (
                        move ? (
                            <ActivityIndicator size="small" color={tokens.colours.onCanopyMuted} />
                        ) : (
                            <Icon
                                name="refresh"
                                size="sm"
                                className="text-content-on-canopy-muted"
                            />
                        )
                    ) : glyph === 'complete' ? (
                        <Icon name="circleCheck" size="md" className="text-brand-300" />
                    ) : (
                        <Icon name="receipt" size="md" className="text-content-on-canopy-muted" />
                    )}
                </Arrive>
            </View>
            <View
                testID={part(testID, 'status')}
                role="status"
                aria-live="polite"
                className="min-w-0 flex-1"
            >
                <Arrive key={stage} enter={enter} kind="label">
                    <RNText
                        numberOfLines={1}
                        className="text-sm font-medium leading-none text-content-on-canopy-muted text-start"
                    >
                        {children ?? t(`commerce:receipt.${stage}`)}
                    </RNText>
                </Arrive>
            </View>
        </View>
    );
}

/* ── the paper ──────────────────────────────────────────────────────────────────────────────── */

/**
 * The window the paper feeds through. It overlaps the machine's foot so the paper leaves from the
 * slot, and it is hidden from assistive technology until the receipt is complete — a half-printed
 * receipt is not something to read out.
 */
function ReceiptPrinterOutput({ children, className }: ReceiptPrinterPartProps) {
    const { easing } = useMotion();
    const { stage, feedMotion, move, onPrinted, testID } =
        useReceiptPrinter('ReceiptPrinter.Output');
    const [paperHeight, setPaperHeight] = useState(0);
    const [progress] = useState(() => new Animated.Value(stage === 'complete' ? 1 : 0));
    const printed = useEffectEvent(onPrinted);
    const measured = paperHeight > 0;

    useEffect(() => {
        if (stage !== 'printing') {
            progress.stopAnimation();
            progress.setValue(stage === 'complete' ? 1 : 0);
            return undefined;
        }
        if (!move) {
            progress.setValue(1);
            printed();
            return undefined;
        }
        // The paper has to be laid out before it can be fed: the feed is its measured height.
        if (!measured) return undefined;

        progress.setValue(0);
        const animation = Animated.timing(progress, {
            toValue: 1,
            duration: RECEIPT_FEED_MS,
            easing: feedMotion === 'stepped' ? Easing.linear : easing.emphasised,
            useNativeDriver: false,
        });
        animation.start(({ finished }) => {
            if (finished) printed();
        });
        return () => {
            animation.stop();
        };
    }, [stage, move, measured, feedMotion, easing, progress]);

    const height =
        feedMotion === 'stepped'
            ? progress.interpolate({
                  inputRange: FEED_TIMES,
                  outputRange: FEED_SHOWING.map((share) => share * paperHeight),
              })
            : progress.interpolate({ inputRange: [0, 1], outputRange: [0, paperHeight] });

    const onPaperLayout = (event: LayoutChangeEvent) => {
        const next = Math.round(event.nativeEvent.layout.height);
        if (next !== paperHeight) setPaperHeight(next);
    };

    const readable = stage === 'complete';

    return (
        <View
            testID={part(testID, 'output')}
            {...(readable ? {} : hidden)}
            className={cx('-mt-4 w-[92%] px-2', className)}
        >
            <Animated.View style={{ height, overflow: 'hidden' }}>
                <View
                    testID={part(testID, 'feed')}
                    onLayout={onPaperLayout}
                    style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}
                >
                    {children}
                </View>
            </Animated.View>
            {/* The slot's shadow on the paper as it leaves. */}
            <View
                {...hidden}
                className="absolute end-2 start-2 top-0 h-1 bg-brand-950 opacity-40"
            />
        </View>
    );
}

/** The torn bottom edge: squares turned 45° with their top halves inside the paper. */
function TornEdge() {
    const [width, setWidth] = useState(0);
    const count = Math.max(1, Math.floor(width / TOOTH));
    const tooth = width / count;
    const side = tooth / Math.SQRT2;

    return (
        <View
            {...hidden}
            onLayout={(event) => {
                const next = Math.round(event.nativeEvent.layout.width);
                if (next !== width) setWidth(next);
            }}
            className="flex-row overflow-hidden"
            style={{ height: tooth / 2 }}
        >
            {width === 0
                ? null
                : Array.from({ length: count }, (_unused, index) => (
                      <View key={index} className="items-center" style={{ width: tooth }}>
                          <View
                              className="bg-surface-raised"
                              style={{
                                  width: side,
                                  height: side,
                                  marginTop: -side / 2,
                                  transform: [{ rotate: '45deg' }],
                              }}
                          />
                      </View>
                  ))}
        </View>
    );
}

/** The receipt itself. Its content is the caller's. */
function ReceiptPrinterPaper({ children, className }: ReceiptPrinterPartProps) {
    const { testID } = useReceiptPrinter('ReceiptPrinter.Paper');
    return (
        <View testID={part(testID, 'paper')} className="flex-col">
            <View
                className={cx(
                    'border border-b-0 border-stroke-subtle bg-surface-raised px-5 pb-5 pt-7 shadow-elevation-2',
                    className,
                )}
            >
                {children}
            </View>
            <TornEdge />
        </View>
    );
}

export const ReceiptPrinter = {
    Root: ReceiptPrinterRoot,
    Machine: ReceiptPrinterMachine,
    Header: ReceiptPrinterHeader,
    Screen: ReceiptPrinterScreen,
    Status: ReceiptPrinterStatus,
    Output: ReceiptPrinterOutput,
    Paper: ReceiptPrinterPaper,
};
