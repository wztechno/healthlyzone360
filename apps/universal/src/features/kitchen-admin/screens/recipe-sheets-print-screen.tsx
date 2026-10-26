import type { RecipeSheetBundle } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Card,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
} from '@healthy360/design-system';
import { RecipeId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { queryKeys } from '../../../data/query-keys.ts';
import { useRepositoryContext } from '../../../data/repository-provider.tsx';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { TECHNICAL_SHEETS_MAX } from '../catalogue/list-print.ts';
import { RECIPE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { usePrintSheet } from '../print-sheet.tsx';
import { TechnicalSheetPanel } from '../technical-sheet-panel.tsx';

/**
 * `/kitchen/recipes/sheets?recipes=a,b,c` — technical sheets, one per page (Export → PDF —
 * technical sheets).
 *
 * One batch read whatever the count, like the supply-order sheets: twenty per-recipe queries would
 * be twenty loading states on a page that has to be complete or nothing. The ids are a sequence the
 * list chose, so the page follows it; an id the server did not answer is **named** rather than
 * silently dropped, because a missing page is the one failure nobody sees by counting paper.
 */
export interface RecipeSheetsPrintScreenProps {
    /** The `recipes` query parameter: comma-separated recipe identifiers. */
    readonly recipes?: string | undefined;
}

export function RecipeSheetsPrintScreen({ recipes }: RecipeSheetsPrintScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [RECIPE_VIEW_PERMISSION] }}
            testID="kitchen-recipe-sheets-print"
        >
            <RecipeSheetsPrint recipes={recipes} />
        </Gate>
    );
}

/** The ids a query string names, in order, deduplicated, valid only, and whether it named more than the cap. */
export function parseRecipeIds(raw: string | undefined): {
    readonly ids: readonly RecipeId[];
    readonly truncated: boolean;
} {
    const seen = new Set<string>();
    const ids: RecipeId[] = [];

    for (const segment of (raw ?? '').split(',')) {
        const trimmed = segment.trim();
        if (trimmed === '' || seen.has(trimmed)) continue;
        seen.add(trimmed);
        const id = RecipeId.safeParse(trimmed);
        if (id !== null) ids.push(id);
    }

    return {
        ids: ids.slice(0, TECHNICAL_SHEETS_MAX),
        truncated: ids.length > TECHNICAL_SHEETS_MAX,
    };
}

function RecipeSheetsPrint({ recipes }: RecipeSheetsPrintScreenProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const back = useReturnTo(undefined, '/kitchen/recipes').leave;
    const sheet = usePrintSheet();
    const { repositories } = useRepositoryContext();

    const { ids, truncated } = useMemo(() => parseRecipeIds(recipes), [recipes]);

    const batch = useQuery({
        queryKey: queryKeys.kitchenAdmin.recipeTechnicalSheets(ids),
        enabled: repositories !== null && ids.length > 0,
        queryFn: (): Promise<readonly RecipeSheetBundle[]> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listRecipeTechnicalSheets(ids);
        },
    });

    const backButton = (
        <Button
            testID="kitchen-recipe-sheets-print-back"
            variant="secondary"
            label={t('kitchen:common.back')}
            onPress={back}
        />
    );

    if (ids.length === 0) {
        return (
            <Stack space="lg" testID="kitchen-recipe-sheets-print-screen">
                <Callout
                    testID="kitchen-recipe-sheets-print-nothing"
                    tone="warning"
                    role="alert"
                    title={t('kitchen:transfer.print.expiredTitle')}
                    actions={backButton}
                />
            </Stack>
        );
    }

    if (batch.isPending) {
        return (
            <Stack space="sm" testID="kitchen-recipe-sheets-print-loading">
                {Array.from({ length: Math.min(ids.length, 3) }, (_, index) => (
                    <Card key={index} padding="md">
                        <Skeleton heightClassName="h-5" />
                    </Card>
                ))}
            </Stack>
        );
    }

    const failure = toFailure(batch.error);

    if (failure !== null) {
        return (
            <Stack space="lg" testID="kitchen-recipe-sheets-print-screen">
                <ErrorState
                    testID="kitchen-recipe-sheets-print-error"
                    failure={failure}
                    onRetry={() => {
                        void batch.refetch();
                    }}
                    retrying={batch.isFetching}
                />
                {backButton}
            </Stack>
        );
    }

    const byId = new Map<string, RecipeSheetBundle>(
        (batch.data ?? []).map((bundle) => [String(bundle.recipe.id), bundle]),
    );
    const bundles = ids.flatMap((id) => {
        const bundle = byId.get(String(id));
        return bundle === undefined ? [] : [bundle];
    });
    const missing = ids.filter((id) => !byId.has(String(id)));

    return (
        <Stack space="lg" testID="kitchen-recipe-sheets-print-screen">
            {/* Screen-only: the print block hides it by test id. */}
            <Stack space="sm" testID="kitchen-recipe-sheets-print-toolbar">
                <Inline space="sm" align="center" justify="between" wrap>
                    <Heading level={1} testID="kitchen-recipe-sheets-print-title">
                        {t('kitchen:transfer.sheets.title')}
                    </Heading>

                    <Inline space="sm" align="center" wrap>
                        {backButton}
                        {sheet.mode === 'browser' && bundles.length > 0 ? (
                            <Button
                                testID="kitchen-recipe-sheets-print-action"
                                label={t('kitchen:transfer.print.action')}
                                onPress={sheet.print}
                            />
                        ) : null}
                    </Inline>
                </Inline>

                {sheet.mode === 'browser' ? null : (
                    <Callout
                        testID="kitchen-recipe-sheets-print-native-notice"
                        tone="info"
                        title={t('kitchen:transfer.print.nativeUnavailable')}
                    />
                )}
                {truncated ? (
                    <Callout
                        testID="kitchen-recipe-sheets-print-truncated"
                        tone="warning"
                        title={t('kitchen:transfer.sheets.truncated', {
                            max: TECHNICAL_SHEETS_MAX,
                        })}
                    />
                ) : null}
                {missing.length === 0 ? null : (
                    <Callout
                        testID="kitchen-recipe-sheets-print-missing"
                        tone="warning"
                        role="alert"
                        title={t('kitchen:transfer.sheets.missing', {
                            names: missing.map(String).join(', '),
                        })}
                    />
                )}
            </Stack>

            {/*
             * The sheets and only the sheets are children of this box: the print block breaks the
             * page after each and cancels it on `:last-child`.
             */}
            <Stack space="lg" testID="kitchen-recipe-sheets-print-sheets">
                {bundles.map((bundle) => {
                    const id = String(bundle.recipe.id);
                    return (
                        <View key={id} testID={`kitchen-recipe-sheets-print-sheet-${id}`}>
                            <Stack space="sm">
                                <Heading level={2}>
                                    {displayName(bundle.recipe.name, locale).value}
                                </Heading>
                                <TechnicalSheetPanel
                                    testID={`kitchen-recipe-sheets-print-panel-${id}`}
                                    recipe={bundle.recipe}
                                    version={bundle.recipe.currentVersion}
                                    sheet={bundle.sheet}
                                    isLoading={false}
                                />
                            </Stack>
                        </View>
                    );
                })}
            </Stack>
        </Stack>
    );
}
