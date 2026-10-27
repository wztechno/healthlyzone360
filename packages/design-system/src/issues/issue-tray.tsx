import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Text as RNText, View } from 'react-native';

import { Button } from '../actions/button.tsx';
import { IconButton } from '../actions/icon-button.tsx';
import { useBreakpoint } from '../hooks/use-breakpoint.ts';
import { ContentWidthBeside } from '../hooks/use-content-width.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { Collapse } from '../motion/collapse.tsx';
import { SlideIn } from '../motion/slide-in.tsx';
import { useMotion } from '../motion/use-motion.ts';
import { Drawer } from '../overlays/drawer.tsx';
import { createIssueRegistry, IssueRegistryProvider } from './issue-group.tsx';
import type { IssueRegistry, RegisteredIssues } from './issue-group.tsx';
import { IssueTrayFrameControllerProvider, useIssueTrayController } from './issue-tray-context.tsx';
import type { IssueTone, IssueTrayController, IssueTraySummary } from './issue-tray-context.tsx';

/**
 * The issue tray — one fixed place that says what still stands between a page and done.
 *
 * ```
 *  [ To fix 2 ]  ← the top bar's pill (IssueTrayButton)
 *
 *  ┌ Publish checks ─────────── 3 of 5 done ✕ ┐
 *  │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ │
 *  │ Blocks publish                           │
 *  │ △ Arabic name missing            [ Fix ] │
 *  │   Description                            │
 *  │ Passed                                   │
 *  │ ✓ Yield recorded              1.46 Kg    │
 *  └──────────────────────────────────────────┘
 * ```
 *
 * It replaces the strips, callouts and rails a form used to stack above its tabs — the same
 * problem said in four places — with one panel beside the page from `lg` and a bottom sheet below.
 *
 * ## The screen says what is wrong; the tray never decides it
 *
 * A screen passes the cards it derives from its live state, every render, exactly as it used to
 * build a banner's chips. The tray holds no list of its own, so it cannot drift from the form.
 *
 * ## A card is never dismissed — it clears itself
 *
 * There is no close button on a card. A card leaves when the screen stops passing it — because the
 * field is filled, the server says the gap is closed — and on the way out it turns green, ticks,
 * and folds away, so the reader sees their fix land. That is the only way a card goes.
 *
 * ## Fix takes the reader there
 *
 * A card's action is the screen's: it switches the tab, scrolls, focuses and spotlights the field,
 * or opens the page the fix is on. The tray only calls it — closing itself first below `lg`, where
 * the sheet would cover the field it is pointing at.
 *
 * ## Parts of the page add their own
 *
 * A component inside the frame — the shared form opening, a listing embedded in a tab — registers
 * its cards with `useIssueGroup` rather than drawing a banner. They are drawn after the page's own
 * groups; a group sharing a key with one of the page's joins it. See `issue-group.tsx`.
 */

export interface IssueAction {
    /** Defaults to "Fix". */
    readonly label?: string | undefined;
    readonly onPress: () => void;
    readonly loading?: boolean | undefined;
    readonly testID?: string | undefined;
}

export interface IssueCardItem {
    readonly key: string;
    readonly tone: IssueTone;
    /** What is wrong, in a few words — the card's whole message. */
    readonly label: string;
    /** Where it is: the tab and section, or whose problem it is. */
    readonly detail?: string | undefined;
    /** The way to fix it. Without one the card only states; it still clears itself. */
    readonly action?: IssueAction | undefined;
    /** A second, quieter way out — "Back to stock gaps" beside "Publish". */
    readonly secondaryAction?: IssueAction | undefined;
    readonly testID?: string | undefined;
}

export interface IssueGroup {
    readonly key: string;
    /** "Blocks save", "Blocks publish", "Selling" — what the cards in it stop. */
    readonly title: string;
    readonly items: readonly IssueCardItem[];
    readonly testID?: string | undefined;
}

export interface IssuePassedItem {
    readonly key: string;
    readonly label: string;
    readonly note?: string | undefined;
    readonly testID?: string | undefined;
}

