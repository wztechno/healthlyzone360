/**
 * Bundled image assets.
 *
 * Metro turns a static `import`/`require` of an image into an asset reference (a `number` at the
 * type level via React Native's `ImageRequireSource`). Expo's own types only declare stylesheet
 * modules, so the WebP families under `assets/images/` are declared here — this is what lets the
 * generated image manifest import them with full type-safety.
 */
declare module '*.webp' {
    import type { ImageRequireSource } from 'react-native';

    const source: ImageRequireSource;
    export default source;
}
