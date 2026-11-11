import { DensityProvider } from '@healthy360/design-system';
import type { MenuItem, NavigationItem } from '@healthy360/design-system';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { pathnameOf, safeReturnTo } from '../../navigation/return-to.ts';
import { guardNavigation } from '../../navigation/use-unsaved-guard.ts';
import { useAccessState } from '../../session/session-provider.tsx';
import { TrailLeafProvider, useTrailLeaf, useTrailLeafState } from '../../shell/area-trail.tsx';
import { returnCrumbLabel } from './came-from.ts';
import { DiscardBoundary, SaveBarSlot } from './save-bar.tsx';
import { DeskTrail } from './desk-kit/desk-trail.tsx';
import type { DeskCrumb } from './desk-kit/desk-trail.tsx';
import { ENTITY_FAMILIES } from './entity-registry.ts';
import type { EntityFamily } from './entity-registry.ts';
import {
    OVERVIEW_HREF,
    activeKitchenNavHref,
    isKitchenNavActive,
    kitchenNavSections,
} from './kitchen-nav.ts';

/**
 * Kitchen area chrome — the density around every page, and the trail back to the hub that the top
 * bar draws.
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
 * lost a row and a half to gutters. The inset belongs to the shell that owns the scroll port.
 *
 * ## Why there is a trail at all
 *
 * Destinations live on the hub as a card grid rather than in a second sidebar or a cramped icon
 * strip on every route — that decision stands. What it cost was the way back: once you pressed
 * through to `/kitchen/ingredients` there was no control anywhere on the page that returned you to
 * `/kitchen`. Editors had "back to list" and lists had nothing, so the hub was reachable only by the
 * browser's back button, which native does not have at all.
 *
 * It sits here rather than in the thirteen screens because the kitchen layout wraps every kitchen
 * route in {@link KitchenTrailProvider}, so a family added tomorrow gets its trail without anybody
 * remembering to add one.
 *
 * ## In the top bar, not above the page
 *
 * The trail used to be its own line at the head of the content, which spent a row of every page on
 * an 11px line and put the page's location below the bar whose job is to say where you are. It is
 * now {@link KitchenTrail}, drawn in the bar in place of the area title. Its state therefore lives
 * in a provider above `AreaShell` rather than in `KitchenOpsShell`, which is only the content: a
 * screen deep in the content names the leaf, and the bar — a sibling of the content, not an
 * ancestor — reads it.
 *
 * The trail keeps `DensityProvider value="compact"` of its own, because the bar sits outside
 * `KitchenOpsShell`'s provider. Its links are not underlined on the compact ladder (`Breadcrumbs`).
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
 *
 * ## A view page is not a route, so it hands the trail its way back
 *
 * The Catalogue's View pages (`RecordViewPage`) open *inside* their list — `/kitchen/ingredients`
 * showing one record instead of the table — so that Back keeps the list's page, sort and filters.
 * On that path the family crumb *is* the current route, and pushing it again would go nowhere. So a
 * view page names its leaf together with the callback that closes it, and while one is registered
 * the trail draws the leaf and makes the family crumb that callback. That is what lets the view
 * pages drop their own Back button: the trail is the one way back, on every page that has a record
 * open, whether the record is a route of its own or not.
 *
 * ## A page opened from elsewhere names where it came from
 *
 * A recipe opened from Stock gaps to fix a gap is a route of the recipe book, but the reader came
 * from Stock gaps and Back goes there. So such a page names that parent too (`parentLabel`, the
 * hook's third argument, with its way back), and the trail reads `Kitchen workspace › Stock gaps ›
 * Lentil Soup` with **Stock gaps** as the link back — the same page the browser's Back returns to,
 * rather than a Recipes crumb that would lead somewhere the reader never was.
 */

export interface KitchenOpsShellProps {
    readonly children: ReactNode;
}

