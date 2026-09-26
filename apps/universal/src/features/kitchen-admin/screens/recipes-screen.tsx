import {
    Badge,
    Button,
    Dialog,
    Icon,
    Inline,
    Menu,
    SegmentedControl,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { IconName, MenuItem } from '@healthy360/design-system';
import { RECIPE_KINDS } from '@healthy360/api-client/contracts';
import type {
    PublishableStatus,
    RecipeAdminSummary,
    RecipeKind,
    RecipeSoldAs,
} from '@healthy360/api-client/contracts';
import { MealId } from '@healthy360/domain-types';
import type { AllergenCode, KitchenId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useCallback, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import {
    useAdminMealQuery,
    useRecipeKindCountsQuery,
    useRecipeQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import type { RecipeKindCounts } from '../../../data/kitchen-admin-hooks.ts';
import { useSession } from '../../../session/session-provider.tsx';
import {
    CATALOGUE_MANAGE_PERMISSION,
    CATALOGUE_PUBLISH_PERMISSION,
    RECIPE_MANAGE_PERMISSION,
    RECIPE_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { RecipeCardGrid } from '../catalogue/recipe-card-grid.tsx';
import { CatalogueListBody } from '../catalogue/catalogue-list-body.tsx';
import type { ColumnControl } from '../catalogue/use-column-controls.tsx';
import { useColumnControls } from '../catalogue/use-column-controls.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { RecordPhoto } from '../catalogue/record-photo.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import type { CatalogueViewField, RecordViewSection } from '../catalogue/record-view-page.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import { CatalogueTransferActions } from '../catalogue/catalogue-transfer-actions.tsx';
import { statusSegments } from '../catalogue/use-catalogue-filters.ts';
import type { StatusSegmentValue } from '../catalogue/use-catalogue-filters.ts';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import {
    identifierFragment,
    kindsLabel,
    kitchenCategoryPair,
    onSaleStatus,
    packSummary,
    recipeCategoryLabel,
    recipeColumns,
    recipeHandle,
    recipePhotoId,
    sellerChannels,
} from '../catalogue/recipe-columns.tsx';
import type { RecipeListState, RecipeSortKey } from '../catalogue/use-recipe-list.ts';
import { useRecipeList } from '../catalogue/use-recipe-list.ts';
import {
    RECIPE_STATUS_FILTERS,
    channelKey,
    displayName,
    recipeRowTestId,
    statusShortKey,
    statusTone,
} from '../format.ts';
import { ColumnPicker } from '../catalogue/column-picker.tsx';

/**
 * `/kitchen/recipes` — the recipe book: everything this kitchen cooks, on one list.
 *
 * ```
 * Kitchen workspace › Recipes                                <- drawn by the shell, not here
 * [ All 106 | Meals 38 | Sauces & marinations 43 | Dressings 19 | Frozen meals 0 | Preparations 6 ]
 * ┌ SHOWN ┐ ┌ ON SALE ┐ ┌ DRAFT ┐ ┌ AWAITING REVIEW / NO PACK ┐
 * [ ⌕ Search recipes ] [ All | Published | Draft | Review ] [ ☰ | ▦ ] [ Columns · 6 of 6 ]
 *                                                     [ Import ] [ Export ] [ + New recipe ▾ ]
 * ID       RECIPE                        KIND          ALLERGENS      ON SALE    STATUS  ⋯
 * SAC-016  Garlic mayo                   Sauce         Egg, mustard   Published  Draft   ⋯
 * RC-0007  Cordon bleu marination ⚠      Preparation   None derived   —          Draft   ⋯
 * Showing 1–18 of 106                                                   [ ‹ 1 2 3 4 5 6 › ]
 * ```
 *
 * A meal, a sauce, a dressing and a frozen meal are each a recipe with a catalogue item selling
 * it, so the four pages that listed those items are this page read by kind, and a recipe nothing
 * sells is a preparation. The rest is the shape `ingredients-screen.tsx` records in full — no page
 * title and no trail of its own, no summary line (its figures *are* the cards), no density switch,
 * and every control at `sm` except the one `md` primary — and is not restated.
 *
 * ## The kind strip is the only kind control
 *
 * It sits above the cards, bound to `?kind=`, and every tab carries the server's count for it. It
 * is the one place the kind is chosen: the Kind *column* has no header filter on purpose, because
 * hiding a column — or Clear all in the column picker — resets that column's filter, and neither may
 * ever move the reader to another tab. The strip is drawn only for a reader who can see the
 * catalogue; without that permission the server will not say what sells a recipe, and the book is
 * simply the recipes.
 *
 * ## The fourth card follows the tab
 *
 * Shown, On sale and Draft stand on every tab. The fourth is Awaiting review on All, Meals and
 * Preparations — the quarantine a kitchen has to clear before anything can publish — and No pack on
 * Sauces, Dressings and Frozen meals, where a packaged item with no pack has nothing to price
 * against: the read-only figure the packaged-goods pages showed in the same place. On sale is the
 * meal page's Live, counted over what sells each recipe, and it narrows the list through the
 * server's `sellingStatus`. Missing Arabic left the cards; the row still badges it.
 *
 * ## New follows the tab too
 *
 * On All it opens a menu — New meal, sauce, dressing, frozen meal or preparation — and on a kind tab
 * it creates that kind in one press, as the old per-kind pages did. A cooked kind writes a catalogue
 * item beside the recipe, so it needs the catalogue's manage permission as well as the recipe's; a
 * reader with the recipe's alone is offered New preparation. The empty state's action is the tab's
 * own, and a preparation on All.
 *
 * ## The row has up to five actions
 *
 * View · Edit · New draft · Withdraw · Archive. New draft appears only against a version that cannot
 * be edited in place — see `useRecipeList.isImmutable`. Withdraw takes the *item* off sale and is
 * offered only while exactly one item sells the recipe and it is live, to a reader who may publish in
 * the catalogue — the server's own guard on that route. Archive is still the recipe's. The action
 * column measures the widest row on the page, so most rows' three leave its end padded.
 */
export function RecipesScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [RECIPE_VIEW_PERMISSION] }}
            testID="kitchen-recipes"
        >
            <RecipesList />
        </Gate>
    );
}

