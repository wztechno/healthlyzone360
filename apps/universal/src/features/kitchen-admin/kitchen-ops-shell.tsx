import { Breadcrumbs, DensityProvider } from '@healthy360/design-system';
import type { BreadcrumbItem } from '@healthy360/design-system';
import { usePathname, useRouter } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useAccessState } from '../../session/session-provider.tsx';
import { OVERVIEW_HREF, isKitchenNavActive, kitchenNavSections } from './kitchen-nav.ts';

/**
 * Kitchen area content chrome — the density, a trail back to the hub, and the gap between them.
 *
 * ## This is where the admin becomes compact
 *
 * `DensityProvider value="compact"` is the switch the whole Catalogue pass hangs off, and its own
 * docblock says to wrap the admin shell in it. Until it was here every kitchen route rendered on the
 * *customer* ladder: `size="sm"` resolved to the 44px touch floor rather than `controlHeight.sm`, so
 * the search field, the status segments and both header buttons came out roughly half again too
 * tall; and a table cell drawn through `<Text>` took `text-base` (16px) while the cells `DataList`
 * rendered from `value()` took `text-role-body` (12px), which is why one column of a row could be a
 * third larger than the one beside it and wrap out of its own row box.
 *
 * It belongs here rather than on a screen because it is a property of the *surface*: a kitchen is a
 * desk driven with a mouse (CLAUDE.md retires the 44px minimum for `kitchen-admin/` on exactly that
 * reasoning), and a route that opted in individually would leave this component's own trail on the
 * other ladder — which is precisely the mismatch that made the trail above the Catalogue header
 * twice the height of the one drawn under it.
 *
 * ## No padding of its own
 *
 * `AppShell`'s content container already insets the page (`p-4 lg:p-7`). This component used to add
 * `p-4 md:p-5` on top, so every kitchen route sat ~48px from the rail instead of ~28px and the fold
 * lost a row and a half to gutters. The inset belongs to the shell that owns the scroll port; this
 * one contributes the gap between the trail and the page, and nothing else — and that gap is one
 * 4px step, because the trail is an 11px line rather than a heading and anything larger reads as a
 * band of nothing between the page's name and the page.
 *
 * ## Why there is a trail at all
 *
 * Destinations live on the hub as a card grid rather than in a second sidebar or a cramped icon
 * strip on every route — that decision stands. What it cost was the way back: once you pressed
 * through to `/kitchen/ingredients` there was no control anywhere on the page that returned you to
 * `/kitchen`. Editors had "back to list" and lists had nothing, so the hub was reachable only by the
 * browser's back button, which native does not have at all.
 *
 * It sits here rather than in the thirteen screens because this component already wraps every
 * kitchen route, so a family added tomorrow gets its trail without anybody remembering to add one.
 * The labels come from the same entity registry the hub cards and the `<Gate>`s read, which is what
 * stops a crumb naming a page differently from the card that led to it.
 *
 * ## Two crumbs, not three
 *
 * On a list the trail is `Kitchen workspace › Ingredients`, the second being the page you are on.
 *
 * ## Three crumbs on an editor, and why that changed
 *
 * It used to be two everywhere, on the argument that the record's own name is the heading of the
 * screen you are looking at and the shell has no business guessing it from a route parameter. The
 * guess was never the problem; the *last crumb* was. `Breadcrumbs` renders the final item as the
 * current page — no `onPress`, `aria-current="page"` — because that is what a trail means. So on
 * `/kitchen/ingredients/IG-019` the trail read `Kitchen workspace › Ingredients` with **Ingredients
 * as the current page and therefore not a link**, and the one step a reader actually wanted from a
 * record — back to the list it came from — was the one step the trail refused to take.
 *
 * A screen therefore names its own leaf through {@link useKitchenTrailLeaf}, and the family crumb
 * becomes a middle crumb, which is a link. The shell still guesses nothing: the screen supplies the
 * label, because the screen is the thing that loaded the record. Where no screen supplies one the
 * trail is two crumbs exactly as before.
 *
 * The leaf arrives on the render *after* the record lands, so the trail grows a crumb once per
 * navigation. That is honest — the name is genuinely not known before then — and it is the same
 * moment the page title fills in.
 */

