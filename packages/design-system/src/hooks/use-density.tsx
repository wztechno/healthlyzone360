import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * Density — which control ladder a subtree renders at.
 *
 * The product has two pointer stories and they do not reconcile. The kitchen admin is a desk
 * surface driven with a mouse, and the handoff sizes it from `control.ts`: 28/32/36px controls, a
 * 10–13px type ramp, 4px corners. The customer app is the phone surface, and its 44px touch floor
 * is a standing invariant (`CLAUDE.md`) that a fingertip does not negotiate away.
 *
 * One `size` prop cannot serve both — `md` cannot be 32px and 44px — so the ladder is chosen by
 * *where* a control renders rather than by what it asks for. `compact` is the Catalogue ladder;
 * `comfortable` is the customer one and is the default, so every existing call site keeps the
 * geometry it shipped with and only the admin shell opts in.
 *
 * This is also what keeps Schibsted Grotesk and IBM Plex Mono admin-only: the `font-admin` class is
 * emitted on the compact branch alone, so the customer app never loads or renders them.
 */

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

const DensityContext = createContext<Density>('comfortable');

export interface DensityProviderProps {
    readonly value: Density;
    readonly children: ReactNode;
}

/** Wrap the admin shell in `value="compact"`. Nothing else should need this. */
export function DensityProvider({ value, children }: DensityProviderProps) {
    return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity(): Density {
    return useContext(DensityContext);
}

/** Picks the compact branch of a two-branch table. Saves a ternary in every component. */
export function byDensity<T>(density: Density, table: Readonly<Record<Density, T>>): T {
    return table[density];
}