export interface IssueNotes {
    readonly title: string;
    readonly lines: readonly {
        readonly key: string;
        readonly text: string;
        readonly testID?: string | undefined;
    }[];
    readonly testID?: string | undefined;
}

export interface IssueTrayContent {
    readonly title: string;
    readonly groups: readonly IssueGroup[];
    /** Checks already met — the green half of the reading, so "done" is visible, not just absent. */
    readonly passed?: readonly IssuePassedItem[] | undefined;
    /**
     * Checks still being worked out — a cost the server has not answered. Neither a pass nor a
     * problem yet, so the tray does not say "All set" while one is open.
     */
    readonly checking?:
        | readonly { readonly key: string; readonly label: string; readonly testID?: string }[]
        | undefined;
    /** Facts with nothing to fix — an import's notes. Never counted, never blocking. */
    readonly notes?: IssueNotes | undefined;
    /** Whose problems these are, when the page was opened from another — "For Bbq Sauce Dip". */
    readonly context?: { readonly label: string; readonly testID?: string | undefined } | undefined;
    /** Under "All set": what finishing means here — "Ready to publish". */
    readonly doneLabel?: string | undefined;
    /** Under "All set": where to go next — back to the page that sent the reader here. */
    readonly doneAction?: IssueAction | undefined;
    /**
     * A list's or a desk's tray, drawn only while it has something to say: an open card, one still
     * ticking away, a check still running, a note. A form keeps its tray to say "All set"; a list
     * page has no "done" to show, and a docked panel saying so beside every list is noise.
     */
    readonly hideWhenClear?: boolean | undefined;
    readonly testID?: string | undefined;
}

export interface IssueTrayFrameProps {
    /** The page's tray, or `null` for none (still loading, nothing to check on this page). */
    readonly tray: IssueTrayContent | null;
    /** Pass the screen's own controller when it needs to `nudge()`; otherwise the frame takes one. */
    readonly controller?: IssueTrayController | undefined;
    readonly children: ReactNode;
    readonly testID?: string | undefined;
}

const TONE_ICON: Readonly<Record<IssueTone, IconName>> = {
    danger: 'circleX',
    warning: 'alert',
    info: 'infoCircle',
};

const TONE_MARK: Readonly<Record<IssueTone, string>> = {
    danger: 'text-danger',
    warning: 'text-warning',
    info: 'text-info',
};

/** How long a fixed card shows its tick before it folds away, and when it is gone. */
const TICK_MS = 600;
const GONE_MS = 1000;

/** The docked panel's column and the gap before it: `w-80` and `gap-6`. */
const DOCKED_WIDTH = 344;

const NO_GROUPS: readonly IssueGroup[] = [];
const NO_KEYS: readonly string[] = [];

/**
 * The page with its tray: docked beside the content from `lg`, a bottom sheet below. The screen's
 * own root (its `Cascade`) goes inside as `children`, so the page still arrives as it always has.
 */
export function IssueTrayFrame(props: IssueTrayFrameProps) {
    const own = useIssueTrayController();
    const tray$ = props.controller ?? own;
    const [registry] = useState(createIssueRegistry);
    return (
        <IssueRegistryProvider value={registry}>
            <IssueTrayFrameControllerProvider value={tray$}>
                <IssueTrayFrameBody {...props} controller={tray$} registry={registry} />
            </IssueTrayFrameControllerProvider>
        </IssueRegistryProvider>
    );
}

/** The page's tray as drawn: its own groups, then what the parts inside it registered. */
interface MergedTray extends Omit<IssueTrayContent, 'notes'> {
    readonly notes: readonly IssueNotes[];
    /** The keys of the groups only a registration brought, which leave with it untallied. */
    readonly registeredKeys: readonly string[];
}