/** The kitchen a recipe belongs to, by name. See `RecipeColumnDeps.kitchenName`. */
type KitchenName = (kitchenId: KitchenId) => string;

type RecipeLayout = 'table' | 'cards';

/**
 * The six a first visit draws, remembered under `kitchen-recipes.v2` so that every reader of the
 * old five-column table starts from these once rather than keeping a choice that hides Kind.
 */
const DEFAULT_COLUMNS: readonly string[] = [
    'reference',
    'name',
    'kind',
    'allergens',
    'onSale',
    'status',
];

/** The mark each kind is drawn with, on the strip and in the New menu. */
const KIND_ICONS: Readonly<Record<RecipeKind, IconName>> = {
    meal: 'utensils',
    sauce: 'droplet',
    dressing: 'salad',
    frozen_meal: 'snowflake',
    preparation: 'cookingPot',
};

/** The plural each kind is browsed under — the strip's tabs. */
const KIND_TAB_LABEL_KEYS: Readonly<Record<RecipeKind, string>> = {
    meal: 'kitchen:recipes.kindMeals',
    sauce: 'kitchen:sauces.title',
    dressing: 'kitchen:dressings.title',
    frozen_meal: 'kitchen:frozenMeals.title',
    preparation: 'kitchen:recipes.kindPreparations',
};

const CREATE_LABEL_KEYS: Readonly<Record<RecipeKind, string>> = {
    meal: 'kitchen:meals.create',
    sauce: 'kitchen:sauces.create',
    dressing: 'kitchen:dressings.create',
    frozen_meal: 'kitchen:frozenMeals.create',
    preparation: 'kitchen:recipes.createPreparation',
};