/**
 * Names the trail's last crumb from inside a screen — `useTrailLeaf` (`shell/area-trail.tsx`).
 *
 * Pass the record's display name once it has loaded, and `null` while it has not — the trail simply
 * stays two crumbs until then. Calling this is what makes the family crumb above it a link, so a
 * detail screen that wants a way back to its list wants this hook. The leaf context is the shell's,
 * not the kitchen's, so a view page reused in another desk area names its crumb there too.
 *
 * `useKitchenTrailLeaf(title, onBack, parentLabel)`: with both of the last two, the crumb above the
 * leaf is `parentLabel` and presses `onBack` — for a page opened from somewhere other than its own
 * list.
 */
export const useKitchenTrailLeaf = useTrailLeaf;

/** Holds the trail's leaf for everything under the kitchen layout — the top bar and the page. */
export const KitchenTrailProvider = TrailLeafProvider;

/** One crumb of the kitchen trail — the desk kit's (`desk-kit/desk-trail.tsx`). */
export type KitchenCrumb = DeskCrumb;

/** The deepest registry family an href sits under — `/kitchen/order-desk/cash` is Cash's. */
function familyOf(href: string): EntityFamily | undefined {
    const path = pathnameOf(href);
    return ENTITY_FAMILIES.filter(
        (candidate) => path === candidate.href || path.startsWith(`${candidate.href}/`),
    ).sort((a, b) => b.href.length - a.href.length)[0];
}

/**
 * The crumbs for the current kitchen route. Empty on the hub, where a trail naming the page you
 * are on is furniture — which is the caller's signal to draw the area title instead.
 *
 * ## The one rule for "where did I come from"
 *
 * Every kitchen page reads `?returnTo=` here, lists included, so no page has to remember to. When
 * the return is somewhere other than this route's own family — Purchases ledger opened from Stock,
 * Quality control from Stock gaps, Stock from an alert — the trail is `⌂ / ↩ Stock gaps / Quality
 * control`, and the return crumb goes back there. A return *within* the family (a supplier opened
 * from its own list's view) keeps the ordinary trail; only its family crumb goes back to the list
 * as it was left, filters and all, instead of to a fresh one.
 *
 * `navigation` is the rail's own items (`useKitchenNavigation`), passed so the module's menu lists
 * exactly the rail's pages with the rail's counts; without it the menu lists the permitted pages.
 */
