/**
 * A short tone from the browser's `AudioContext`. One context for the page: a browser limits how
 * many it will open.
 *
 * Quiet everywhere it cannot sound. Native has no `AudioContext`, and a browser holds audio until
 * the reader's first press on the page, so a tone asked for before then waits on `resume()` and may
 * sound at that press. A refused or failed start is swallowed: the tone is a courtesy on top of the
 * toast and the count, and must never break the poll that asked for it.
 */

const FREQUENCY_HZ = 880;
const LENGTH_SECONDS = 0.25;
const PEAK_GAIN = 0.2;
/** Where the fade ends. Silence itself is out of reach: an exponential ramp cannot arrive at zero. */
const END_GAIN = 0.001;

let audio: AudioContext | null = null;

export function playAlertTone(): void {
    if (typeof AudioContext === 'undefined') return;

    try {
        audio ??= new AudioContext();
        const context = audio;

        context
            .resume()
            .then(() => {
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                const end = context.currentTime + LENGTH_SECONDS;

                oscillator.frequency.value = FREQUENCY_HZ;
                gain.gain.setValueAtTime(PEAK_GAIN, context.currentTime);
                gain.gain.exponentialRampToValueAtTime(END_GAIN, end);
                oscillator.connect(gain).connect(context.destination);
                oscillator.start();
                oscillator.stop(end);
            })
            .catch(() => undefined);
    } catch {
        // The context could not be made: no tone, and nothing else changes.
    }
}
