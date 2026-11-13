import { Icon, cx, useBreakpoint } from '@healthy360/design-system';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform, Pressable, Text as RNText, View } from 'react-native';
import type { DimensionValue, ViewStyle } from 'react-native';

import { BackPill } from '../../ui/back-pill.tsx';

/**
 * The pieces the accepted "Plan setup" board is built from, shared by its four steps: the canopy
 * band that opens the page, the stepper card that overlaps it, the pane each step sits in, and the
 * three kinds of choice the board draws — a segmented row, an option tile with a radio dot, and a
 * day tile.
 */

/* ── the band ────────────────────────────────────────────────────────────────────────────────── */

export function SetupBand({
    back,
    title,
    chips,
    testID,
}: {
    readonly back: { readonly label: string; readonly onPress: () => void };
    readonly title: string;
    /** The plan at a glance; the first one is lit. */
    readonly chips: readonly string[];
    readonly testID: string;
}) {
    const [attach, bleedOn, bleedStyle] = useEdgeBleed();
    return (
        <View
            ref={attach}
            testID={testID}
            className={cx(
                'relative overflow-hidden bg-surface-canopy pb-[86px] pt-5',
                bleedOn ? '-mt-8' : 'mt-1 rounded-[30px] px-6 lg:px-8',
            )}
            style={bleedStyle}
        >
            {/* The board's two soft blobs, drifting behind the title. */}
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute -end-[120px] -top-[170px] h-[480px] w-[480px] rounded-full bg-stage-green opacity-15"
            />
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute end-[330px] top-10 hidden h-[190px] w-[190px] rounded-full bg-content-on-canopy opacity-5 lg:flex"
            />
            <View className="z-10 items-start">
                <BackPill testID={`${testID}-back`} label={back.label} onPress={back.onPress} />
                <RNText
                    testID={`${testID}-title`}
                    role="heading"
                    aria-level={1}
                    className="mt-3.5 font-display text-3xl font-bold tracking-display text-content-on-canopy text-start"
                >
                    {title}
                </RNText>
                <View testID={`${testID}-chips`} className="mt-2.5 flex-row flex-wrap gap-1.5">
                    {chips.map((chip, index) => (
                        <View
                            key={chip}
                            className={cx(
                                'h-7 justify-center rounded-full px-3',
                                index === 0 ? 'bg-surface-brand-subtle' : 'bg-content-on-canopy/10',
                            )}
                        >
                            <RNText
                                className={cx(
                                    'text-xs font-semibold tabular-nums',
                                    index === 0
                                        ? 'text-content-on-brand-subtle'
                                        : 'text-content-on-canopy',
                                )}
                            >
                                {chip}
                            </RNText>
                        </View>
                    ))}
                </View>
            </View>
        </View>
    );
}

/* ── the stepper ─────────────────────────────────────────────────────────────────────────────── */

export interface SetupStepItem {
    readonly key: string;
    readonly label: string;
    /** What the step holds so far — the plan, "Home · Lunch", "12 of 40", the total. */
    readonly sub: string;
    readonly state: 'current' | 'done' | 'todo';
    /** Not reachable yet: the earlier steps still need an answer. */
    readonly locked: boolean;
    readonly testID: string;
}

/**
 * The board's stepper: a card that overlaps the band, four numbered circles joined by a line that
 * fills as the person moves on. A step already reached is a button back to it.
 */