function RecipesList() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(RECIPE_MANAGE_PERMISSION);
    const canManageCatalogue = useCan(CATALOGUE_MANAGE_PERMISSION);
    const canWithdraw = useCan(CATALOGUE_PUBLISH_PERMISSION);
    const list = useRecipeList();
    const kindCounts = useRecipeKindCountsQuery(list.sells);
    /*
     * Table or cards — two drawings of the same `list.rows`. Screen state rather than list state:
     * it changes nothing about which rows are asked for, so it has no business in the query key,
     * and the page, sort and filters survive the switch untouched.
     */
    const [layout, setLayout] = useState<RecipeLayout>('table');

    /*
     * A recipe's `kitchenId` is the id of the organisation that owns it, and the session already
     * carries every organisation this person belongs to, with its name. So the Kitchen column and
     * the View panel read the name off the memberships rather than printing a UUID; a kitchen
     * outside the reader's memberships keeps the id.
     */
    const memberships = useSession().me?.memberships;
    const kitchenName = useCallback<KitchenName>(
        (kitchenId) =>
            memberships?.find(
                (membership) => String(membership.organisation.id) === String(kitchenId),
            )?.organisation.name ?? String(kitchenId),
        [memberships],
    );

    /*
     * The one read this screen still makes per record, and it is per *opened* record rather than
     * per row.
     *
     * The list's own cells — the allergen run, the version state, the sellers, whether New draft is
     * offered — come off `RecipeAdminSummary`. The View panel wants one thing the summary
     * deliberately does not carry: each declaration's `containment`, the contains / may-contain
     * distinction it states in words. That is a detail of one record a reader has chosen to look at,
     * so it is fetched when the panel opens and not twenty-five times a page on the chance somebody
     * might.
     */
    const viewedDetail = useRecipeQuery(list.viewing?.id ?? null);
    /*
     * A meal's label is frozen on the item when it is published, and can differ from the recipe's
     * live derivation until the next publish. The meals page's panel showed that frozen label; this
     * one reads it the way the meal editor's rail does — one item read, only while the panel is
     * open on a recipe a meal sells. The packaged kinds carry no label of their own.
     */
    const viewedMealSeller = list.viewing?.soldAs?.find((sold) => sold.itemType === 'meal');
    const viewedMeal = useAdminMealQuery(
        viewedMealSeller === undefined ? null : MealId.unsafe(viewedMealSeller.id),
    );
    const columns = useMemo(
        () =>
            recipeColumns({
                t,
                locale,
                formatter,
                kitchenName,
                sells: list.sells,
                onOpen: (row) => {
                    list.openEditor(String(row.id));
                },
            }),
        // `list.openEditor` is re-created with the hook each render, as the controls' own column
        // objects already are; the memo saves the spec work, not the identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, locale, formatter, kitchenName, list.sells],
    );

    const controls = useColumnControls<RecipeAdminSummary, CatalogueColumn<RecipeAdminSummary>>(
        list.rows,
        columns.map((column) => ({
            ...column,
            ...columnControl(column.key, list, t, locale),
        })),
        'kitchen-recipes',
        {
            sort: {
                key: list.sortKey,
                direction: list.sortDirection,
                onChange: (key, direction) => {
                    if (isRecipeAdminSummarySortKey(key)) list.setSort(key, direction);
                },
            },
            picker: { storageKey: 'kitchen-recipes.v2', defaults: DEFAULT_COLUMNS },
        },
    );

    const segments = statusSegments(list.statuses, list.setStatuses, t);

    /*
     * What this reader may start from here. A cooked kind writes a catalogue item beside the
     * recipe, so it needs the catalogue's manage permission as well — and the catalogue view,
     * without which the book could not show the item it had just written.
     */
    const mayCreate = (kind: RecipeKind): boolean =>
        kind === 'preparation' ? canManage : canManage && canManageCatalogue && list.sells;

    const viewed = list.viewing;
    const viewedAllergens = viewedDetail.data?.currentVersion.allergens ?? [];

    /*
     * View takes the whole page (`IngredientView.dc.html`), in place of the list rather than on a
     * route of its own — Back is a state change, so the list's page, sort, filters and tab survive
     * it.
     */
    if (viewed !== null) {
        return (
            <RecordViewPage
                testID="kitchen-recipes-view"
                media={
                    <RecordPhoto
                        assetId={recipePhotoId(viewed)}
                        label={displayName(viewed.name, locale).value}
                        shape="wide"
                        testID="kitchen-recipes-view-photo"
                    />
                }
                kind={kindsLabel(viewed, t) ?? t('kitchen:recipes.viewKind')}
                reference={recipeHandle(viewed)}
                title={displayName(viewed.name, locale).value}
                status={{
                    tone: statusTone(viewed.meta.status),
                    label: t(statusShortKey(viewed.meta.status)),
                }}
                fields={viewFields(viewed, t, formatter, locale, kitchenName)}
                onBack={list.closeView}
                primaryAction={{
                    label: t('kitchen:catalogue.edit'),
                    testID: 'kitchen-recipes-view-edit',
                    onPress: () => {
                        list.closeView();
                        list.openEditor(String(viewed.id));
                    },
                }}
                rail={
                    (viewed.soldAs ?? []).length === 0
                        ? undefined
                        : [
                              channelSection(viewed, t),
                              ...(viewedMealSeller === undefined
                                  ? []
                                  : [frozenLabelSection(viewedMeal.data?.allergens, t)]),
                          ]
                }
                {...(viewedAllergens.length === 0
                    ? {}
                    : {
                          chipsLabel: t('kitchen:recipes.columnAllergens'),
                          chipsSourceBadge: t('kitchen:recipes.viewAllergensSource'),
                          chipsCaption: t('kitchen:recipes.viewAllergensCaption'),
                          chips: viewedAllergens.map((declaration) => ({
                              key: declaration.allergenCode,
                              label: declaration.allergenCode,
                              tone:
                                  declaration.containment === 'contains'
                                      ? ('danger' as const)
                                      : ('warning' as const),
                          })),
                      })}
            />
        );
    }

    // The empty state offers the tab's own kind, and a preparation on All.
    const emptyKind = list.kind ?? 'preparation';

    return (
        <Stack space="md" testID="kitchen-recipes-screen">
            {list.isPending ? null : (
                <CatalogueStatCards testID="kitchen-recipes-stats" cards={statCards(list, t)} />
            )}

            {/*
             * The search and filter bar, then the kind strip under it, both directly over the list
             * they narrow — two matching cards at 8px, so they read as one set of controls. The
             * strip stands outside the pending guard, so the tabs do not blink while a new tab's
             * page loads.
             */}
            <Stack space="sm">
                <CatalogueToolbar<StatusSegmentValue>
                    testID="kitchen-recipes-toolbar"
                    search={list.query}
                    onSearchChange={list.setQuery}
                    searchLabel={t('kitchen:toolbar.searchLabel')}
                    searchPlaceholder={t('kitchen:toolbar.searchRecipes')}
                    statusLabel={t('kitchen:toolbar.statusLabel')}
                    statusSegments={segments.segments}
                    status={segments.value}
                    onStatusChange={segments.onChange}
                >
                    <Inline space="xs" align="center">
                        <SegmentedControl<RecipeLayout>
                            testID="kitchen-recipes-layout"
                            label={t('kitchen:list.layoutLabel')}
                            value={layout}
                            onChange={setLayout}
                            items={[
                                {
                                    value: 'table',
                                    label: t('kitchen:list.layoutTable'),
                                    icon: 'list',
                                    testID: 'kitchen-recipes-layout-table',
                                },
                                {
                                    value: 'cards',
                                    label: t('kitchen:list.layoutCards'),
                                    icon: 'layoutGrid',
                                    testID: 'kitchen-recipes-layout-cards',
                                },
                            ]}
                        />
                        {/* Columns are a table's question; a card draws every field it has. */}
                        {layout === 'table' ? <ColumnPicker {...controls.picker} /> : null}
                    </Inline>
                    {canManage ? (
                        <Inline space="xs" align="center">
                            <CatalogueTransferActions testID="kitchen-recipes-toolbar" />
                            <RecipeCreateControl
                                kind={list.kind}
                                mayCreate={mayCreate}
                                onCreate={list.createNew}
                            />
                        </Inline>
                    ) : undefined}
                </CatalogueToolbar>
                {list.sells ? (
                    <RecipeKindStrip
                        value={list.kind}
                        onChange={list.setKind}
                        counts={kindCounts.data}
                    />
                ) : null}
            </Stack>

            <CatalogueListBody
                testID="kitchen-recipes"
                list={list}
                empty={{
                    title: t('kitchen:recipes.emptyTitle'),
                    body: t('kitchen:recipes.emptyBody'),
                }}
                filteredEmpty={{
                    title: t('kitchen:recipes.filteredEmptyTitle'),
                    body: t('kitchen:recipes.filteredEmptyBody'),
                }}
                create={
                    mayCreate(emptyKind)
                        ? {
                              label: t(CREATE_LABEL_KEYS[emptyKind]),
                              onPress: () => {
                                  list.createNew(emptyKind);
                              },
                          }
                        : undefined
                }
            >
                {layout === 'cards' ? (
                    <RecipeCardGrid
                        testID="kitchen-recipes-cards"
                        rows={list.rows}
                        t={t}
                        locale={locale}
                        kitchenName={kitchenName}
                        onOpen={(row) => {
                            list.openEditor(String(row.id));
                        }}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row) =>
                            rowActions(row, list, t, toast, canManage, canWithdraw)
                        }
                    />
                ) : (
                    <CatalogueList
                        testID="kitchen-recipes-table"
                        label={t('kitchen:recipes.caption')}
                        columns={controls.columns}
                        rows={list.rows}
                        rowKey={(row) => String(row.id)}
                        // Fixed, not switchable: the S/M/L control is gone.
                        density="sm"
                        onRowPress={(row) => {
                            list.openEditor(String(row.id));
                        }}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row) =>
                            rowActions(row, list, t, toast, canManage, canWithdraw)
                        }
                    />
                )}
            </CatalogueListBody>

            {/*
             * Retiring *is* the archive: the contract has no `archiveRecipe`, and nothing is
             * deleted because meals, products and cost snapshots still point at the version. A
             * refusal — a recipe a published item still sells — arrives as the server's own
             * sentence, which this dialog already renders.
             */}
            <Dialog
                testID="kitchen-recipes-archive-dialog"
                open={list.archiving !== null}
                onClose={list.cancelArchive}
                title={t('kitchen:recipes.archiveTitle')}
                description={t('kitchen:recipes.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-recipes-archive-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={list.cancelArchive}
                        />
                        <Button
                            testID="kitchen-recipes-archive-confirm"
                            variant="danger"
                            label={t('kitchen:recipes.archiveConfirm')}
                            loading={list.isArchivePending}
                            onPress={() => {
                                list.confirmArchive((name) => {
                                    toast.show({
                                        testID: 'kitchen-recipes-archived-toast',
                                        tone: 'success',
                                        message: t('kitchen:recipes.archivedToast', { name }),
                                    });
                                });
                            }}
                        />
                    </>
                }
            >
                {list.archiveFailure === null ? null : (
                    <Text testID="kitchen-recipes-archive-error" tone="danger">
                        {list.archiveFailure.message ?? t('kitchen:recipes.archiveFailed')}
                    </Text>
                )}
            </Dialog>

            {/*
             * Withdrawing takes the item off the menu and every channel; the recipe stays, and
             * nothing is deleted — orders and price lists still point at the item. The dialog says
             * so because "withdraw" and "delete" must not read as one word.
             */}
            <Dialog
                testID="kitchen-recipes-withdraw-dialog"
                open={list.withdrawing !== null}
                onClose={list.cancelWithdraw}
                title={t('kitchen:recipes.withdrawTitle')}
                description={t('kitchen:recipes.withdrawBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-recipes-withdraw-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={list.cancelWithdraw}
                        />
                        <Button
                            testID="kitchen-recipes-withdraw-confirm"
                            variant="danger"
                            label={t('kitchen:meals.retireConfirm')}
                            loading={list.isWithdrawPending}
                            onPress={() => {
                                list.confirmWithdraw((name) => {
                                    toast.show({
                                        testID: 'kitchen-recipes-withdrawn-toast',
                                        tone: 'success',
                                        message: t('kitchen:recipes.withdrawnToast', { name }),
                                    });
                                });
                            }}
                        />
                    </>
                }
            >
                {list.withdrawFailure === null ? null : (
                    <Text testID="kitchen-recipes-withdraw-error" tone="danger">
                        {list.withdrawFailure.message ?? t('kitchen:recipes.withdrawFailed')}
                    </Text>
                )}
            </Dialog>
        </Stack>
    );
}

