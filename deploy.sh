#!/bin/bash
set -e
HA_HOST=${HA_HOST:-homeassistant.local}
scp -P 22222 hass-calendar-scheduler.js root@${HA_HOST}:/config/www/
