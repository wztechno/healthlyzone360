# Healthy360 development PHP-FPM image.
# The application code is bind-mounted at /var/www/html by compose.yaml;
# this image only provides the runtime (PHP 8.4 + required extensions).
FROM php:8.4-fpm-alpine

COPY --from=mlocati/php-extension-installer:2 /usr/bin/install-php-extensions /usr/local/bin/

RUN apk add --no-cache bash git unzip postgresql-client \
    && install-php-extensions pdo_pgsql pgsql intl bcmath zip opcache pcntl redis

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY php.ini /usr/local/etc/php/conf.d/healthy360.ini

WORKDIR /var/www/html