export interface KitchenOpsShellProps {
    readonly children: ReactNode;
}

/**
 * The leaf crumb a screen has named, and the setter it names it with.
 *
 * `null` is the ordinary state — a list page is its own leaf and has nothing to add. A detail
 * screen sets its record's name and clears it on unmount, so navigating from one editor to another
 * never shows the previous record's name over the new one's.
 */
interface KitchenTrailState {
    readonly leaf: string | null;
    readonly setLeaf: (leaf: string | null) => void;
}

const KitchenTrailContext = createContext<KitchenTrailState | undefined>(undefined);

/**
 * Names the trail's last crumb from inside a screen.
 *
 * Pass the record's display name once it has loaded, and `null` while it has not — the trail simply
 * stays two crumbs until then. Calling this is what makes the family crumb above it a link, so a
 * detail screen that wants a way back to its list wants this hook.
 *
 * Outside `KitchenOpsShell` it does nothing at all rather than throwing: every one of these screens
 * also renders in unit tests with no shell around it, and a screen that will not mount is a worse
 * failure than a trail that is not there to update.
 */
export function useKitchenTrailLeaf(leaf: string | null): void {
    const trail = useContext(KitchenTrailContext);
    const setLeaf = trail?.setLeaf;

    useEffect(() => {
        if (setLeaf === undefined) return undefined;
        setLeaf(leaf);
        return () => {
            setLeaf(null);
        };
    }, [setLeaf, leaf]);
}

export function KitchenOpsShell({ children }: KitchenOpsShellProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const accessState = useAccessState();

    const [leaf, setLeaf] = useState<string | null>(null);
    const trail = useMemo<KitchenTrailState>(() => ({ leaf, setLeaf }), [leaf]);

    const crumbs = useMemo<readonly BreadcrumbItem[]>(() => {
        // The hub is its own page; a trail that says "Kitchen workspace" on the kitchen workspace
        // is furniture.
        if (isKitchenNavActive(pathname, OVERVIEW_HREF)) return [];

        const family = kitchenNavSections(accessState)
            .flatMap((section) => section.items)
            .find((item) => isKitchenNavActive(pathname, item.href));

        // A route the registry does not know — permission-filtered away, or new and unregistered.
        // Still offer the way home rather than rendering nothing.
        if (family === undefined) {
            return [{ key: 'hub', label: t('kitchen:hub.title'), testID: 'kitchen-crumb-hub' }];
        }

        const onFamilyRoute = pathname === family.href;
        return [
            {
                key: 'hub',
                label: t('kitchen:hub.title'),
                testID: 'kitchen-crumb-hub',
                onPress: () => {
                    router.push(OVERVIEW_HREF as never);
                },
            },
            {
                key: family.key,
                label: t(family.nameKey),
                testID: 'kitchen-crumb-family',
                // A link unless it *is* the page. Note the second condition: with a leaf below it
                // the family crumb is no longer last, and `Breadcrumbs` only strips the press from
                // the final item — so this is what actually restores the way back to the list.
                ...(onFamilyRoute
                    ? {}
                    : {
                          onPress: () => {
                              router.push(family.href as never);
                          },
                      }),
            },
            ...(leaf === null || onFamilyRoute
                ? []
                : [{ key: 'leaf', label: leaf, testID: 'kitchen-crumb-leaf' }]),
        ];
    }, [accessState, pathname, router, t, leaf]);

    return (
        <DensityProvider value="compact">
            <KitchenTrailContext.Provider value={trail}>
                <View testID="kitchen-ops-shell" className="min-h-0 flex-1 gap-hair">
                    {crumbs.length === 0 ? null : (
                        <Breadcrumbs testID="kitchen-breadcrumbs" items={crumbs} />
                    )}
                    <View testID="kitchen-ops-content" className="min-h-0 min-w-0 flex-1">
                        {children}
                    </View>
                </View>
            </KitchenTrailContext.Provider>
        </DensityProvider>
    );
}
