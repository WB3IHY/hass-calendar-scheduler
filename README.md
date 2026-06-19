# hass-calendar-scheduler

A custom Home Assistant Lovelace card and automation for scheduling entity
actions (lights, switches, scenes, climate, media players, covers, and more)
using a Local Calendar. Click a time slot, pick the entities and parameters,
set a recurrence, and save — no YAML required for day-to-day scheduling.

## How it works

- **Backend**: one automation (`automation.yaml`) watches a Local Calendar
  entity (`calendar.calendar` by default). On event start it parses the
  event description as JSON and fires the listed service calls. On event
  end it calls each entity's reverse action — the opposite `turn_on`/
  `turn_off` for simple toggle domains, or a fixed off-equivalent for
  `cover`/`climate`/`media_player` (e.g. `cover.close_cover`) — unless that
  entity is marked as a one-shot trigger (`"revert": false`) or its domain
  has no off-state at all (like `scene`).
- **Frontend**: a single-file vanilla JS Lovelace card
  (`hass-calendar-scheduler.js`, no build step) that renders a day/week
  timeline, lets you search and add entities from a dialog with
  domain-aware controls, and writes events straight to the calendar over
  Home Assistant's WebSocket API.

## Event description format

The card writes (and the automation reads) calendar event descriptions as
JSON:

```json
{
  "entities": [
    { "entity_id": "light.kitchen", "service": "light.turn_on", "params": { "brightness_pct": 80 }, "revert": true },
    { "entity_id": "switch.fan", "service": "switch.turn_off", "params": {}, "revert": false },
    { "entity_id": "climate.living_room", "service": "climate.set_temperature", "params": { "temperature": 21, "hvac_mode": "heat" }, "revert": true }
  ]
}
```

`revert` is optional and defaults to `true` when omitted (for backward
compatibility with events created before this field existed). When `true`,
the automation fires the opposite action at event end (or the fixed
off-equivalent for `cover`/`climate`/`media_player`). When `false`, it's a
one-shot trigger: the entity is set once at event start and stays that way
indefinitely, with no action at event end — e.g. `switch.fan` above turns
off when the event starts and is left off, regardless of when the event
ends.

You generally won't need to write this by hand — the dialog builds it for
you — but it's plain JSON if you ever want to script around it.

## Installation

The automation always has to be added by hand — HACS only manages frontend
resources, not automations — but the card itself can be installed either
through HACS or manually.

### 1. Add the automation (required either way)

In Home Assistant, go to *Settings → Automations → Create Automation →
Edit in YAML*, and paste the contents of `automation.yaml`. Save it. If
your Local Calendar entity isn't `calendar.calendar`, edit the `entity_id`
in the automation's triggers.

### 2. Install the card

**Option A: HACS (recommended)**

1. In HA, go to *HACS → ⋮ (top right) → Custom repositories*, and add:
   `https://github.com/WB3IHY/hass-calendar-scheduler`, category
   *Dashboard*.
2. Back in HACS's Frontend section, search for *Calendar Scheduler* and
   click *Download*.
3. HACS usually registers the Lovelace resource for you automatically. If
   the card doesn't show up when adding it to a dashboard, add the
   resource manually as described in step 3 of Option B below.
4. Reload your browser (or clear cache) so the new resource loads.

**Option B: manual deploy**

1. Copy `hass-calendar-scheduler.js` into your HA config's `www` folder,
   either manually or with `deploy.sh` (see below). It will be served at
   `/local/hass-calendar-scheduler.js`.
2. Register the resource: go to *Settings → Dashboards → ⋮ → Resources →
   Add Resource*, set URL to `/local/hass-calendar-scheduler.js`, type
   *JavaScript Module*.

### 3. Add the card to a dashboard

Edit a dashboard, add a card, choose *Manual*, and use:
```yaml
type: custom:hass-calendar-scheduler
entity: calendar.calendar
```
(`entity` is optional and defaults to `calendar.calendar`.)

## Deploying the card file manually

`deploy.sh` copies `hass-calendar-scheduler.js` to a Home Assistant
Operating System (HAOS) install over SCP, since HAOS runs SSH on port
`22222` instead of the standard port 22:

```bash
./deploy.sh
```

By default it targets `homeassistant.local`. If mDNS (`.local` hostname
resolution) doesn't work on your network, set `HA_HOST` to your Home
Assistant instance's IP address instead:

```bash
HA_HOST=192.0.2.10 ./deploy.sh
```

You'll need SSH access enabled on your HAOS instance (the *Advanced SSH &
Web Terminal* or *Terminal & SSH* add-on) with your public key authorized
for the `root` user.

## Using the card

- Switch between **Day** and **Week** views, navigate with the arrows or
  jump to **Today**.
- Click an empty time slot to create a new event; click an existing event
  block to edit it. When editing an occurrence of a recurring event, the
  Delete button offers a choice of scope: this event, this and all
  following occurrences, or the entire series.
- In the dialog, give the event a name, set start/end times, optionally set
  a recurrence (daily, weekly, weekdays, weekends, or custom days), and
  search for entities to add. Each entity gets domain-aware controls:
  - **light**: On/Off toggle (brightness and color temperature sliders
    appear when On is selected)
  - **switch / input_boolean / everything else**: On/Off toggle
  - **scene**: triggered on event start only (no off-state, no on/off
    toggle)
  - **climate**: target temperature, HVAC mode
  - **media_player**: volume and/or source (toggle which one(s) apply)
  - **cover**: position
  - every domain except scene also gets a **"Revert when event ends"**
    checkbox (checked by default). Uncheck it to make that entity a
    one-shot trigger — e.g. "turn this light off and leave it off" rather
    than "turn it off for the duration of the event."
- Events whose entities overlap with another event's entities in the same
  time range are highlighted in a warning color.

## Timing precision

The automation checks for starting/ending events once a minute (using
`calendar.get_events` rather than HA's built-in `calendar` trigger, which
only rescans its schedule every 15 minutes and can silently miss events
created shortly before they start). This means actions fire within about
a minute of the scheduled time, not instantaneously.

## Known limitations (current version)

- All-day calendar events are not shown or creatable from the card — it's
  designed around timed scheduling, not all-day reminders.
- Editing a recurring event always applies **only to that occurrence**
  (saving never changes the series' recurrence rule). Deleting offers a
  choice — this event, this and all following, or the entire series — so
  to change a series' settings, delete the whole series and recreate it.
- Requires a reasonably current Home Assistant (2024.10+) for the
  `trigger:`/`action:` automation syntax and `color_temp_kelvin` service
  field used here.

## License

MIT — see [LICENSE](LICENSE).
