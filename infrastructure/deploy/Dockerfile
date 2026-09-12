# Healthy360 API image for deployed environments.
#
# Unlike infrastructure/docker/php/Dockerfile — which is a bare runtime for a
# bind-mounted working copy — this image carries the application: the source is
# copied in and Composer runs at build time, so a container is a fixed,
# reproducible version of the code rather than a view onto somebody's disk.
#
# The build context is the directory package.sh assembles, whose api/ holds a
# `git archive` of the committed tree. Nothing uncommitted can reach an image.
FROM php:8.4-fpm-alpine

COPY --from=mlocati/php-extension-installer:2 /usr/bin/install-php-extensions /usr/local/bin/

RUN apk add --no-cache bash git unzip postgresql-client \
    && install-php-extensions pdo_pgsql pgsql intl bcmath zip opcache pcntl redis

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY php.ini /usr/local/etc/php/conf.d/healthy360.ini

WORKDIR /var/www/html

COPY api/ /var/www/html/

# `--no-dev`, restored now that nothing here seeds a demonstration world.
#
# It was off for one reason: the demo seeders drove model factories, factories
# call fake(), and fakerphp/faker is a require-dev package — so `--no-dev` got
# as far as B2bProgrammesDemoSeeder and died on an undefined function. A deploy
# no longer seeds at all, and the seeders `healthzone-rebuild.sh` does run
# reach no factory: the reference layer, the platform operator, the v6
# importers and HealthZoneKitchenSeeder contain no fake(), no Faker and no
# ::factory() between them.
#
# If a seeder ever needs a factory again this line has to come back out, and
# the honest fix is to give that seeder real data rather than to reship the dev
# dependencies.
#
# --no-scripts: post-autoload-dump runs `artisan package:discover`, which boots
# the framework — at build time there is no .env, no database and no Redis to
# boot against. Laravel's PackageManifest rebuilds bootstrap/cache/packages.php
# by itself on the first request that finds it missing, so discovery simply
# happens at runtime instead, against real configuration.
#
# The app-modules are Composer *path* repositories with symlink:true, so vendor
# and app-modules must stay in one filesystem layer — hence a single stage
# rather than a separate vendor stage whose symlinks would dangle.
RUN composer install --no-interaction --prefer-dist --optimize-autoloader --no-scripts --no-dev \
    && mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && chown -R www-data:www-data storage bootstrap/cache

# php-fpm's master process stays root so it can bind and hand work to the
# www-data pool workers the official image configures; dropping USER here
# would leave the master unable to set up the pool.