export function useKitchenTrail(navigation?: readonly NavigationItem[]): readonly KitchenCrumb[] {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const params = useGlobalSearchParams();
    const accessState = useAccessState();
    const { leaf, back, parentLabel } = useTrailLeafState();
    const rawReturn = params.returnTo;
    const returnTo = safeReturnTo(Array.isArray(rawReturn) ? rawReturn[0] : rawReturn);

    return useMemo<readonly KitchenCrumb[]>(() => {
        // The hub is its own page; a trail that says "Kitchen workspace" on the kitchen workspace
        // is furniture.
        if (isKitchenNavActive(pathname, OVERVIEW_HREF)) return [];

        const go = (href: string) => () => {
            guardNavigation(() => {
                router.push(href as never);
            });
        };
        const backTo = (href: string) => () => {
            guardNavigation(() => {
                router.dismissTo(href as never);
            });
        };
        const hub: KitchenCrumb = {
            key: 'hub',
            kind: 'home',
            label: t('kitchen:hub.title'),
            testID: 'kitchen-crumb-hub',
            onPress: go(OVERVIEW_HREF),
        };
        const returnCrumb = (label: string, onPress: () => void): KitchenCrumb => ({
            key: 'return',
            kind: 'return',
            label,
            testID: 'kitchen-crumb-return',
            onPress,
        });
        const current = (key: string, label: string, testID: string): KitchenCrumb => ({
            key,
            kind: 'current',
            label,
            testID,
        });

        // Opened from somewhere that is not this route's parent — a recipe from Stock gaps — and
        // the screen handed the way back itself, with the origin's name (a record's, say).
        if (leaf !== null && back !== null && parentLabel !== null) {
            return [
                hub,
                returnCrumb(parentLabel, back),
                current('leaf', leaf, 'kitchen-crumb-leaf'),
            ];
        }

        const sections = kitchenNavSections(accessState);
        const items = sections.flatMap((section) => section.items);
        const activeHref = activeKitchenNavHref(
            pathname,
            items.map((item) => item.href),
        );
        const family = items.find((item) => item.href === activeHref);

        // Opened from another page than this family: that page is the way back, on every page.
        const returnFamily = returnTo === null ? undefined : familyOf(returnTo);
        // Only once this page's own family is known: until the access state lands every family
        // reads as "elsewhere", and the trail would flash a return for the page's own list.
        if (
            family !== undefined &&
            returnTo !== null &&
            returnFamily !== undefined &&
            returnFamily.key !== family.key
        ) {
            const label = returnCrumbLabel(returnTo, t);
            if (label !== null) {
                return [
                    hub,
                    returnCrumb(label, backTo(returnTo)),
                    leaf === null
                        ? current(family.key, t(family.nameKey), 'kitchen-crumb-family')
                        : current('leaf', leaf, 'kitchen-crumb-leaf'),
                ];
            }
        }

        // A route the registry does not know — permission-filtered away, or new and unregistered.
        // Still offer the way home rather than rendering nothing.
        if (family === undefined) {
            return [{ ...hub, kind: 'current', onPress: undefined }];
        }

        const section = sections.find((candidate) =>
            candidate.items.some((item) => item.key === family.key),
        );
        const railByKey = new Map((navigation ?? []).map((item) => [item.key, item]));
        const pages: MenuItem[] = (section?.items ?? [])
            .filter((item) => navigation === undefined || railByKey.has(item.key))
            .map((item) => {
                const count = railByKey.get(item.key)?.count;
                return {
                    key: item.key,
                    label: t(item.nameKey),
                    selected: item.key === family.key,
                    testID: `kitchen-crumb-module-${item.key}`,
                    ...(count === undefined ? {} : { count }),
                    onSelect: go(item.href),
                };
            });
        const moduleCrumb: KitchenCrumb | null =
            section === undefined
                ? null
                : {
                      key: 'module',
                      kind: 'module',
                      label: t(section.labelKey),
                      testID: 'kitchen-crumb-module',
                      pages,
                  };

        const onFamilyRoute = pathname === family.href;
        // A record open *inside* the list: the family route is the page, but the list is not
        // what is showing, so the crumb is a link again — to the list, by closing the record.
        const viewOpen = onFamilyRoute && leaf !== null && back !== null;
        const showLeaf = leaf !== null && (!onFamilyRoute || viewOpen);
        const familyPress =
            viewOpen && back !== null
                ? back
                : returnTo !== null && returnFamily?.key === family.key
                  ? // Back to the list as it was left, when the return is the list's own address.
                    backTo(returnTo)
                  : go(family.href);
        const familyCrumb: KitchenCrumb = showLeaf
            ? {
                  key: family.key,
                  kind: 'page',
                  label: t(family.nameKey),
                  testID: 'kitchen-crumb-family',
                  onPress: familyPress,
              }
            : current(family.key, t(family.nameKey), 'kitchen-crumb-family');

        return [
            hub,
            ...(moduleCrumb === null ? [] : [moduleCrumb]),
            familyCrumb,
            ...(showLeaf && leaf !== null ? [current('leaf', leaf, 'kitchen-crumb-leaf')] : []),
        ];
    }, [accessState, pathname, router, t, leaf, back, parentLabel, returnTo, navigation]);
}

/** The trail as the top bar draws it. `kitchen-breadcrumbs` is a print-stylesheet contract. */
export function KitchenTrail({ crumbs }: { readonly crumbs: readonly KitchenCrumb[] }) {
    return <DeskTrail testID="kitchen-breadcrumbs" crumbs={crumbs} />;
}

export function KitchenOpsShell({ children }: KitchenOpsShellProps) {
    return (
        <DensityProvider value="compact">
            <View testID="kitchen-ops-shell" className="min-h-0 flex-1">
                <View testID="kitchen-ops-content" className="min-h-0 min-w-0 flex-1">
                    {/* The save bar's Discard draws the page afresh from its saved record. */}
                    <DiscardBoundary>{children}</DiscardBoundary>
                </View>
                {/* Last in the content, so it can stick to the foot of the scroll port. */}
                <SaveBarSlot />
            </View>
        </DensityProvider>
    );
}
