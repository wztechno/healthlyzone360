import {
    Button,
    DensityProvider,
    Dialog,
    Icon,
    IconButton,
    useBreakpoint,
} from '@healthy360/design-system';
import { usePathname, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text as RNText, View } from 'react-native';

import { endProcess, isOutsideProcess, useActiveProcess } from '../navigation/active-process.ts';
import { discardKeptWork, keptWorkAway, onWorkKept, useKeptWork } from '../navigation/kept-work.ts';
import { createSessionDraftStore } from '../navigation/session-draft.ts';

/**
 * Unfinished work, and the way back into each piece of it — a card at the bottom of the page and a
 * "Continue" pill in the top bar.
 *
 * ## Why both
 *
 * A pill alone was easy to miss: the reader left a recipe, saw nothing change, and took the work
 * for lost (2026-10-29). So whenever something is kept, a card opens at the bottom centre of the
 * page listing it. Minimising it — or its ✕, which is the same — tucks it into the top bar's pill,
 * which opens the same list. Keeping something else opens the card again.
 *
 * ## What is listed
 *
 * The running process, if the reader has stepped out of it (`active-process.ts`), and every editor
 * kept for later (`kept-work.ts`) other than the page the reader is on. A row's ✕ throws the work
 * away, after asking: it cannot be brought back.
 *
 * The design was settled with the user on 2026-10-29 before it was built; change it with them.
 */

interface ContinuableRow {
    readonly id: string;
    readonly title: string;
    readonly detail: string;
    readonly href: string;
    readonly dismiss: () => void;
}

function useContinuableWork(): readonly ContinuableRow[] {
    const { t } = useTranslation();
    const pathname = usePathname();
    const process = useActiveProcess();
    const kept = keptWorkAway(useKeptWork(), pathname);

    const rows: ContinuableRow[] = [];
    if (process !== null && isOutsideProcess(process, pathname)) {
        rows.push({
            id: 'process',
            title: t(`common:process.kind.${process.kind}`, { subject: process.subject }),
            detail: t('common:keptWork.inProgress'),
            href: process.resumeHref,
            dismiss: endProcess,
        });
    }
    for (const entry of kept) {
        rows.push({
            id: entry.id,
            title: entry.subject ?? t(`common:keptWork.new.${entry.kind}`),
            detail: t('common:keptWork.detail', {
                kind: t(`common:keptWork.kind.${entry.kind}`),
            }),
            href: entry.href,
            dismiss: () => {
                discardKeptWork(entry.id);
            },
        });
    }
    return rows;
}

/** Whether the card is open — for the tab, so a reload keeps it as the reader left it. */
const dockState = createSessionDraftStore<boolean>({
    namespace: 'keptWorkDock',
    parse: (raw) => (typeof raw === 'boolean' ? raw : null),
});
const OPEN = 'open';

function useDockOpen(): readonly [boolean, (open: boolean) => void] {
    const open = dockState.useDraft(OPEN) ?? true;
    // Something newly kept is said again, however the card was left.
    useEffect(
        () =>
            onWorkKept(() => {
                dockState.write(OPEN, true);
            }),
        [],
    );
    return [
        open,
        (next: boolean) => {
            dockState.write(OPEN, next);
        },
    ];
}

function heading(t: TFunction, count: number): string {
    return t('common:keptWork.title', { n: count });
}

function WorkRows({
    rows,
    testID,
    onLeave,
}: {
    readonly rows: readonly ContinuableRow[];
    readonly testID: string;
    readonly onLeave?: (() => void) | undefined;
}) {
    const { t } = useTranslation();
    const router = useRouter();
    const [asking, setAsking] = useState<ContinuableRow | null>(null);

    return (
        <View>
            {rows.map((row) => (
                <View
                    key={row.id}
                    testID={`${testID}-row`}
                    className="flex-row items-center gap-2 border-t border-stroke-subtle py-2"
                >
                    <View className="min-w-0 flex-1">
                        <RNText
                            numberOfLines={1}
                            className="text-sm font-semibold text-content-primary text-start"
                        >
                            {row.title}
                        </RNText>
                        <RNText
                            numberOfLines={1}
                            className="text-xs text-content-secondary text-start"
                        >
                            {row.detail}
                        </RNText>
                    </View>
                    <Button
                        testID={`${testID}-continue`}
                        size="sm"
                        variant="primary"
                        label={t('common:process.continue')}
                        accessibilityLabel={t('common:process.continueLabel', {
                            title: row.title,
                        })}
                        onPress={() => {
                            onLeave?.();
                            router.push(row.href as never);
                        }}
                    />
                    <IconButton
                        testID={`${testID}-discard`}
                        size="sm"
                        variant="ghost"
                        label={t('common:keptWork.discardLabel', { title: row.title })}
                        icon={<Icon name="close" size="sm" />}
                        onPress={() => {
                            setAsking(row);
                        }}
                    />
                </View>
            ))}
            <Dialog
                testID={`${testID}-discard-dialog`}
                open={asking !== null}
                onClose={() => {
                    setAsking(null);
                }}
                title={t('common:keptWork.discardTitle')}
                description={t('common:keptWork.discardBody', { title: asking?.title ?? '' })}
                actions={
                    <>
                        <Button
                            testID={`${testID}-discard-cancel`}
                            variant="quiet"
                            label={t('common:keptWork.discardCancel')}
                            onPress={() => {
                                setAsking(null);
                            }}
                        />
                        <Button
                            testID={`${testID}-discard-confirm`}
                            variant="danger"
                            label={t('common:keptWork.discardConfirm')}
                            onPress={() => {
                                asking?.dismiss();
                                setAsking(null);
                            }}
                        />
                    </>
                }
            />
        </View>
    );
}

