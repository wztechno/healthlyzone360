<?php

declare(strict_types=1);

namespace Healthy360\Support\Logging;

use Illuminate\Log\Logger;
use Monolog\Logger as Monolog;

/**
 * Attaches RedactSensitiveContext to a log channel.
 *
 * A tap rather than the `processors` configuration key: Laravel only honours
 * `processors` on channels using the `monolog` driver, whereas a tap is applied
 * to every channel the log manager builds. The `stack` driver collects the
 * processors of the channels it aggregates, so tapping the leaf channels covers
 * the stack too.
 */
final class RedactSensitiveLogs
{
    public function __invoke(Logger $logger): void
    {
        $monolog = $logger->getLogger();

        if ($monolog instanceof Monolog) {
            $monolog->pushProcessor(new RedactSensitiveContext);
        }
    }
}
