import { cx } from '@healthy360/design-system';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Text as RNText, View } from 'react-native';
import type { DimensionValue } from 'react-native';

import { TINT_INK_VAR } from './range-slider-shared.ts';
import type { RangeEnds, RangeSliderProps } from './range-slider-shared.ts';
import { TINT_INK_FILL } from './shelf-tints.ts';

/**
 * The Menu board's two-handle range, on the web: two real `<input type="range">` on one track, so
 * the keyboard, the screen reader and the pointer all get the browser's own control — one handle
 * for the lower end, one for the upper. The fill between them and the handles' rings wear the
 * menu's colour.
 *
 * A handle at the end of the scale is "no limit" on that side (`null`), so a range dragged back to
 * its ends writes nothing to the URL. The handles never cross: each stops a step short of the
 * other.
 *
 * The thumbs can only be styled through pseudo-elements, so one small stylesheet is added to the
 * page the first time a range is drawn; its colours are token variables, never literals.
 */
/** How long the hand rests before a dragged value becomes the filter. */
const COMMIT_AFTER_MS = 220;

const STYLE_ID = 'h360-range-slider';
const STYLES = `
.h360-range{position:absolute;inset:0;width:100%;height:30px;margin:0;background:transparent;pointer-events:none;-webkit-appearance:none;appearance:none}
.h360-range:focus{outline:none}
.h360-range::-webkit-slider-runnable-track{background:transparent;height:30px}
.h360-range::-webkit-slider-thumb{pointer-events:auto;-webkit-appearance:none;width:22px;height:22px;margin-top:4px;border-radius:999px;background:rgb(var(--h360-color-surface-raised));border:3px solid rgb(var(--h360-range-ink));box-shadow:0 2px 6px rgb(var(--h360-color-text-primary) / 0.2);cursor:grab}
.h360-range::-moz-range-track{background:transparent}
.h360-range::-moz-range-thumb{pointer-events:auto;width:16px;height:16px;border-radius:999px;background:rgb(var(--h360-color-surface-raised));border:3px solid rgb(var(--h360-range-ink));cursor:grab}
.h360-range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px rgb(var(--h360-color-focus-ring))}
.h360-range:focus-visible::-moz-range-thumb{box-shadow:0 0 0 3px rgb(var(--h360-color-focus-ring))}
`;

function useRangeStyles(): void {
    useEffect(() => {
        if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLES;
        document.head.appendChild(style);
    }, []);
}

export function RangeSlider({
    testID,
    label,
    floor,
    ceiling,
    step,
    value,
    readout,
    readoutFor,
    tint,
    lowLabel,
    highLabel,
    onChange,
}: RangeSliderProps) {
    useRangeStyles();
    /*
     * Dragging moves the handle and the readout at once, from a draft held here; the filter (the
     * URL, and the menu's query) only takes the value once the hand rests for a moment. Committing
     * every step re-read the menu on each one, and the slider felt laggy.
     */
    const [draft, setDraft] = useState<RangeEnds | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (timer.current !== null) clearTimeout(timer.current);
        },
        [],
    );
    const move = (next: RangeEnds) => {
        setDraft(next);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            timer.current = null;
            onChange(next);
        }, COMMIT_AFTER_MS);
    };
    // Once the committed value has caught up with the draft, the draft has done its job.
    const pending =
        draft !== null && (draft.min !== value.min || draft.max !== value.max) ? draft : null;
    const shown = pending ?? value;
    const low = shown.min ?? floor;
    const high = shown.max ?? ceiling;
    const text = readoutFor === undefined || pending === null ? readout : readoutFor(pending);
    const span = ceiling - floor;
    const start = span <= 0 ? 0 : ((low - floor) / span) * 100;
    const width = span <= 0 ? 0 : ((high - low) / span) * 100;
    const ink = { ['--h360-range-ink' as string]: `var(${TINT_INK_VAR[tint]})` } as CSSProperties;

    return (
        <View testID={testID} className="mt-3 flex-col first:mt-0">
            <View className="flex-row items-baseline gap-2">
                <RNText className="me-auto text-sm font-semibold text-content-primary text-start">
                    {label}
                </RNText>
                <RNText
                    testID={`${testID}-readout`}
                    className="text-sm font-semibold tabular-nums text-content-secondary"
                >
                    {text}
                </RNText>
            </View>
            <View className="relative mt-1.5 h-[30px]">
                <View className="absolute end-0 start-0 top-[13px] h-1 rounded-full bg-stroke-subtle" />
                <View
                    className={cx('absolute top-[13px] h-1 rounded-full', TINT_INK_FILL[tint])}
                    style={{
                        start: `${String(start)}%` as DimensionValue,
                        width: `${String(width)}%` as DimensionValue,
                    }}
                />
                <input
                    type="range"
                    className="h360-range"
                    data-testid={`${testID}-low`}
                    aria-label={lowLabel}
                    aria-valuetext={text}
                    min={floor}
                    max={ceiling}
                    step={step}
                    value={low}
                    style={ink}
                    onChange={(event) => {
                        const next = Math.min(Number(event.target.value), high - step);
                        move({ min: next <= floor ? null : next, max: shown.max });
                    }}
                />
                <input
                    type="range"
                    className="h360-range"
                    data-testid={`${testID}-high`}
                    aria-label={highLabel}
                    aria-valuetext={text}
                    min={floor}
                    max={ceiling}
                    step={step}
                    value={high}
                    style={ink}
                    onChange={(event) => {
                        const next = Math.max(Number(event.target.value), low + step);
                        move({ min: shown.min, max: next >= ceiling ? null : next });
                    }}
                />
            </View>
        </View>
    );
}