/**
 * All · Meals · Sauces & marinations · Dressings · Frozen meals · Preparations, each with its count.
 *
 * A count is the server's `totalCount` for that kind, so a recipe sold as two kinds is counted under
 * both — the same rule the tabs filter by. A kind the server could not count shows no figure rather
 * than a zero it does not know.
 */
function RecipeKindStrip({
    value,
    onChange,
    counts,
}: {
    readonly value: RecipeKind | null;
    readonly onChange: (kind: RecipeKind | null) => void;
    readonly counts: RecipeKindCounts | undefined;
}) {
    const { t } = useTranslation();
    // ponytail: All is the sum of the kinds, so a recipe sold as two kinds counts twice there;
    // a sixth unfiltered count is the fix if mixed recipes stop being rare.
    const all =
        counts === undefined
            ? undefined
            : RECIPE_KINDS.reduce<number | undefined>((sum, kind) => {
                  const count = counts[kind];
                  return sum === undefined || count === null ? undefined : sum + count;
              }, 0);

    return (
        /*
         * The toolbar's own card — panel radius, border, raised fill and cast, 8px inset — so the
         * strip reads as the second row of the same controls rather than a loose band of tabs.
         * `block`: the six tabs share the card's width equally instead of packing at its start.
         */
        <View
            testID="kitchen-recipes-kind-card"
            className="rounded-panel border border-brand-100 bg-surface-raised p-tight shadow-elevation-card"
        >
            <SegmentedControl<RecipeKind | 'all'>
                testID="kitchen-recipes-kind"
                label={t('kitchen:recipes.columnKind')}
                block
                value={value ?? 'all'}
                onChange={(next) => {
                    onChange(next === 'all' ? null : next);
                }}
                items={[
                    {
                        value: 'all',
                        label: t('kitchen:toolbar.statusAll'),
                        icon: 'bookOpen',
                        count: all,
                        testID: 'kitchen-recipes-kind-all',
                    },
                    ...RECIPE_KINDS.map((kind) => ({
                        value: kind,
                        label: t(KIND_TAB_LABEL_KEYS[kind]),
                        icon: KIND_ICONS[kind],
                        count: counts?.[kind] ?? undefined,
                        testID: `kitchen-recipes-kind-${kind}`,
                    })),
                ]}
            />
        </View>
    );
}

