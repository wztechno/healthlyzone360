import { Dialog, useToastInset } from '@healthy360/design-system';
import {
    Fragment,
    createContext,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { DeskButton } from './desk-kit/desk-button.tsx';

/**
 * The save bar (Toasts / pop-ups / banners canvas, Editor header board, 2026-11-11):
 *
 * ```
 *  ┌────────────────────────────────────────────────────────────────┐
 *  │ ●  Unsaved changes · 2 to fix                 [ Discard ] [Save] │   pinned to the page's foot
 *  └────────────────────────────────────────────────────────────────┘
 * ```
 *
 * It replaces the amber "Unsaved changes" chip that sat beside an editor's title, and takes the
 * editor's Save with it: the commit lives where the reader finishes, not at the top of a form
 * they have scrolled away from. It is there only while there is something to save — a record with
 * changes, or a new one that has never been saved.
 *
 * ## One slot, many editors
 *
 * The bar is drawn once, at the end of the kitchen's content (`KitchenOpsShell`), so `web:sticky`
 * holds it at the foot of the scroll port. An editor states what it is through {@link useSaveBar};
 * the slot draws whatever the page on screen stated. Outside a {@link SaveBarProvider} — a screen
 * rendered alone, as the suites render them — nothing is registered and the hook says so, so the
 * editor keeps its chip and its own Save where they were.
 *
 * The toasts rise above it while it shows (`useToastInset`), so a "Saved" never covers the bar.
 */
export interface SaveBarAction {
    readonly label: string;
    readonly onPress: () => void;
    readonly testID: string;
    readonly loading?: boolean | undefined;
    readonly disabled?: boolean | undefined;
}

export interface SaveBarState {
    /** Changes not yet saved. */
    readonly dirty: boolean;
    /** A record never saved: the bar stays, since saving is the only way it comes to exist. */
    readonly creating?: boolean | undefined;
    /** What stops the save — "· 2 to fix". */
    readonly toFix?: number | undefined;
    readonly save?: SaveBarAction | undefined;
    /** Puts the form back as it was loaded. Without one there is no Discard. */
    readonly discard?: SaveBarAction | undefined;
    readonly testID: string;
}

interface Registered {
    readonly owner: object;
    readonly state: SaveBarState;
}

interface SaveBarContextValue {
    readonly current: Registered | null;
    readonly set: (owner: object, state: SaveBarState | null) => void;
}

const SaveBarContext = createContext<SaveBarContextValue | undefined>(undefined);

export function SaveBarProvider({ children }: { readonly children: ReactNode }) {
    const [current, setCurrent] = useState<Registered | null>(null);
    // Stable, so a page re-registering its bar does not hand every page a new setter — which
    // would re-run their registrations and loop.
    const [set] = useState(() => (owner: object, state: SaveBarState | null) => {
        setCurrent((previous) => {
            if (state === null) return previous?.owner === owner ? null : previous;
            return { owner, state };
        });
    });
    const value = useMemo<SaveBarContextValue>(() => ({ current, set }), [current, set]);
    return <SaveBarContext.Provider value={value}>{children}</SaveBarContext.Provider>;
}

/**
 * ## Discard
 *
 * Discard puts the page back as it was last saved, and keeps the reader on it. Every editor already
 * fills its form from the saved record when it opens, so the one way to do that for all of them is
 * to open the page again: {@link DiscardBoundary} wraps the kitchen's pages and draws them afresh
 * from the cached record. An editor that keeps a draft of its own across a reload (the recipe and
 * ingredient pages) clears it first through {@link useBeforeDiscard}, or the draft would come
 * straight back. The bar asks before it throws anything away.
 */
interface DiscardContextValue {
    readonly discard: () => void;
    readonly onBefore: (run: () => void) => () => void;
}

const DiscardContext = createContext<DiscardContextValue | undefined>(undefined);

/** Draws its page afresh when the save bar's Discard is confirmed. */
export function DiscardBoundary({ children }: { readonly children: ReactNode }) {
    const [generation, setGeneration] = useState(0);
    const [befores] = useState(() => new Set<() => void>());
    const [value] = useState<DiscardContextValue>(() => ({
        discard: () => {
            for (const run of befores) run();
            setGeneration((current) => current + 1);
        },
        onBefore: (run) => {
            befores.add(run);
            return () => {
                befores.delete(run);
            };
        },
    }));
    return (
        <DiscardContext.Provider value={value}>
            <Fragment key={generation}>{children}</Fragment>
        </DiscardContext.Provider>
    );
}

/** Runs just before Discard redraws the page — to drop a draft that would otherwise return. */
export function useBeforeDiscard(run: () => void): void {
    const context = useContext(DiscardContext);
    const latest = useRef(run);
    useLayoutEffect(() => {
        latest.current = run;
    });
    useEffect(
        () =>
            context?.onBefore(() => {
                latest.current();
            }),
        [context],
    );
}

/**
 * States this page's save bar. Returns whether a bar is drawn for it — `false` outside the
 * kitchen layout, where the caller keeps its own chip and Save.
 *
 * Callbacks are read at press time, so inline closures do not re-register the bar every render.
 */
export function useSaveBar(given: SaveBarState | null): boolean {
    const { t } = useTranslation();
    const context = useContext(SaveBarContext);
    const discarding = useContext(DiscardContext);
    const set = context?.set;
    const [owner] = useState(() => ({}));
    // Under a DiscardBoundary every page with changes gets the Discard that redraws it.
    const state: SaveBarState | null =
        given === null || given.discard !== undefined || discarding === undefined || !given.dirty
            ? given
            : {
                  ...given,
                  discard: {
                      testID: `${given.testID}-discard`,
                      label: t('kitchen:saveBar.discard'),
                      onPress: discarding.discard,
                  },
              };
    const latest = useRef(state);
    useLayoutEffect(() => {
        latest.current = state;
    });

    // Stable presses that call whatever the page handed over last.
    const [onSave] = useState(() => () => {
        latest.current?.save?.onPress();
    });
    const [onDiscard] = useState(() => () => {
        latest.current?.discard?.onPress();
    });
    const shape = (action: SaveBarAction | undefined) =>
        action === undefined
            ? null
            : [action.label, action.testID, action.loading ?? false, action.disabled ?? false];
    const signature =
        state === null
            ? null
            : JSON.stringify([
                  state.dirty,
                  state.creating ?? false,
                  state.toFix ?? 0,
                  state.testID,
                  shape(state.save),
                  shape(state.discard),
              ]);

    useEffect(() => {
        if (set === undefined) return undefined;
        const now = latest.current;
        set(
            owner,
            now === null
                ? null
                : {
                      ...now,
                      ...(now.save === undefined ? {} : { save: { ...now.save, onPress: onSave } }),
                      ...(now.discard === undefined
                          ? {}
                          : { discard: { ...now.discard, onPress: onDiscard } }),
                  },
        );
        return undefined;
        // The signature stands for the state; the page's closures are read through `latest`.
    }, [set, owner, signature, onSave, onDiscard]);
    useEffect(
        () => () => {
            set?.(owner, null);
        },
        [set, owner],
    );

    return set !== undefined && state !== null;
}

/** Height the bar takes at the foot of the page, which the toasts rise above. */
const BAR_LIFT = 72;

/** Where the bar is drawn: the end of the kitchen's content. */
export function SaveBarSlot() {
    const { t } = useTranslation();
    const state = useContext(SaveBarContext)?.current?.state ?? null;
    const shown = state !== null && (state.dirty || state.creating === true);
    const [confirming, setConfirming] = useState(false);
    useToastInset(shown ? BAR_LIFT : 0);
    if (!shown) return null;
    const discard = state.discard;

    const toFix = state.toFix ?? 0;
    return (
        <View
            testID={`${state.testID}-save-bar`}
            role="region"
            aria-label={t('kitchen:saveBar.label')}
            className="z-20 mt-4 w-full flex-row items-center gap-2.5 self-center rounded-2xl border border-stroke-subtle bg-surface-raised py-2.5 pe-2.5 ps-4 shadow-elevation-4 web:sticky web:bottom-4"
        >
            <View
                aria-hidden
                className={`h-2 w-2 rounded-full ${state.dirty ? 'bg-warning-strong' : 'bg-content-disabled'}`}
            />
            <RNText
                testID={`${state.testID}-save-bar-status`}
                aria-live="polite"
                className="min-w-0 flex-1 text-sm font-semibold text-content-primary text-start"
            >
                {state.dirty ? t('kitchen:saveBar.unsaved') : t('kitchen:saveBar.notSavedYet')}
                {toFix > 0 ? ` · ${t('kitchen:saveBar.toFix', { count: toFix })}` : ''}
            </RNText>
            {discard === undefined ? null : (
                <DeskButton
                    testID={discard.testID}
                    variant="secondary"
                    label={discard.label}
                    loading={discard.loading}
                    disabled={discard.disabled}
                    onPress={() => {
                        setConfirming(true);
                    }}
                />
            )}
            {state.save === undefined ? null : (
                <DeskButton
                    testID={state.save.testID}
                    label={state.save.label}
                    loading={state.save.loading}
                    disabled={state.save.disabled}
                    onPress={state.save.onPress}
                />
            )}
            {/* Throwing work away is the one thing here that cannot be taken back: ask first. */}
            <Dialog
                look="card"
                testID={`${state.testID}-discard-dialog`}
                open={confirming && discard !== undefined}
                onClose={() => {
                    setConfirming(false);
                }}
                title={t('kitchen:saveBar.discardTitle')}
                description={t('kitchen:saveBar.discardBody')}
                actions={
                    <>
                        <DeskButton
                            testID={`${state.testID}-discard-keep`}
                            variant="secondary"
                            label={t('kitchen:saveBar.keepEditing')}
                            onPress={() => {
                                setConfirming(false);
                            }}
                        />
                        <DeskButton
                            testID={`${state.testID}-discard-confirm`}
                            variant="danger"
                            label={t('kitchen:saveBar.discard')}
                            onPress={() => {
                                setConfirming(false);
                                discard?.onPress();
                            }}
                        />
                    </>
                }
            />
        </View>
    );
}
