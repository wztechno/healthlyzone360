import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';

import '../global.css';
import { useBrandFonts } from '../src/brand-fonts.ts';
import { AppProviders } from '../src/providers.tsx';

/**
 * Root layout: providers, then one flat `Stack`.
 *
 * Mode and authentication gating are deliberately **not** done here. Expo Router mounts a layout
 * before it knows which child route will render, so a gate at the root would have to guess; each
 * area's own layout instead wraps itself in `<Gate area="…">`, which evaluates the real requirement
 * for the real destination. The root's only job is to make the providers available.
 *
 * Fonts load in the background rather than gating first paint — `useBrandFonts` says why, and
 * where the typefaces are chosen.
 */
export default function RootLayout() {
    useBrandFonts();

    return (
        <AppProviders>
            {/* Default document title for the web; screens may override with their own <Head>.
                An empty <title> is a serious axe violation (document-title). */}
            <Head>
                <title>Healthy360</title>
            </Head>
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: false }} />
        </AppProviders>
    );
}
