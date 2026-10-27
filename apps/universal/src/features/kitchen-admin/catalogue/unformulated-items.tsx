import type { LocalisedText, RecipeKind } from '@healthy360/api-client/contracts';
import { Button, Callout, useIssueGroup } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAdminMealPageQuery, useProductPageQuery } from '../../../data/kitchen-admin-hooks.ts';
import { displayName } from '../format.ts';

/** The kinds a recipe can sell as — the ones an item without a formulation can be missing one for. */
type SellerKind = Exclude<RecipeKind, 'preparation'>;

const SELLER_KINDS: readonly SellerKind[] = ['meal', 'sauce', 'dressing', 'frozen_meal'];

/** One page holds every one in practice; the endpoint's own ceiling. */
const PAGE = 100;

/**
 * How many items the strip offers to open, when it is drawn on the page. The count in the title is
 * still all of them; past five, the buttons wrapped into a wall that pushed the recipe book off the
 * screen. The tray has no such wall — it scrolls on its own — so there every item is a card.
 */
const UNFORMULATED_SHOWN = 5;

interface UnformulatedRow {
    readonly id: string;
    readonly kind: SellerKind;
    readonly name: LocalisedText;
}

/**
 * The items on the menu that no recipe sells (HA-44).
 *
 * The recipe book is a list of recipes, so an imported meal or frozen meal with no formulation had
 * no row in it — on sale at the counter and on the web, and unreachable from the screen that fixes
 * it. They are listed for the kind on screen (every cooked kind under "All") as cards in the book's
 * issue tray, one per item, whose Fix opens its item page, which offers to start the formulation —
 * so each card clears itself once that item has a recipe. Nothing is said when there are none.
 *
 * Rendered with no tray above it, it draws the strip it used to: the count, and the first
 * {@link UNFORMULATED_SHOWN} as buttons.
 */
export function UnformulatedItems({
    kind,
    testID,
}: {
    readonly kind: RecipeKind | null;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const wants = (candidate: SellerKind): boolean => kind === null || kind === candidate;

    const meals = useAdminMealPageQuery({ withoutRecipe: true }, 1, wants('meal'), PAGE);
    const sauces = useProductPageQuery(
        { itemType: 'sauce', withoutRecipe: true },
        1,
        wants('sauce'),
        PAGE,
    );
    const dressings = useProductPageQuery(
        { itemType: 'dressing', withoutRecipe: true },
        1,
        wants('dressing'),
        PAGE,
    );
    const frozen = useProductPageQuery(
        { itemType: 'frozen_meal', withoutRecipe: true },
        1,
        wants('frozen_meal'),
        PAGE,
    );

    const rows = useMemo<readonly UnformulatedRow[]>(() => {
        const byKind: Readonly<
            Record<SellerKind, readonly { id: unknown; name: LocalisedText }[]>
        > = {
            meal: meals.data?.items ?? [],
            sauce: sauces.data?.items ?? [],
            dressing: dressings.data?.items ?? [],
            frozen_meal: frozen.data?.items ?? [],
        };
        return SELLER_KINDS.filter(wants).flatMap((candidate) =>
            byKind[candidate].map((item) => ({
                id: String(item.id),
                kind: candidate,
                name: item.name,
            })),
        );
        // `wants` reads `kind` only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, meals.data, sauces.data, dressings.data, frozen.data]);

    const open = (row: UnformulatedRow) => {
        router.push(
            `/kitchen/recipes/item/${encodeURIComponent(row.id)}?kind=${row.kind}` as never,
        );
    };
    const title = `${t('kitchen:stockBlockers.unformulatedTitle')} · ${t(
        'kitchen:stockBlockers.unformulatedCount',
        { count: rows.length },
    )}`;

    /*
     * Keyed by the kind on screen: switching tabs is not fixing anything, so the cards of the kind
     * left go without ticking green, and the new kind's arrive as they are.
     */
    const inTray = useIssueGroup(
        kind === 'preparation'
            ? null
            : {
                  key: `unformulated-${kind ?? 'all'}`,
                  title,
                  testID,
                  items: rows.map((row) => ({
                      key: `${row.kind}-${row.id}`,
                      tone: 'warning' as const,
                      label: displayName(row.name, locale).value,
                      action: {
                          onPress: () => {
                              open(row);
                          },
                      },
                      testID: `${testID}-${row.id}`,
                  })),
              },
    );

    if (inTray || kind === 'preparation' || rows.length === 0) return null;

    return (
        <Callout
            testID={testID}
            tone="warning"
            title={title}
            actions={rows.slice(0, UNFORMULATED_SHOWN).map((row) => (
                <Button
                    key={row.id}
                    testID={`${testID}-${row.id}`}
                    variant="secondary"
                    size="sm"
                    label={displayName(row.name, locale).value}
                    onPress={() => {
                        open(row);
                    }}
                />
            ))}
        />
    );
}