function mergeTray(tray: IssueTrayContent, registered: readonly RegisteredIssues[]): MergedTray {
    const groups: IssueGroup[] = [...tray.groups];
    for (const { group } of registered) {
        const at = groups.findIndex((entry) => entry.key === group.key);
        const existing = groups[at];
        if (existing === undefined) groups.push(group);
        else
            groups[at] = {
                ...existing,
                items: [...existing.items, ...group.items],
                testID: existing.testID ?? group.testID,
            };
    }
    return {
        ...tray,
        groups,
        passed: [...(tray.passed ?? []), ...registered.flatMap((entry) => entry.passed ?? [])],
        notes: [tray.notes, ...registered.map((entry) => entry.notes)].filter(
            (entry): entry is IssueNotes => entry !== undefined && entry.lines.length > 0,
        ),
        registeredKeys: registered
            .map((entry) => entry.group.key)
            .filter((key) => !tray.groups.some((group) => group.key === key)),
    };
}

function IssueTrayFrameBody({
    tray: own,
    controller: tray$,
    registry,
    children,
    testID,
}: IssueTrayFrameProps & {
    readonly controller: IssueTrayController;
    readonly registry: IssueRegistry;
}) {
    const registered = useSyncExternalStore(
        registry.subscribe,
        registry.snapshot,
        registry.snapshot,
    );
    const tray = useMemo(
        () => (own === null ? null : mergeTray(own, registered)),
        [own, registered],
    );
    const { atLeast } = useBreakpoint();
    const wide = atLeast('lg');
    const base = tray?.testID ?? testID ?? 'issue-tray';
    const { enabled: motion } = useMotion();

    // Here rather than in the panel, so a tray that hides when clear still waits for its last tick.
    const leaving = useLeavingCards(
        tray?.groups ?? NO_GROUPS,
        tray?.registeredKeys ?? NO_KEYS,
        tray !== null,
        tray$.markResolved,
        motion,
    );
    const hidden =
        tray !== null &&
        tray.hideWhenClear === true &&
        tray.groups.every((group) => group.items.length === 0) &&
        leaving.cards.length === 0 &&
        (tray.checking ?? []).length === 0 &&
        tray.notes.length === 0;

    const summary = useMemo<IssueTraySummary | null>(() => {
        if (tray === null || hidden) return null;
        const blocking = tray.groups.flatMap((group) =>
            group.items.filter((item) => item.tone !== 'info'),
        );
        return {
            openCount: blocking.length,
            tone: blocking.some((item) => item.tone === 'danger')
                ? 'danger'
                : blocking.length > 0
                  ? 'warning'
                  : (tray.checking ?? []).length > 0
                    ? 'checking'
                    : 'clear',
            title: tray.title,
        };
    }, [tray, hidden]);

    const { publish } = tray$;
    useEffect(() => {
        publish(summary);
    }, [publish, summary]);
    useEffect(
        () => () => {
            publish(null);
        },
        [publish],
    );

    const panel =
        tray === null ? null : (
            <IssueTrayPanel
                tray={tray}
                leaving={leaving}
                testID={base}
                onClose={() => {
                    tray$.setOpen(false);
                }}
                closeBeforeFix={!wide}
                showClose={wide}
            />
        );

    /*
     * Docked, the panel's column comes out of the page's: `useContentWidth` under it says so, and
     * the ports that measure their own node (`useCataloguePort`) are told with one `resize`, as the
     * shell tells them when its own panel settles.
     */
    const docked = wide && tray !== null && tray$.open && !hidden;
    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;
        window.dispatchEvent(new Event('resize'));
    }, [docked]);
    const page = (
        <ContentWidthBeside width={docked ? DOCKED_WIDTH : 0}>{children}</ContentWidthBeside>
    );

    /*
     * The same wrapper whether or not there is a tray to draw: a page that passes `null` for a
     * moment (an older version on screen, a list with nothing to say) must not be remounted —
     * that would replay its entrance and take the focus out of the box being typed in.
     */
    if (!wide) {
        return (
            <>
                {page}
                {tray === null ? null : (
                    <Drawer
                        testID={`${base}-sheet`}
                        placement="bottom"
                        title={tray.title}
                        open={tray$.open && !hidden}
                        onClose={() => {
                            tray$.setOpen(false);
                        }}
                    >
                        {panel}
                    </Drawer>
                )}
            </>
        );
    }

    return (
        <View
            testID={tray === null ? undefined : `${base}-frame`}
            className="z-auto flex-row items-start gap-6"
        >
            <View className="z-auto min-w-0 flex-1">{page}</View>
            {docked ? (
                // Sticky against the shell's scroll port, so the tray stays beside whatever part of
                // a long form the reader is on. Its own scroll when it is taller than the window.
                <SlideIn
                    edge="end"
                    distance="small"
                    className="w-80 shrink-0 self-start web:sticky web:top-0"
                >
                    <View
                        role="complementary"
                        aria-label={tray.title}
                        className="rounded-lg border border-stroke-subtle bg-surface-raised p-4 web:max-h-[85vh] web:overflow-y-auto"
                    >
                        {panel}
                    </View>
                </SlideIn>
            ) : null}
        </View>
    );
}

