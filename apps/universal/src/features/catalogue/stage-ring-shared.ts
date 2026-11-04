import type { StageInkName } from '@healthy360/design-tokens';

export interface StageRingProps {
    readonly testID: string;
    /** The figure inside the ring — "520", "30g", or a dash. */
    readonly value: string;
    /** The small upper-case name under it. */
    readonly label: string;
    /** How much of the ring is drawn, 0 to 1. */
    readonly share: number;
    readonly ink: StageInkName;
    /** What a screen reader hears for the whole cell. */
    readonly accessibilityLabel: string;
}

/** The ring's outer size and stroke, the design's 64px with a 7px band. */
export const RING_SIZE = 64;
export const RING_BAND = 7;

/** The CSS variable each stage ink lives in. */
export const STAGE_INK_VAR: Readonly<Record<StageInkName, string>> = {
    orange: '--h360-color-stage-orange',
    green: '--h360-color-stage-green',
    blue: '--h360-color-stage-blue',
    yellow: '--h360-color-stage-yellow',
};