function CardHeading({ count }: { readonly count: number }) {
    const { t } = useTranslation();
    return (
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
            <Icon name="clipboardList" size="sm" className="text-content-secondary" />
            <RNText
                accessibilityRole="header"
                numberOfLines={1}
                className="min-w-0 shrink text-sm font-semibold text-content-primary text-start"
            >
                {heading(t, count)}
            </RNText>
        </View>
    );
}

/**
 * The card at the bottom centre of the page. Drawn over the page, never taking its taps: the
 * frame around it lets presses through, only the card answers them.
 */
export function KeptWorkDock() {
    const { t } = useTranslation();
    const rows = useContinuableWork();
    const [open, setOpen] = useDockOpen();

    if (rows.length === 0 || !open) return null;

    const minimise = () => {
        setOpen(false);
    };

    return (
        <View className="pointer-events-box-none absolute bottom-4 start-0 end-0 z-toast items-center px-4">
            <DensityProvider value="compact">
                <View
                    testID="kept-work-dock"
                    role="region"
                    aria-label={heading(t, rows.length)}
                    className="w-[340px] rounded-xl border border-stroke-strong bg-surface-raised px-3 pb-1 pt-2 shadow-elevation-3 web:max-w-[92vw]"
                >
                    <View className="flex-row items-center gap-1 pb-1">
                        <CardHeading count={rows.length} />
                        <IconButton
                            testID="kept-work-dock-minimise"
                            size="sm"
                            variant="ghost"
                            label={t('common:keptWork.minimise')}
                            icon={<Icon name="minus" size="sm" />}
                            onPress={minimise}
                        />
                        <IconButton
                            testID="kept-work-dock-close"
                            size="sm"
                            variant="ghost"
                            label={t('common:keptWork.close')}
                            icon={<Icon name="close" size="sm" />}
                            onPress={minimise}
                        />
                    </View>
                    <WorkRows rows={rows} testID="kept-work-dock" />
                </View>
            </DensityProvider>
        </View>
    );
}

/**
 * The top bar's "↩ Continue [2] ⌄" — where the card goes when minimised, opening the same list.
 * Hidden while the card is open: one way back on screen at a time.
 */
export function KeptWorkButton() {
    const { t } = useTranslation();
    const pathname = usePathname();
    const rows = useContinuableWork();
    const [dockOpen] = useDockOpen();
    // Open on the page it was opened on: a new page is a new look at the list, so the panel does
    // not follow the reader there.
    const [openOn, setOpenOn] = useState<string | null>(null);
    const open = openOn === pathname;
    const setOpen = (next: boolean | ((current: boolean) => boolean)) => {
        const value = typeof next === 'function' ? next(open) : next;
        setOpenOn(value ? pathname : null);
    };
    const roomy = useBreakpoint().atLeast('md');

    // Escape closes it, as any panel hung from a top bar does.
    useEffect(() => {
        if (Platform.OS !== 'web' || !open || typeof document === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpenOn(null);
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    if (rows.length === 0 || dockOpen) return null;

    return (
        <DensityProvider value="compact">
            <View className="relative self-center">
                <Pressable
                    testID="process-resume"
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={heading(t, rows.length)}
                    aria-expanded={open}
                    accessibilityState={{ expanded: open }}
                    onPress={() => {
                        setOpen((current) => !current);
                    }}
                    className="h-8 flex-row items-center gap-1.5 rounded-full border border-stroke-strong bg-surface-sunken pe-2 ps-3"
                >
                    <Icon name="chevronBackward" size="sm" className="text-content-primary" />
                    {roomy ? (
                        <RNText className="text-xs font-semibold text-content-primary">
                            {t('common:process.continue')}
                        </RNText>
                    ) : null}
                    <View className="items-center rounded-full bg-surface-brand px-1.5">
                        <RNText
                            testID="process-resume-count"
                            className="text-xs font-semibold tabular-nums text-content-on-brand"
                        >
                            {rows.length}
                        </RNText>
                    </View>
                    <Icon name="chevronDown" size="sm" className="text-content-secondary" />
                </Pressable>
                {open ? (
                    <View
                        testID="kept-work-panel"
                        role="dialog"
                        aria-label={heading(t, rows.length)}
                        className="absolute end-0 top-full z-tooltip mt-1 w-[320px] rounded-xl border border-stroke-strong bg-surface-raised px-3 pb-1 pt-2 shadow-elevation-3 web:max-w-[92vw]"
                    >
                        <View className="flex-row items-center pb-1">
                            <CardHeading count={rows.length} />
                        </View>
                        <WorkRows
                            rows={rows}
                            testID="kept-work-panel"
                            onLeave={() => {
                                setOpen(false);
                            }}
                        />
                    </View>
                ) : null}
            </View>
        </DensityProvider>
    );
}