interface LeavingCard {
    readonly groupKey: string;
    readonly groupTitle: string;
    readonly item: IssueCardItem;
    readonly folding: boolean;
}

interface LeavingCards {
    readonly cards: readonly LeavingCard[];
    /** How many cards have cleared themselves since the tray was opened on this page. */
    readonly resolved: number;
}

function IssueTrayPanel({
    tray,
    leaving,
    testID,
    onClose,
    closeBeforeFix,
    showClose,
}: {
    readonly tray: MergedTray;
    readonly leaving: LeavingCards;
    readonly testID: string;
    readonly onClose: () => void;
    readonly closeBeforeFix: boolean;
    readonly showClose: boolean;
}) {
    const { t } = useTranslation();

    // The groups as drawn: today's, then any group whose last card is still on its way out.
    const groups = useMemo(() => {
        const drawn = tray.groups.map((group) => ({
            ...group,
            leaving: leaving.cards.filter((card) => card.groupKey === group.key),
        }));
        for (const card of leaving.cards) {
            if (drawn.some((group) => group.key === card.groupKey)) continue;
            drawn.push({
                key: card.groupKey,
                title: card.groupTitle,
                items: [],
                testID: undefined,
                leaving: leaving.cards.filter((entry) => entry.groupKey === card.groupKey),
            });
        }
        return drawn.filter((group) => group.items.length + group.leaving.length > 0);
    }, [tray.groups, leaving.cards]);

    const blocking = tray.groups.reduce(
        (sum, group) => sum + group.items.filter((item) => item.tone !== 'info').length,
        0,
    );
    const passed = tray.passed ?? [];
    const checking = tray.checking ?? [];
    const done = passed.length + leaving.resolved;
    const total = done + blocking + checking.length;
    const clear = groups.length === 0 && checking.length === 0;

    const run = (action: IssueAction) => {
        if (!closeBeforeFix) {
            action.onPress();
            return;
        }
        // The sheet covers the page; get it out of the way before the page moves under it.
        onClose();
        requestAnimationFrame(() => {
            action.onPress();
        });
    };

    return (
        <View testID={testID} className="flex-col gap-3">
            <View className="flex-row items-center gap-2">
                {/* The sheet titles itself; the docked panel needs its own. */}
                {showClose ? (
                    <RNText
                        accessibilityRole="header"
                        aria-level={2}
                        className="min-w-0 flex-1 text-base font-semibold text-content-primary text-start"
                    >
                        {tray.title}
                    </RNText>
                ) : (
                    <View className="flex-1" />
                )}
                {total === 0 ? null : (
                    <RNText
                        testID={`${testID}-progress`}
                        accessibilityLiveRegion="polite"
                        aria-live="polite"
                        className="text-xs tabular-nums text-content-secondary"
                    >
                        {t('designSystem:issueTray.progress', { done, total })}
                    </RNText>
                )}
                {showClose ? (
                    <IconButton
                        testID={`${testID}-close`}
                        size="sm"
                        variant="ghost"
                        label={t('designSystem:issueTray.close')}
                        icon={<Icon name="close" size="sm" />}
                        onPress={onClose}
                    />
                ) : null}
            </View>

            {total === 0 ? null : <ProgressLine done={done} total={total} />}

            {tray.context === undefined ? null : (
                <View
                    testID={tray.context.testID}
                    className="flex-row items-center gap-2 rounded bg-surface-sunken px-3 py-2"
                >
                    <Icon name="chevronBackward" size="sm" className="text-content-secondary" />
                    <RNText className="min-w-0 flex-1 text-sm text-content-primary text-start">
                        {tray.context.label}
                    </RNText>
                </View>
            )}

            {groups.map((group) => (
                <View key={group.key} testID={group.testID} className="flex-col gap-2">
                    <RNText className="text-xs font-semibold text-content-secondary text-start">
                        {group.title}
                    </RNText>
                    {group.items.map((item) => (
                        <IssueCard
                            key={item.key}
                            item={item}
                            onAction={run}
                            fixLabel={t('designSystem:issueTray.fix')}
                        />
                    ))}
                    {group.leaving.map((card) => (
                        <Collapse key={`leaving-${card.item.key}`} open={!card.folding}>
                            <IssueCard
                                item={card.item}
                                resolved
                                onAction={run}
                                fixLabel={t('designSystem:issueTray.fix')}
                            />
                        </Collapse>
                    ))}
                </View>
            ))}

            {checking.length === 0 ? null : (
                <View testID={`${testID}-checking`} className="flex-col gap-1">
                    <RNText className="text-xs font-semibold text-content-secondary text-start">
                        {t('designSystem:issueTray.checking')}
                    </RNText>
                    {checking.map((check) => (
                        <View
                            key={check.key}
                            testID={check.testID}
                            className="flex-row items-center gap-2 py-0.5"
                        >
                            <Icon name="clock" size="sm" className="text-content-secondary" />
                            <RNText className="min-w-0 flex-1 text-sm text-content-secondary text-start">
                                {check.label}
                            </RNText>
                        </View>
                    ))}
                </View>
            )}

            {!clear ? null : (
                <View testID={`${testID}-clear`} className="flex-col items-center gap-1 py-3">
                    <Icon name="circleCheck" size="lg" className="text-success" />
                    <RNText className="text-base font-semibold text-content-primary">
                        {t('designSystem:issueTray.allSet')}
                    </RNText>
                    {tray.doneLabel === undefined ? null : (
                        <RNText className="text-sm text-content-secondary">{tray.doneLabel}</RNText>
                    )}
                    {tray.doneAction === undefined ? null : (
                        <Button
                            testID={tray.doneAction.testID}
                            size="sm"
                            variant="primary"
                            label={tray.doneAction.label ?? t('designSystem:issueTray.fix')}
                            loading={tray.doneAction.loading}
                            iconStart={<Icon name="chevronBackward" size="sm" />}
                            className="mt-2 self-center"
                            onPress={() => {
                                if (tray.doneAction !== undefined) run(tray.doneAction);
                            }}
                        />
                    )}
                </View>
            )}

            {passed.length === 0 ? null : (
                <View testID={`${testID}-passed`} className="flex-col gap-1">
                    <RNText className="text-xs font-semibold text-content-secondary text-start">
                        {t('designSystem:issueTray.passed')}
                    </RNText>
                    {passed.map((check) => (
                        <View
                            key={check.key}
                            testID={check.testID}
                            accessibilityLabel={
                                check.note === undefined
                                    ? check.label
                                    : `${check.label}: ${check.note}`
                            }
                            className="flex-row items-start gap-2 py-0.5"
                        >
                            <Icon name="check" size="sm" className="mt-0.5 text-success" />
                            <View className="min-w-0 flex-1 flex-col">
                                <RNText className="text-sm text-content-primary text-start">
                                    {check.label}
                                </RNText>
                                {check.note === undefined ? null : (
                                    <RNText className="text-xs text-content-secondary text-start">
                                        {check.note}
                                    </RNText>
                                )}
                            </View>
                        </View>
                    ))}
                </View>
            )}

            {tray.notes.map((notes, index) => (
                <View
                    key={`${String(index)}-${notes.title}`}
                    testID={
                        notes.testID ??
                        (index === 0 ? `${testID}-notes` : `${testID}-notes-${String(index)}`)
                    }
                    className="flex-col gap-1 border-t border-stroke-subtle pt-3"
                >
                    <RNText className="text-xs font-semibold text-content-secondary text-start">
                        {notes.title}
                    </RNText>
                    {notes.lines.map((line) => (
                        <RNText
                            key={line.key}
                            testID={line.testID}
                            className="text-sm text-content-primary text-start"
                        >
                            {line.text}
                        </RNText>
                    ))}
                </View>
            ))}
        </View>
    );
}