export function SetupStepper({
    steps,
    label,
    onSelect,
    testID,
}: {
    readonly steps: readonly SetupStepItem[];
    readonly label: string;
    readonly onSelect: (key: string) => void;
    readonly testID: string;
}) {
    return (
        <View
            testID={testID}
            role="navigation"
            aria-label={label}
            className="z-10 mx-3 -mt-[62px] flex-row gap-2 rounded-[22px] border border-stroke-subtle bg-surface-raised px-3 pb-3.5 pt-4 shadow-elevation-2 lg:mx-8"
        >
            {steps.map((step, index) => {
                const last = index === steps.length - 1;
                const fill = step.state === 'done' ? 100 : step.state === 'current' ? 50 : 0;
                return (
                    <Pressable
                        key={step.key}
                        testID={step.testID}
                        role="button"
                        accessibilityRole="button"
                        aria-current={step.state === 'current' ? 'step' : undefined}
                        accessibilityState={{
                            disabled: step.locked,
                            selected: step.state === 'current',
                        }}
                        disabled={step.locked}
                        onPress={() => {
                            onSelect(step.key);
                        }}
                        className="group relative min-w-0 flex-1 flex-col items-center gap-2 px-1.5"
                    >
                        {last ? null : (
                            <View
                                aria-hidden
                                className="absolute -end-1/2 start-1/2 top-[21px] me-[22px] ms-[30px] h-[3px] overflow-hidden rounded-full bg-stroke-subtle"
                            >
                                <View
                                    className="h-full rounded-full bg-surface-brand transition-all duration-normal ease-standard"
                                    style={{ width: `${String(fill)}%` as DimensionValue }}
                                />
                            </View>
                        )}
                        <View className="relative">
                            {/* The current step's halo, outside the circle so nothing moves. */}
                            {step.state === 'current' ? (
                                <View
                                    aria-hidden
                                    className="absolute -bottom-1.5 -end-1.5 -start-1.5 -top-1.5 rounded-full bg-surface-brand-subtle"
                                />
                            ) : null}
                            <View
                                className={cx(
                                    'h-11 w-11 items-center justify-center rounded-full border-2 transition duration-normal ease-standard',
                                    step.state === 'current'
                                        ? 'scale-105 border-surface-brand bg-surface-brand'
                                        : step.state === 'done'
                                          ? 'border-surface-brand-subtle bg-surface-brand-subtle'
                                          : cx(
                                                'border-stroke bg-surface-raised',
                                                step.locked
                                                    ? ''
                                                    : 'group-hover:border-surface-brand',
                                            ),
                                )}
                            >
                                {step.state === 'done' ? (
                                    <Icon
                                        name="check"
                                        size="sm"
                                        className="text-content-on-brand-subtle"
                                    />
                                ) : (
                                    <RNText
                                        className={cx(
                                            'font-display text-base font-bold',
                                            step.state === 'current'
                                                ? 'text-content-on-brand'
                                                : 'text-content-secondary',
                                        )}
                                    >
                                        {String(index + 1)}
                                    </RNText>
                                )}
                            </View>
                        </View>
                        <View className="w-full items-center">
                            <RNText
                                numberOfLines={1}
                                className={cx(
                                    'text-sm font-semibold',
                                    step.state === 'todo'
                                        ? 'text-content-secondary'
                                        : 'text-content-primary',
                                )}
                            >
                                {step.label}
                            </RNText>
                            <RNText
                                testID={`${step.testID}-sub`}
                                numberOfLines={1}
                                className={cx(
                                    'hidden max-w-[220px] text-xs font-medium md:flex',
                                    step.state === 'current'
                                        ? 'text-content-on-brand-subtle'
                                        : 'text-content-secondary',
                                )}
                            >
                                {step.sub}
                            </RNText>
                        </View>
                    </Pressable>
                );
            })}
        </View>
    );
}

/* ── a step's pane ───────────────────────────────────────────────────────────────────────────── */

export function SetupPane({
    title,
    titleEnd,
    children,
    testID,
}: {
    readonly title: string;
    /** What sits on the title's line — a count, the week tabs. */
    readonly titleEnd?: ReactNode;
    readonly children: ReactNode;
    readonly testID: string;
}) {
    return (
        <View
            testID={testID}
            aria-label={title}
            className="flex-col rounded-[26px] border border-stroke-subtle bg-surface-raised p-6"
        >
            <View className="flex-row flex-wrap items-center gap-2.5">
                <RNText
                    role="heading"
                    aria-level={2}
                    className="font-display text-2xl font-bold tracking-display text-content-primary text-start"
                >
                    {title}
                </RNText>
                {titleEnd}
            </View>
            {children}
        </View>
    );
}

