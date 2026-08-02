import { Button, Callout, Skeleton, Stack } from '@healthy360/design-system';
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

/**
 * Route-level code splitting.
 *
 * ## Why a route needs this at all
 *
 * Expo Router builds its route table with `require.context` over `app/`, so **every** route module
 * and everything it imports statically lands in the entry chunk — the one file a first-time visitor
 * waits for before anything at all appears. That is the right default for a consumer marketplace
 * where any page may be the landing page, and the wrong one for a staff workspace: the kitchen
 * admin area is twelve screens of editors that only somebody signed in with
 * `catalogue.view_organisation` will ever open, and a person browsing meal plans on a phone should
 * not download the price-list editor to do it.
 *
 * A route file that goes through {@link lazyScreen} keeps its route registration in the entry
 * graph — the router still knows the path exists, `typedRoutes` still type-checks links to it — and
 * moves the *screen* behind a dynamic `import()`. Metro's web export emits one async chunk per
 * dynamic import, so the screen's code (and everything only it imports: the row editors, the
 * kitchen-admin query hooks, the format helpers) leaves the entry chunk and is fetched when the
 * route is actually visited.
 *
 * ## One chunk per area, not one per screen
 *
 * Every route in an area imports that area's **screen barrel** (`features/…/screens/index.ts`)
 * rather than its own screen module, so Metro emits one chunk for the whole workspace. The entry
 * bundle is exactly as much smaller either way — the code leaves it either way — but a person moving
 * from the kitchen hub to the recipe book to a recipe pays one fetch instead of three, each of which
 * would otherwise sit on the critical path of a click. The rule is written down in
 * `features/kitchen-admin/screens/index.ts`, which is the barrel the next slice extends.
 *
 * ## Why this is not `React.lazy` + `Suspense`
 *
 * It was, first, and it was wrong. Under Expo Router on React 19 a route that suspends during a
 * navigation transition **intermittently keeps its fallback forever**: the chunk arrives — the
 * network log shows one 200 and no retry — and the boundary never swaps. It reproduces on a
 * navigation from one route of an area to another, at roughly one attempt in three, and it survives
 * both a per-screen and a per-area chunk layout, so it is the boundary rather than the loading. A
 * navigation that sometimes ends in a permanent spinner is not a defect worth shipping to save a
 * dozen lines.
 *
 * So the module is loaded in an effect and held in state instead. `import()` is still an `import()`
 * — Metro still emits the chunk, which is the whole point — but the swap is an ordinary `setState`
 * with no dependence on Suspense's retry mechanism, and the resolved module is cached per call site
 * so a second visit renders it on the first frame.
 *
 * ## Native
 *
 * Metro resolves a dynamic import on native by inlining the module rather than splitting it, so
 * native behaviour is one extra effect tick and nothing else. The split is a web-export property;
 * the source is the same source on both platforms.
 */

/**
 * The fallback a split route shows while its chunk is in flight.
 *
 * Deliberately the same shape as the pending state of the screens behind it — a heading-sized bar
 * and two content blocks — because the alternative, a centred spinner on an empty page, makes a
 * fast chunk look like a flash of nothing and a slow one look like a broken page.
 *
 * `role="status"` + `aria-busy` on the wrapper is what carries the meaning: the {@link Skeleton}
 * blocks are `aria-hidden` by design (announcing a placeholder rectangle is noise), so without the
 * labelled region there would be nothing at all for assistive technology to report.
 */
export function ScreenLoading({ testID }: { readonly testID: string }) {
    const { t } = useTranslation();
    const label = t('common:state.loading');

    return (
        <View
            testID={testID}
            role="status"
            accessibilityRole="progressbar"
            accessibilityLabel={label}
            aria-label={label}
            aria-busy
            aria-live="polite"
        >
            <Stack space="md">
                <Skeleton testID={`${testID}-1`} heightClassName="h-8" widthClassName="w-2/3" />
                <Skeleton testID={`${testID}-2`} heightClassName="h-32" />
                <Skeleton testID={`${testID}-3`} heightClassName="h-32" />
            </Stack>
        </View>
    );
}

/**
 * What a route shows when its own code could not be fetched.
 *
 * A chunk that fails to arrive is a network failure, not an application error, and it is the one
 * failure in this application that a person can nearly always clear by trying again — so the state
 * says that and offers the retry, rather than leaving a spinner up forever or throwing into a blank
 * page. The copy is `common:` because nothing about it belongs to a feature.
 */
function ScreenLoadFailed({
    testID,
    onRetry,
}: {
    readonly testID: string;
    readonly onRetry: () => void;
}) {
    const { t } = useTranslation();

    return (
        <View testID={testID}>
            <Callout
                role="alert"
                tone="danger"
                title={t('common:network.offlineTitle')}
                body={t('common:network.offlineBody')}
                actions={
                    <Button
                        testID={`${testID}-retry`}
                        variant="secondary"
                        label={t('common:action.retry')}
                        onPress={onRetry}
                    />
                }
            />
        </View>
    );
}

/**
 * Loads a screen's module on mount and renders it once it is there.
 *
 * `load` returns the component rather than a module namespace, so the call site reads as
 * `async () => (await import('…/screens/index.ts')).ProductsScreen`.
 *
 * @param testID identifies the fallback, so a test can assert the boundary rendered.
 */
export function lazyScreen<Props extends object>(
    testID: string,
    load: () => Promise<ComponentType<Props>>,
): ComponentType<Props> {
    /** Resolved once per call site and kept, so re-entering the route costs no frame. */
    let cached: ComponentType<Props> | null = null;
    /** In flight, so two mounts of the same route do not import twice. Cleared on failure. */
    let pending: Promise<ComponentType<Props>> | null = null;

    function start(): Promise<ComponentType<Props>> {
        pending ??= load().then(
            (component) => {
                cached = component;
                return component;
            },
            (error: unknown) => {
                // Cleared so the retry control can genuinely try again rather than re-await a
                // promise that has already rejected.
                pending = null;
                throw error;
            },
        );
        return pending;
    }

    return function LazyScreen(props: Props) {
        const [loaded, setLoaded] = useState<ComponentType<Props> | null>(() => cached);
        const [failed, setFailed] = useState(false);
        const [attempt, setAttempt] = useState(0);

        useEffect(() => {
            if (cached !== null) {
                setLoaded(() => cached);
                return;
            }

            let alive = true;
            start().then(
                (component) => {
                    if (alive) setLoaded(() => component);
                },
                () => {
                    if (alive) setFailed(true);
                },
            );

            return () => {
                alive = false;
            };
        }, [attempt]);

        if (loaded !== null) {
            const Loaded = loaded;
            return <Loaded {...props} />;
        }

        if (failed) {
            return (
                <ScreenLoadFailed
                    testID={`${testID}-failed`}
                    onRetry={() => {
                        setFailed(false);
                        setAttempt((previous) => previous + 1);
                    }}
                />
            );
        }

        return <ScreenLoading testID={testID} />;
    };
}