/**
 * New — a menu of every kind on All, one press on a kind tab.
 *
 * The trigger keeps one id in both shapes, so the control a suite presses is the same control
 * whichever tab the reader is on. Nothing is drawn when the reader may create nothing here.
 */
function RecipeCreateControl({
    kind,
    mayCreate,
    onCreate,
}: {
    readonly kind: RecipeKind | null;
    readonly mayCreate: (kind: RecipeKind) => boolean;
    readonly onCreate: (kind: RecipeKind) => void;
}) {
    const { t } = useTranslation();

    if (kind !== null) {
        return mayCreate(kind) ? (
            <Button
                testID="kitchen-recipes-toolbar-create"
                label={t(CREATE_LABEL_KEYS[kind])}
                iconStart={<Icon name="plus" size="sm" />}
                onPress={() => {
                    onCreate(kind);
                }}
            />
        ) : null;
    }

    const creatable = RECIPE_KINDS.filter(mayCreate);
    if (creatable.length === 0) return null;

    return (
        <Menu
            testID="kitchen-recipes-create"
            label={t('kitchen:toolbar.createRecipe')}
            align="end"
            sections={[
                {
                    items: creatable.map((option) => ({
                        key: option,
                        label: t(CREATE_LABEL_KEYS[option]),
                        icon: KIND_ICONS[option],
                        testID: `kitchen-recipes-toolbar-create-${option}`,
                        onSelect: () => {
                            onCreate(option);
                        },
                    })),
                },
            ]}
            trigger={({ triggerProps, toggle }) => (
                <Button
                    {...triggerProps}
                    testID="kitchen-recipes-toolbar-create"
                    label={t('kitchen:toolbar.createRecipe')}
                    iconStart={<Icon name="plus" size="sm" />}
                    iconEnd={<Icon name="chevronDown" size="sm" />}
                    onPress={toggle}
                />
            )}
        />
    );
}

/**
 * View · Edit · New draft · Withdraw · Archive, in the design's order.
 *
 * Above `md` these are flat icon buttons on the row; below it the same array becomes the overflow
 * menu, because a narrow row has space for exactly one control.
 *
 * **New draft is conditional and that is the point.** A published or retired version is immutable,
 * so the only way to change it is to open its successor; offering the control against a draft that
 * is already open would write a version bump that changed nothing.
 *
 * **Withdraw is the seller's.** It sits beside Archive rather than in place of it, because the two
 * act on different records: Withdraw takes the one item that sells the recipe off sale, and Archive
 * retires the recipe itself.
 */