/** The board's small uppercase label over each question. */
export function SetupLabel({ children }: { readonly children: string }) {
    return (
        <RNText className="mb-2.5 mt-[22px] text-xs font-bold uppercase tracking-wider text-content-secondary text-start">
            {children}
        </RNText>
    );
}

/* ── the choices ─────────────────────────────────────────────────────────────────────────────── */

export interface SegOption {
    readonly value: string;
    readonly title: string;
    readonly sub?: string | undefined;
    readonly testID: string;
    readonly disabled?: boolean | undefined;
}

/** One of a few, side by side in a sunken track — the board's "How long" and "Delivery window". */
export function SegChoice({
    label,
    options,
    value,
    onChange,
    testID,
}: {
    readonly label: string;
    readonly options: readonly SegOption[];
    readonly value: string | null;
    readonly onChange: (value: string) => void;
    readonly testID: string;
}) {
    return (
        <View
            testID={testID}
            role="radiogroup"
            aria-label={label}
            className="flex-row flex-wrap gap-1 rounded-2xl bg-surface-base p-1"
        >
            {options.map((option) => {
                const on = option.value === value;
                return (
                    <Pressable
                        key={option.value}
                        testID={option.testID}
                        role="radio"
                        aria-checked={on}
                        accessibilityState={{
                            checked: on,
                            selected: on,
                            disabled: option.disabled === true,
                        }}
                        disabled={option.disabled}
                        onPress={() => {
                            onChange(option.value);
                        }}
                        className={cx(
                            'min-h-14 min-w-[120px] flex-1 items-center justify-center rounded-xl px-3 py-1.5 transition duration-normal ease-standard',
                            on
                                ? 'bg-surface-raised shadow-elevation-1'
                                : 'hover:bg-surface-raised/60',
                            option.disabled === true ? 'opacity-40' : '',
                        )}
                    >
                        <RNText
                            className={cx(
                                'font-display text-base font-bold tabular-nums',
                                on ? 'text-content-primary' : 'text-content-secondary',
                                option.disabled === true ? 'line-through' : '',
                            )}
                        >
                            {option.title}
                        </RNText>
                        {option.sub === undefined ? null : (
                            <RNText
                                testID={`${option.testID}-sub`}
                                className={cx(
                                    'text-center text-xs font-semibold tabular-nums',
                                    on ? 'text-content-primary' : 'text-content-secondary',
                                )}
                            >
                                {option.sub}
                            </RNText>
                        )}
                    </Pressable>
                );
            })}
        </View>
    );
}

/** A card answer with a radio dot in its corner — the board's addresses and payment methods. */
export function OptionTile({
    chosen,
    onPress,
    testID,
    children,
    className,
}: {
    readonly chosen: boolean;
    readonly onPress: () => void;
    readonly testID: string;
    readonly children: ReactNode;
    readonly className?: string | undefined;
}) {
    return (
        <Pressable
            testID={testID}
            role="radio"
            aria-checked={chosen}
            accessibilityState={{ checked: chosen, selected: chosen }}
            onPress={onPress}
            className={cx(
                'relative min-w-[200px] flex-1 flex-col items-start gap-1 rounded-[20px] border-2 p-4 pe-11 transition duration-normal ease-standard hover:-translate-y-0.5',
                chosen
                    ? 'border-surface-brand bg-surface-brand-subtle'
                    : 'border-stroke-subtle bg-surface-raised',
                className,
            )}
        >
            <View
                aria-hidden
                className={cx(
                    'absolute end-3.5 top-3.5 h-[22px] w-[22px] items-center justify-center rounded-full border-2',
                    chosen ? 'border-surface-brand' : 'border-stroke',
                )}
            >
                <View
                    className={cx(
                        'h-2.5 w-2.5 rounded-full bg-surface-brand transition duration-normal ease-standard',
                        chosen ? 'scale-100' : 'scale-0',
                    )}
                />
            </View>
            {children}
        </Pressable>
    );
}

