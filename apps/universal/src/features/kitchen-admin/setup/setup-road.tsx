import type { KitchenSetupStep } from '@healthy360/api-client/contracts';
import { Icon, Text, cx } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useIsRtl } from '@healthy360/i18n';
import { createElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';

/**
 * The road to opening: a stop for each required step, ending at the shop.
 *
 * ```
 *    (✓)───╮        ╭──(·)··
 *  Opening  ╰─(✓)──(○)      ··[shop]
 *  hours    Delivery Menu  Prices  Go live
 * ```
 *
 * The green runs through the unbroken run of finished steps from the start, so a step finished out
 * of order lights its own stop without implying the ones before it are done.
 *
 * Exactly four stops fit the drawn curve; `canDrawRoad` says so, and the page draws its list of steps
 * for anything else. The curve itself is an SVG on the web only: native has none in this repo.
 */

/** The curve in its own coordinates, and where each stop sits on it, as shares of the box. */
const ROAD_WIDTH = 1040;
const ROAD_HEIGHT = 300;
const ROAD_PATH =
    'M 50 215 C 150 60, 240 50, 330 150 C 420 250, 510 260, 590 160 C 670 60, 760 40, 850 130 C 900 180, 950 170, 985 120';
const STOPS = [
    { x: 4.81, y: 71.67 },
    { x: 28.35, y: 38.88 },
    { x: 50.43, y: 72.23 },
    { x: 71.54, y: 24.33 },
] as const;
const END = { x: 94.71, y: 40 } as const;
/** How far along the curve the green runs for 0–4 finished stops. */
const PROGRESS = [0, 27, 51, 75, 75] as const;

const STOP_WIDTH = 130;
const NODE_SIZE = 74;
const END_SIZE = 96;

export const SETUP_STEP_ICONS: Readonly<Record<KitchenSetupStep['key'], IconName>> = {
    hours: 'clock',
    delivery: 'truck',
    menu: 'utensils',
    prices: 'tag',
    team: 'users',
};

export function canDrawRoad(required: readonly KitchenSetupStep[]): boolean {
    return required.length === STOPS.length;
}

/** The unbroken run of finished steps from the start. */
export function roadProgress(required: readonly KitchenSetupStep[], isLive: boolean): number {
    if (isLive) return 100;
    const firstOpen = required.findIndex((step) => !step.done);
    const run = firstOpen === -1 ? required.length : firstOpen;
    return PROGRESS[run] ?? 0;
}

export interface SetupRoadProps {
    /** The required steps, in the order the server lists them. */
    readonly steps: readonly KitchenSetupStep[];
    readonly isLive: boolean;
    readonly onOpen: (step: KitchenSetupStep) => void;
    readonly testID: string;
}

export function SetupRoad({ steps, isLive, onOpen, testID }: SetupRoadProps) {
    const { t } = useTranslation();
    const isRtl = useIsRtl();
    const next = isLive ? undefined : steps.find((step) => !step.done);
    const ready = !isLive && next === undefined;
    // `left` is physical, so the road is mirrored by hand for an Arabic reader.
    const across = (x: number): `${number}%` => `${isRtl ? 100 - x : x}%`;

    return (
        <View
            testID={testID}
            className="rounded-panel border border-stroke-subtle bg-surface-raised px-6 pb-6 pt-3"
            style={
                Platform.OS === 'web'
                    ? ({
                          backgroundImage:
                              'radial-gradient(rgb(var(--h360-color-border-strong) / 0.5) 1.2px, transparent 1.2px)',
                          backgroundSize: '22px 22px',
                      } as object)
                    : undefined
            }
        >
            <View style={{ aspectRatio: ROAD_WIDTH / ROAD_HEIGHT }}>
                <RoadLine progress={roadProgress(steps, isLive)} mirrored={isRtl} />

                {steps.map((step, index) => {
                    const stop = STOPS[index];
                    if (stop === undefined) return null;
                    const isNext = step.key === next?.key;
                    const title = t(`kitchen:setup.step.${step.key}.title`);
                    const state = t(
                        step.done ? 'kitchen:wholesale.done' : 'kitchen:wholesale.todo',
                    );
                    return (
                        <View
                            key={step.key}
                            className="absolute items-center"
                            style={{
                                left: across(stop.x),
                                top: `${stop.y}%`,
                                width: STOP_WIDTH,
                                marginLeft: -STOP_WIDTH / 2,
                                marginTop: -NODE_SIZE / 2,
                            }}
                        >
                            <Pressable
                                testID={`${testID}-${step.key}`}
                                role="link"
                                aria-label={`${title}, ${state}`}
                                accessibilityLabel={`${title}, ${state}`}
                                onPress={() => {
                                    onOpen(step);
                                }}
                                style={{ width: NODE_SIZE, height: NODE_SIZE }}
                                className={cx(
                                    'items-center justify-center rounded-full',
                                    step.done
                                        ? 'bg-surface-brand'
                                        : isNext
                                          ? 'border-[3px] border-surface-brand bg-surface-brand-subtle'
                                          : 'border-2 border-dashed border-stroke-strong bg-surface-raised',
                                )}
                                {...(isNext ? { dataSet: { setupRoad: 'next' } } : {})}
                            >
                                <Icon
                                    name={SETUP_STEP_ICONS[step.key]}
                                    size="lg"
                                    className={
                                        step.done
                                            ? 'text-content-on-brand'
                                            : isNext
                                              ? 'text-content-on-brand-subtle'
                                              : 'text-content-secondary'
                                    }
                                />
                                {step.done ? (
                                    <View
                                        testID={`${testID}-${step.key}-done`}
                                        className="absolute -end-0.5 -top-0.5 h-6 w-6 items-center justify-center rounded-full border-2 border-surface-brand bg-surface-raised"
                                    >
                                        <Icon
                                            name="check"
                                            size="sm"
                                            className="text-content-on-brand-subtle"
                                        />
                                    </View>
                                ) : null}
                            </Pressable>
                            <View className="mt-2 rounded-full bg-surface-raised px-2.5 py-0.5">
                                <Text
                                    variant="label"
                                    className={cx(
                                        'font-bold',
                                        isNext ? 'text-content-on-brand-subtle' : null,
                                    )}
                                    numberOfLines={1}
                                >
                                    {title}
                                </Text>
                            </View>
                        </View>
                    );
                })}

                <View
                    testID={`${testID}-end`}
                    className="absolute items-center"
                    style={{
                        left: across(END.x),
                        top: `${END.y}%`,
                        width: STOP_WIDTH,
                        marginLeft: -STOP_WIDTH / 2,
                        marginTop: -END_SIZE / 2,
                    }}
                >
                    <View
                        style={{ width: END_SIZE, height: END_SIZE }}
                        className={cx(
                            'items-center justify-center rounded-3xl',
                            isLive
                                ? 'bg-surface-brand'
                                : ready
                                  ? 'bg-warning-subtle'
                                  : 'bg-surface-sunken',
                        )}
                        {...(ready ? { dataSet: { setupRoad: 'next' } } : {})}
                    >
                        <Icon
                            name="store"
                            size="lg"
                            className={
                                isLive
                                    ? 'text-content-on-brand'
                                    : ready
                                      ? 'text-warning-on'
                                      : 'text-content-secondary'
                            }
                        />
                    </View>
                    <View className="mt-2 rounded-full bg-surface-raised px-2.5 py-0.5">
                        <Text variant="label" className="font-bold" numberOfLines={1}>
                            {t(isLive ? 'kitchen:setup.open' : 'kitchen:setup.goLive')}
                        </Text>
                    </View>
                </View>
            </View>
        </View>
    );
}

/** The dotted road and the green over it. Web only; the stops still read in order without it. */
function RoadLine({
    progress,
    mirrored,
}: {
    readonly progress: number;
    readonly mirrored: boolean;
}) {
    if (Platform.OS !== 'web') return null;

    const common = {
        d: ROAD_PATH,
        fill: 'none',
        strokeLinecap: 'round',
        strokeWidth: 10,
        pathLength: 100,
    };
    return createElement(
        'svg',
        {
            viewBox: `0 0 ${String(ROAD_WIDTH)} ${String(ROAD_HEIGHT)}`,
            'aria-hidden': true,
            style: {
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                overflow: 'visible',
                ...(mirrored ? { transform: 'scaleX(-1)' } : {}),
            },
        },
        createElement('path', {
            ...common,
            stroke: 'rgb(var(--h360-color-border-strong))',
            strokeDasharray: '0.1 1.6',
        }),
        createElement('path', {
            ...common,
            stroke: 'rgb(var(--h360-color-brand-surface))',
            strokeDasharray: `${String(progress)} 100`,
            style: { transition: 'stroke-dasharray .7s cubic-bezier(.22,1,.36,1)' },
        }),
    );
}
