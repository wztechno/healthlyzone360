/*
 * Fonts are imported by *weight subpath*, not from the package root. The root barrel re-exports
 * every weight and italic, and Metro then copies all thirty-odd .ttf files into the web export —
 * several megabytes of fonts the application never renders.
 */
import { IBMPlexSansArabic_400Regular } from '@expo-google-fonts/ibm-plex-sans-arabic/400Regular';
import { IBMPlexSansArabic_500Medium } from '@expo-google-fonts/ibm-plex-sans-arabic/500Medium';
import { IBMPlexSansArabic_600SemiBold } from '@expo-google-fonts/ibm-plex-sans-arabic/600SemiBold';
import { IBMPlexSansArabic_700Bold } from '@expo-google-fonts/ibm-plex-sans-arabic/700Bold';
import { SchibstedGrotesk_400Regular } from '@expo-google-fonts/schibsted-grotesk/400Regular';
import { SchibstedGrotesk_500Medium } from '@expo-google-fonts/schibsted-grotesk/500Medium';
import { SchibstedGrotesk_600SemiBold } from '@expo-google-fonts/schibsted-grotesk/600SemiBold';
import { SchibstedGrotesk_700Bold } from '@expo-google-fonts/schibsted-grotesk/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';

import '../global.css';
import { AppProviders } from '../src/providers.tsx';

/**
 * Root layout: providers, then one flat `Stack`.
 *
 * Mode and authentication gating are deliberately **not** done here. Expo Router mounts a layout
 * before it knows which child route will render, so a gate at the root would have to guess; each
 * area's own layout instead wraps itself in `<Gate area="…">`, which evaluates the real requirement
 * for the real destination. The root's only job is to make the providers available.
 *
 * Fonts load in the background rather than gating first paint: a blank screen while a webfont
 * downloads is worse than one frame of the system face, and the per-script line heights come from
 * tokens, so the layout does not jump when the real family arrives.
 */
export default function RootLayout() {
    useFonts({
        // Two families, one per script — that is the whole payload.
        //
        // It was four Latin faces: Inter for body, Space Grotesk for headings, IBM Plex Mono for
        // figures and Schibsted Grotesk on the admin. Four webfonts is what "the fonts do not
        // match" looks like to a reader, and three of them were downloaded to say nothing the
        // ramp's sizes and weights were not already saying. Figures line up on `tabular-nums`
        // inside this family rather than on a monospaced one.
        SchibstedGrotesk_400Regular,
        SchibstedGrotesk_500Medium,
        SchibstedGrotesk_600SemiBold,
        SchibstedGrotesk_700Bold,
        // Arabic keeps its own family: Schibsted Grotesk carries no Arabic glyphs.
        IBMPlexSansArabic_400Regular,
        IBMPlexSansArabic_500Medium,
        IBMPlexSansArabic_600SemiBold,
        IBMPlexSansArabic_700Bold,
    });

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