function rowActions(
    row: RecipeAdminSummary,
    list: RecipeListState,
    t: TFunction,
    toast: ReturnType<typeof useToast>,
    canManage: boolean,
    canWithdraw: boolean,
): readonly MenuItem[] {
    const testID = recipeRowTestId(String(row.id));
    const live = row.meta.status !== 'retired';

    return [
        {
            key: 'view',
            label: t('kitchen:list.view'),
            icon: CATALOGUE_ROW_ICONS.view,
            testID: `${testID}-view`,
            onSelect: () => {
                list.openView(row);
            },
        },
        {
            key: 'edit',
            label: t('kitchen:catalogue.edit'),
            icon: CATALOGUE_ROW_ICONS.edit,
            testID: `${testID}-open`,
            onSelect: () => {
                list.openEditor(String(row.id));
            },
        },
        ...(canManage && live && list.isImmutable(row)
            ? [
                  {
                      key: 'newDraft',
                      label: t('kitchen:recipes.newDraft'),
                      icon: 'plus' as const,
                      disabled: list.draftOpeningFor !== null,
                      testID: `${testID}-new-draft`,
                      onSelect: () => {
                          list.startDraft(row, (version) => {
                              toast.show({
                                  testID: 'kitchen-recipes-draft-opened-toast',
                                  tone: 'success',
                                  message: t('kitchen:recipes.draftOpenedToast', {
                                      number: version,
                                  }),
                              });
                          });
                      },
                  },
              ]
            : []),
        ...(canWithdraw && list.isWithdrawable(row)
            ? [
                  {
                      key: 'withdraw',
                      label: t('kitchen:meals.retire'),
                      icon: 'ban' as const,
                      tone: 'danger' as const,
                      testID: `${testID}-withdraw`,
                      onSelect: () => {
                          list.askToWithdraw(row);
                      },
                  },
              ]
            : []),
        ...(canManage && live
            ? [
                  {
                      key: 'archive',
                      label: t('kitchen:recipes.archive'),
                      icon: CATALOGUE_ROW_ICONS.archive,
                      tone: 'danger' as const,
                      testID: `${testID}-archive`,
                      onSelect: () => {
                          list.askToArchive(row);
                      },
                  },
              ]
            : []),
    ];
}

/**
 * The four figures the summary line used to state, as cards.
 *
 * `total` is the server's count for the filtered set; the three beside it are counted over the
 * loaded page, which is the only set this screen has. That difference is why Shown reads "18 of 84"
 * rather than claiming the others are catalogue-wide.
 *
 * Every card is a filter the request carries except No pack — the contract has no parameter for it,
 * and a card that looked pressable and did nothing would be worse than one that plainly does not.
 */
function statCards(list: RecipeListState, t: TFunction): readonly CatalogueStatCard[] {
    const shown: CatalogueStatCard = {
        key: 'shown',
        label: t('kitchen:list.statShown'),
        value: String(list.shown),
        unit: t('kitchen:list.statShownUnit', { total: list.total ?? list.shown }),
        caption: list.isUnfiltered
            ? t('kitchen:list.statShownUnfiltered')
            : t('kitchen:list.statShownFiltered'),
        mark: 'list',
        tone: 'brand',
        // Pressable in both states: clearing nothing is a no-op, and a card that stopped being
        // a target once the filters were clear would move the row's one affordance around.
        onPress: list.clearFilters,
        accessibilityLabel: t('kitchen:list.statShownAction'),
    };
    // What a shopper can buy now, whichever kind sells it — the meal page's Live, for the book.
    const onSale: CatalogueStatCard = {
        key: 'onSale',
        label: t('kitchen:recipes.columnOnSale'),
        value: String(list.onSaleCount),
        unit: t('kitchen:list.statRecords'),
        caption: t('kitchen:recipes.statOnSaleCaption'),
        mark: 'eye',
        onPress: () => {
            list.setSellingStatus('published');
        },
        accessibilityLabel: t('kitchen:recipes.statOnSaleAction'),
    };
    const draft: CatalogueStatCard = {
        key: 'draft',
        label: t('kitchen:list.statDraft'),
        value: String(list.draftCount),
        unit: t('kitchen:list.statRecords'),
        caption: t('kitchen:list.statDraftCaption'),
        mark: 'fileDraft',
        // Amber only while there is something to act on — see the note in the component.
        tone: list.draftCount === 0 ? 'default' : 'warning',
        onPress: () => {
            list.setStatuses(['draft']);
        },
        accessibilityLabel: t('kitchen:list.statDraftAction'),
    };
    const review: CatalogueStatCard = {
        key: 'review',
        label: t('kitchen:recipes.statReview'),
        value: String(list.reviewCount),
        unit: t('kitchen:list.statRecords'),
        caption: t('kitchen:recipes.statReviewCaption'),
        mark: 'alert',
        // The one figure that blocks publication outright, so it takes the danger ink while
        // there is anything in it — and the ordinary raised fill, because the row spends its
        // one coloured panel on Draft.
        tone: list.reviewCount === 0 ? 'default' : 'danger',
        onPress: () => {
            list.setStatuses(['review_required']);
        },
        accessibilityLabel: t('kitchen:recipes.statReviewAction'),
    };
    // The packaged-goods pages' figure, in the slot they drew it in: a packaged item with no pack
    // has nothing a price list can point at.
    const noPack: CatalogueStatCard = {
        key: 'noPack',
        label: t('kitchen:products.statNoPack'),
        value: String(list.noPackCount),
        unit: t('kitchen:list.statRecords'),
        caption: t('kitchen:products.statNoPackCaption'),
        mark: 'package',
        tone: list.noPackCount === 0 ? 'default' : 'warning',
    };
    const packaged =
        list.kind === 'sauce' || list.kind === 'dressing' || list.kind === 'frozen_meal';

    return [shown, ...(list.sells ? [onSale] : []), draft, packaged ? noPack : review];
}

/** The sellers' channels as badges, in their own rail card. An empty set says so in words. */
/**
 * The label the meal carries in the shop — frozen from the recipe version at publication.
 *
 * Drawn even when empty, for the reason the meals page's panel gave: on the one field a kitchen
 * reads for safety, "this meal declares none" and "nobody has looked" are the two answers that most
 * need telling apart. `undefined` is the read still in flight, and draws nothing yet.
 */