/** One calendar day: weekday, number, month — the board's "Start on" row. */
export function DayTile({
    top,
    big,
    bottom,
    on,
    disabled,
    onPress,
    testID,
    accessibilityLabel,
    role = 'radio',
}: {
    readonly top: string;
    readonly big: string;
    readonly bottom: string;
    readonly on: boolean;
    readonly disabled?: boolean | undefined;
    readonly onPress: () => void;
    readonly testID: string;
    readonly accessibilityLabel: string;
    readonly role?: 'radio' | 'checkbox';
}) {
    return (
        <Pressable
            testID={testID}
            role={role}
            aria-checked={on}
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ checked: on, selected: on, disabled: disabled === true }}
            disabled={disabled}
            onPress={onPress}
            className={cx(
                'h-[72px] min-w-[56px] flex-1 items-center justify-center gap-0.5 rounded-2xl border-2 transition duration-normal ease-standard',
                on
                    ? 'border-surface-brand bg-surface-brand'
                    : 'border-stroke-subtle bg-surface-raised hover:border-stroke',
                disabled === true ? 'opacity-40' : '',
            )}
        >
            <RNText
                className={cx(
                    'text-xs font-semibold',
                    on ? 'text-content-on-brand' : 'text-content-secondary',
                )}
            >
                {top}
            </RNText>
            <RNText
                className={cx(
                    'font-display text-xl font-bold tabular-nums',
                    on ? 'text-content-on-brand' : 'text-content-primary',
                )}
            >
                {big}
            </RNText>
            <RNText
                className={cx(
                    'text-xs font-semibold',
                    on ? 'text-content-on-brand' : 'text-content-secondary',
                )}
            >
                {bottom}
            </RNText>
        </Pressable>
    );
}

/**
 * The Plan setup board draws its band edge to edge under the shop bar, not as a card inside the
 * page. On the web from `md` this measures where the page column sits in the shell's scroll port
 * and pulls the band out to the port's edges — then pads it back by the same amounts, so the title
 * still lines up with the cards below. Elsewhere (native, a phone, a test) it is the rounded card.
 */
function useEdgeBleed(): readonly [(node: View | null) => void, boolean, ViewStyle | undefined] {
    const wide = useBreakpoint().atLeast('md');
    const [node, setNode] = useState<View | null>(null);
    const [edges, setEdges] = useState<{ start: number; end: number } | null>(null);

    useEffect(() => {
        if (Platform.OS !== 'web' || !wide || node === null) return undefined;
        const element = node as unknown as HTMLElement;
        const measure = () => {
            const port = element.closest('[data-testid$="-shell-content"]');
            if (port === null) return;
            const box = element.getBoundingClientRect();
            const frame = port.getBoundingClientRect();
            // The port's own width without its scrollbar, so the band never pushes it sideways.
            const inner = (port as HTMLElement).clientWidth;
            const start = Math.max(0, Math.round(box.left - frame.left));
            const end = Math.max(0, Math.round(inner - (box.left - frame.left) - box.width));
            setEdges((current) =>
                current !== null && current.start === start && current.end === end
                    ? current
                    : { start, end },
            );
        };
        measure();
        globalThis.addEventListener('resize', measure);
        return () => {
            globalThis.removeEventListener('resize', measure);
        };
    }, [node, wide]);

    const on = Platform.OS === 'web' && wide && edges !== null;
    const style: ViewStyle | undefined =
        on && edges !== null
            ? {
                  marginLeft: -edges.start,
                  marginRight: -edges.end,
                  paddingLeft: edges.start,
                  paddingRight: edges.end,
              }
            : undefined;
    return [setNode, on, style] as const;
}
