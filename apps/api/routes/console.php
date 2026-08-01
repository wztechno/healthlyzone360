<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Schedule;

/*
|--------------------------------------------------------------------------
| Scheduled tasks
|--------------------------------------------------------------------------
|
| Jobs and schedules are owned by the phase that introduces them (master plan
| v2 §7), so this file stays empty of domain work until a domain exists.
|
| The one exception is operational hygiene: Horizon records its queue-wait and
| throughput metrics only when `horizon:snapshot` runs, so without this entry
| the dashboard's metrics pages are permanently blank and a growing wait time
| is invisible. Five minutes is Horizon's documented interval.
|
*/

Schedule::command('horizon:snapshot')->everyFiveMinutes();