function frozenLabelSection(
    codes: readonly AllergenCode[] | undefined,
    t: TFunction,
): RecordViewSection {
    return {
        key: 'frozen-allergens',
        title: t('kitchen:recipes.viewAllergensFrozen'),
        content:
            codes === undefined ? null : codes.length === 0 ? (
                <Text tone="secondary">{t('kitchen:list.noAllergens')}</Text>
            ) : (
                <Inline space="xs">
                    {codes.map((code) => (
                        <Badge
                            key={String(code)}
                            testID={`kitchen-recipes-view-frozen-allergen-${String(code)}`}
                            tone="danger"
                            label={String(code)}
                        />
                    ))}
                </Inline>
            ),
    };
}

function channelSection(row: RecipeAdminSummary, t: TFunction): RecordViewSection {
    const channels = sellerChannels(row.soldAs ?? []);

    return {
        key: 'channels',
        title: t('kitchen:products.columnChannels'),
        content: (
            <Stack space="sm">
                {channels.length === 0 ? (
                    <Text tone="secondary">{t('kitchen:products.noChannels')}</Text>
                ) : (
                    <Inline space="xs">
                        {channels.map((channel) => (
                            <Badge
                                key={channel}
                                testID={`kitchen-recipes-view-channel-${channel}`}
                                tone="info"
                                label={t(channelKey(channel))}
                            />
                        ))}
                    </Inline>
                )}
                <Text variant="caption" tone="secondary">
                    {t('kitchen:products.viewChannelsCaption')}
                </Text>
            </Stack>
        ),
    };
}

/**
 * The record, as the read-only panel lists it.
 *
 * The values the row already carries plus the ones it has no track for — the recipe's own handle
 * beside the one the list is read by, the version count in words, who last touched it — and, for a
 * recipe something sells, every field the departing meal and packaged-goods panels showed, read off
 * the first seller. Absent values render the dash rather than being dropped: a panel whose rows
 * change position depending on what is filled in cannot be scanned twice the same way.
 */
function viewFields(
    row: RecipeAdminSummary,
    t: TFunction,
    formatter: Formatter,
    locale: string,
    kitchenName: KitchenName,
): readonly CatalogueViewField[] {
    const dash = t('kitchen:list.noValue');
    const seller = row.soldAs?.[0];
    const onSale = onSaleStatus(row);

    return [
        {
            key: 'reference',
            label: t('kitchen:list.columnReference'),
            value: recipeHandle(row),
            mono: true,
        },
        {
            // The recipe's own `RC-` — the one the editor's Id field shows. The field above is the
            // seller's `SAC-` when something sells the recipe, which is what the list is read by.
            key: 'handle',
            label: t('kitchen:recipes.viewHandle'),
            value: identifierFragment(row.reference ?? row.slug),
            mono: true,
        },
        {
            key: 'kitchen',
            label: t('kitchen:recipes.columnKitchen'),
            value: kitchenName(row.kitchenId),
        },
        // Only for a reader who can see what sells the recipe; a dash would claim nothing does.
        ...(row.soldAs === undefined
            ? []
            : [
                  {
                      key: 'onSale',
                      label: t('kitchen:recipes.columnOnSale'),
                      value: onSale === null ? dash : t(statusShortKey(onSale)),
                  },
              ]),
        ...(seller === undefined ? [] : sellerFields(seller, t, formatter, locale, dash)),
        {
            key: 'version',
            label: t('kitchen:recipes.columnVersion'),
            value: t('kitchen:recipes.versionNumber', { number: row.currentVersionNumber }),
            mono: true,
        },
        {
            key: 'versionState',
            label: t('kitchen:recipes.columnVersionState'),
            value: t(statusShortKey(row.currentVersionStatus)),
        },
        {
            key: 'versionCount',
            label: t('kitchen:recipes.sectionVersions'),
            value: t('kitchen:recipes.versionCount', { count: row.versionCount }),
        },
        {
            key: 'status',
            label: t('kitchen:status.label'),
            value: t(statusShortKey(row.meta.status)),
        },
        {
            key: 'updated',
            label: t('kitchen:catalogue.columnUpdated'),
            value: formatter.formatRelativeTime(row.meta.updatedAt),
        },
        {
            key: 'updatedBy',
            label: t('kitchen:list.updatedBy', { name: '' }).trim(),
            value: row.meta.updatedByName ?? t('kitchen:list.updatedBySeed'),
        },
    ];
}

/**
 * What the item selling the recipe says about itself — the meal panel's visibility and portion, the
 * packaged-goods panel's filing pair, caveats and packs.
 *
 * The margin stays out, as it did on the meal panel: it is CONFIDENTIAL, and this panel opens from a
 * list that asks only for the view permissions.
 */
