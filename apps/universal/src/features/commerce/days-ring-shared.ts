export interface DaysRingProps {
    readonly testID?: string | undefined;
    /** The figure in the middle — the days left. */
    readonly value: string;
    /** The small line under it, "days left". */
    readonly label: string;
    /** How much of the ring is drawn, 0 to 1 — the share of the balance still to come. */
    readonly share: number;
    /** What a screen reader hears for the whole ring. */
    readonly accessibilityLabel: string;
}

/** The Subscription board's balance ring: 132px with a 12px band. */
export const DAYS_RING_SIZE = 132;
export const DAYS_RING_BAND = 12;
