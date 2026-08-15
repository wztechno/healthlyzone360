<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | The private Healthy360 kitchen workbook importer
    |--------------------------------------------------------------------------
    |
    | `kitchen:import-workbook` reads a folder of confidential workbook exports
    | — formulations, unit costs, supplier prices — and writes them into one
    | organisation. None of that data is in this repository and none of it ever
    | will be (master plan v2 §4.11, mechanism (c)); the command is the only way
    | it enters the system.
    |
    | `environments` is the allowlist. It is a list rather than a boolean because
    | "not production" is not the same statement as "somewhere a human is sitting
    | at a terminal with the source files on the same disk", and the second is
    | what this command actually assumes. Widening it is a deliberate act with a
    | reviewer, which is exactly why it lives in config and not in an `if`.
    |
    | `source_system` is the provenance stamp every imported row carries. It is
    | how a re-run recognises its own work, how an operator tells imported rows
    | from hand-created ones, and how a future migration could withdraw the whole
    | import if the source turned out to be wrong. Changing it would orphan every
    | row the last run wrote.
    |
    */

    'import' => [

        'environments' => array_values(array_filter(array_map(
            trim(...),
            explode(',', (string) env('KITCHEN_WORKBOOK_IMPORT_ENVIRONMENTS', 'local,testing')),
        ))),

        'source_system' => 'healthy360_workbook',

        'organisation_slug' => 'healthy360-kitchen',

        /*
         | Where a run writes its JSON report, relative to the `local` disk
         | (storage/app). The directory is covered by storage/app/.gitignore's
         | catch-all, which is the point: a report names every unresolved
         | designation and every cost-basis contradiction in the source, and
         | that is confidential in exactly the way the source files are.
         */
        'report_path' => 'import-reports',
    ],

];