function IssueCard({
    item,
    resolved = false,
    onAction,
    fixLabel,
}: {
    readonly item: IssueCardItem;
    readonly resolved?: boolean;
    readonly onAction: (action: IssueAction) => void;
    readonly fixLabel: string;
}) {
    const testID = resolved
        ? item.testID === undefined
            ? undefined
            : `${item.testID}-resolved`
        : item.testID;
    return (
        <View
            testID={testID}
            role={item.tone === 'danger' && !resolved ? 'alert' : undefined}
            className={cx(
                'flex-row flex-wrap items-center gap-x-2.5 gap-y-2 rounded border px-3 py-2.5',
                resolved
                    ? 'border-success-border bg-success-subtle'
                    : 'border-stroke-subtle bg-surface-raised',
            )}
        >
            <Icon
                name={resolved ? 'circleCheck' : TONE_ICON[item.tone]}
                size="sm"
                className={resolved ? 'text-success' : TONE_MARK[item.tone]}
            />
            {/*
             * The words keep at least 160px. Without a floor, `flex-1` lets them shrink to nothing
             * so a card's buttons can share their line — a two-button card (Publish, Back to stock
             * gaps) set its message one letter per line. With it, the buttons wrap below instead.
             */}
            <View className="min-w-40 flex-1 flex-col">
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-label`}
                    className={cx(
                        'text-sm font-medium text-start',
                        resolved ? 'text-success-on-subtle' : 'text-content-primary',
                    )}
                >
                    {item.label}
                </RNText>
                {item.detail === undefined ? null : (
                    <RNText
                        className={cx(
                            'text-xs text-start',
                            resolved ? 'text-success-on-subtle' : 'text-content-secondary',
                        )}
                    >
                        {item.detail}
                    </RNText>
                )}
            </View>
            {resolved ? null : (
                // At the inline end, on the message's line or — wrapped — on its own under it.
                <View className="ms-auto flex-row flex-wrap items-center justify-end gap-1">
                    {item.secondaryAction === undefined ? null : (
                        <Button
                            testID={item.secondaryAction.testID}
                            size="sm"
                            variant="quiet"
                            label={item.secondaryAction.label ?? fixLabel}
                            loading={item.secondaryAction.loading}
                            onPress={() => {
                                if (item.secondaryAction !== undefined)
                                    onAction(item.secondaryAction);
                            }}
                        />
                    )}
                    {item.action === undefined ? null : (
                        <Button
                            testID={
                                item.action.testID ??
                                (item.testID === undefined ? undefined : `${item.testID}-fix`)
                            }
                            size="sm"
                            variant="secondary"
                            label={item.action.label ?? fixLabel}
                            loading={item.action.loading}
                            onPress={() => {
                                if (item.action !== undefined) onAction(item.action);
                            }}
                        />
                    )}
                </View>
            )}
        </View>
    );
}

/** One segment per check while they fit on the line; a plain fill beyond that. */
function ProgressLine({ done, total }: { readonly done: number; readonly total: number }) {
    if (total > 10) {
        return (
            <View className="h-1 flex-row overflow-hidden rounded-full bg-success-subtle">
                <View className="h-1 bg-success" style={{ width: `${(done / total) * 100}%` }} />
            </View>
        );
    }
    return (
        <View aria-hidden className="flex-row gap-1">
            {Array.from({ length: total }, (_, index) => (
                <View
                    key={index}
                    className={cx(
                        'h-1 flex-1 rounded-full',
                        index < done ? 'bg-success' : 'bg-success-subtle',
                    )}
                />
            ))}
        </View>
    );
}

/**
 * The cards that were there last render and are not now: each ticks green, then folds, then goes.
 * A card that comes back before it has gone (the field emptied again) is simply open once more.
 *
 * Except the cards of a registered group whose part has gone (`registeredKeys`): nothing was fixed,
 * the part left — a seller switched, a listing unmounted — so they go at once, untallied. And none
 * while the page has no tray (`active` false — an older version on screen): putting the tray away
 * fixes nothing, so it starts afresh when it comes back.
 */
function useLeavingCards(
    groups: readonly IssueGroup[],
    registeredKeys: readonly string[],
    active: boolean,
    onResolved: () => void,
    motion: boolean,
): LeavingCards {
    const [cards, setCards] = useState<readonly LeavingCard[]>([]);
    const [resolved, setResolved] = useState(0);
    const previous = useRef(new Map<string, LeavingCard>());
    const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
    const resolvedRef = useRef(onResolved);
    resolvedRef.current = onResolved;

    const signature = `${String(active)}#${groups
        .map((group) => `${group.key}:${group.items.map((item) => item.key).join(',')}`)
        .join('|')}#${registeredKeys.join(',')}`;

    // Read through a ref so the effect keys on the card *set*, not on every new label object.
    const latest = useRef(groups);
    latest.current = groups;
    const latestRegistered = useRef(registeredKeys);
    latestRegistered.current = registeredKeys;
    const previousRegistered = useRef<readonly string[]>([]);

    // Before paint: a card that has gone is replaced by its ticked self in the same frame, so the
    // list never shows a frame with the card missing and the next one with it back, green.
    useLayoutEffect(() => {
        if (!active) {
            previous.current = new Map();
            previousRegistered.current = [];
            setCards((existing) => (existing.length === 0 ? existing : []));
            setResolved(0);
            return;
        }
        const current = new Map<string, LeavingCard>();
        for (const group of latest.current) {
            for (const item of group.items) {
                current.set(`${group.key}/${item.key}`, {
                    groupKey: group.key,
                    groupTitle: group.title,
                    item,
                    folding: false,
                });
            }
        }

        const departed = previousRegistered.current.filter(
            (key) => !latestRegistered.current.includes(key),
        );
        previousRegistered.current = latestRegistered.current;
        const gone = [...previous.current.entries()]
            .filter(([key]) => !current.has(key))
            .map(([, card]) => card)
            .filter((card) => !departed.includes(card.groupKey));
        previous.current = current;

        setCards((existing) =>
            existing.filter((card) => !current.has(`${card.groupKey}/${card.item.key}`)),
        );
        if (gone.length === 0) return;

        setCards((existing) => [...existing, ...gone]);
        setResolved((count) => count + gone.length);
        resolvedRef.current();

        const ids = new Set(gone.map((card) => `${card.groupKey}/${card.item.key}`));
        const same = (card: LeavingCard) => ids.has(`${card.groupKey}/${card.item.key}`);
        const fold = setTimeout(() => {
            setCards((existing) =>
                existing.map((card) => (same(card) ? { ...card, folding: true } : card)),
            );
        }, TICK_MS);
        const remove = setTimeout(
            () => {
                setCards((existing) => existing.filter((card) => !same(card)));
            },
            motion ? GONE_MS : TICK_MS,
        );
        timers.current.add(fold);
        timers.current.add(remove);
    }, [signature, motion, active]);

    useEffect(() => {
        const pending = timers.current;
        return () => {
            for (const timer of pending) clearTimeout(timer);
            pending.clear();
        };
    }, []);

    return { cards, resolved };
}
