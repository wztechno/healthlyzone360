import type { AnalyticsEvent } from './events.ts';

/**
 * Traits attached to an identified user. Deliberately tiny and non-clinical.
 * Never include email, name, health data or organisation names.
 */
export interface AnalyticsTraits {
    readonly locale?: string;
    readonly appMode?: string;
    readonly emailVerified?: boolean;
}

export interface AnalyticsClient {
    /** Records a declared event. Implementations must never throw into the caller. */
    track(event: AnalyticsEvent): void;
    /** Associates subsequent events with an opaque, server-issued user identifier. */
    identify(userId: string, traits?: AnalyticsTraits): void;
    /** Clears the identity on sign-out. Required before any provider is adopted. */
    reset(): void;
}

/** Production default until a provider is chosen and privacy-reviewed. Does nothing, silently. */
export class NoopAnalytics implements AnalyticsClient {
    track(): void {
        /* intentionally empty */
    }

    identify(): void {
        /* intentionally empty */
    }

    reset(): void {
        /* intentionally empty */
    }
}

export interface ConsoleAnalyticsOptions {
    /** Injected so tests can capture output without touching the global console. */
    readonly log?: (message: string, payload?: unknown) => void;
    readonly prefix?: string;
}

/** Development visibility only: prints events instead of sending them anywhere. */
export class ConsoleAnalytics implements AnalyticsClient {
    readonly #log: (message: string, payload?: unknown) => void;
    readonly #prefix: string;

    constructor(options: ConsoleAnalyticsOptions = {}) {
        this.#log = options.log ?? ((message, payload) => console.warn(message, payload));
        this.#prefix = options.prefix ?? '[analytics]';
    }

    track(event: AnalyticsEvent): void {
        this.#log(`${this.#prefix} ${event.name}`, event.props);
    }

    identify(userId: string, traits?: AnalyticsTraits): void {
        this.#log(`${this.#prefix} identify ${userId}`, traits);
    }

    reset(): void {
        this.#log(`${this.#prefix} reset`);
    }
}