function sellerFields(
    seller: RecipeSoldAs,
    t: TFunction,
    formatter: Formatter,
    locale: string,
    dash: string,
): readonly CatalogueViewField[] {
    const yesNo = (value: boolean): string =>
        value ? t('kitchen:common.yes') : t('kitchen:common.no');

    return [
        ...(seller.itemType === 'meal'
            ? [
                  {
                      key: 'visible',
                      label: t('kitchen:meals.viewVisibility'),
                      value:
                          seller.status === 'published'
                              ? t('kitchen:meals.visibleToConsumers')
                              : t('kitchen:meals.notVisibleToConsumers'),
                  },
              ]
            : []),
        {
            // The portion sold, relative to one recipe serving — it rescales every nutrition figure
            // a customer reads *and* the stock each sale consumes, and it is on no track.
            key: 'portion',
            label: t('kitchen:meals.portionLabel'),
            value: formatter.formatNumber(seller.portionFactor),
            mono: true,
        },
        {
            key: 'composition',
            label: t('kitchen:fields.composition'),
            value: seller.composition ?? dash,
        },
        {
            // The kitchen's own filing, as the workbook transcribed it — "Sub-category", because the
            // row's Category is the recipe's filing word and two fields called Category tell a
            // reader nothing about which is which.
            key: 'kitchenCategory',
            label: t('kitchen:fields.subcategory'),
            value: kitchenCategoryPair(seller) ?? dash,
        },
        {
            key: 'pricing',
            label: t('kitchen:products.marketPricedShort'),
            value: yesNo(seller.isMarketPriced),
        },
        {
            key: 'assorted',
            label: t('kitchen:products.assortedShort'),
            value: yesNo(seller.isAssorted),
        },
        {
            key: 'dataQuality',
            label: t('kitchen:products.columnFlags'),
            value:
                seller.dataQualityFlags.length === 0
                    ? dash
                    : t('kitchen:products.dataQualityCount', {
                          count: seller.dataQualityFlags.length,
                      }),
        },
        {
            key: 'defaultPack',
            label: t('kitchen:products.viewDefaultPack'),
            value:
                seller.defaultPack === null
                    ? t('kitchen:products.noPacks')
                    : packSummary(seller.defaultPack, t, locale, formatter),
            mono: true,
        },
        {
            key: 'packs',
            label: t('kitchen:products.columnPacks'),
            value: t('kitchen:products.packCount', { count: seller.packCount }),
            mono: true,
        },
    ];
}

/**
 * What one column's header does — handed to `useColumnControls`, which draws it.
 *
 * Only what `RecipeAdminFilter` carries. Allergens filters against the server even though the
 * label is derived per row: `RecipeIndexController` matches the same version
 * `pickCurrentRecipeVersion` names, so the count, the pager and every page agree with the column.
 * Kind has no control at all — the strip is the kind control, and a header filter here would be
 * reset by hiding the column, which must never move the reader's tab.
 */
function columnControl(
    key: string,
    list: RecipeListState,
    t: TFunction,
    locale: string,
): ColumnControl<RecipeAdminSummary> {
    if (key === 'allergens') {
        // Every class the platform declares, not only the ones on the loaded page — a page-derived
        // menu makes the classes nobody on this page carries look as though nothing declares them.
        return {
            filter: {
                values: () =>
                    list.allergenClasses.map((entry) => ({
                        key: entry.code,
                        label: displayName(entry.name, locale).value,
                    })),
                external: {
                    value: list.allergen,
                    onChange: (next) => {
                        list.setAllergen(
                            list.allergenClasses.find((entry) => entry.code === next)?.code ?? null,
                        );
                    },
                },
            },
        };
    }
    if (key === 'status') {
        return {
            sort: 'external',
            filter: {
                values: () =>
                    RECIPE_STATUS_FILTERS.map((status: PublishableStatus) => ({
                        key: status,
                        label: t(statusShortKey(status)),
                    })),
                external: {
                    value: list.statuses[0] ?? null,
                    onChange: (next) => {
                        list.setStatuses(next === null ? [] : [next as PublishableStatus]);
                    },
                },
            },
        };
    }
    if (key === 'category') {
        return {
            filter: {
                // ponytail: page-derived vocabulary; add a derive query if the first page misses words
                // The applied word is always offered, so the tick and the way out stay in the menu.
                values: (rows) =>
                    [...new Set([...rows.map((row) => row.recipeCategory), list.category])]
                        .filter((word): word is string => word !== null && word !== '')
                        .map((word) => ({
                            key: word,
                            label: recipeCategoryLabel(word, t) ?? word,
                        }))
                        .sort((left, right) => left.label.localeCompare(right.label, locale)),
                external: {
                    value: list.category,
                    onChange: list.setCategory,
                },
            },
        };
    }
    if (key === 'onSale') {
        // The item's state, through the server's `sellingStatus` — the same four the Status
        // header offers, Archived included.
        return {
            filter: {
                values: () =>
                    RECIPE_STATUS_FILTERS.map((status) => ({
                        key: status,
                        label: t(statusShortKey(status)),
                    })),
                external: {
                    value: list.sellingStatus,
                    onChange: (next) => {
                        list.setSellingStatus(
                            RECIPE_STATUS_FILTERS.find((status) => status === next) ?? null,
                        );
                    },
                },
            },
        };
    }
    return isRecipeAdminSummarySortKey(key) ? { sort: 'external' } : {};
}

function isRecipeAdminSummarySortKey(key: string): key is RecipeSortKey {
    return (
        key === 'reference' ||
        key === 'name' ||
        key === 'kitchen' ||
        key === 'version' ||
        key === 'status' ||
        key === 'updatedAt'
    );
}
