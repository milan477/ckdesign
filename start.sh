#!/bin/sh
set -e

# Substitute $PORT in the nginx template and write the active config
envsubst '${PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# Remove the default nginx site if it exists
rm -f /etc/nginx/sites-enabled/default

exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/supervisord.conf
