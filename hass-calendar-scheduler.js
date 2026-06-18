(() => {
  "use strict";

  const HOUR_PX = 48;
  const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const RECURRENCE_PRESETS = {
    none: null,
    daily: "FREQ=DAILY",
    weekly: "FREQ=WEEKLY",
    weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    weekends: "FREQ=WEEKLY;BYDAY=SA,SU",
  };
  const DOMAIN_KIND = {
    light: "light",
    switch: "toggle",
    input_boolean: "toggle",
    scene: "trigger",
    climate: "climate",
    media_player: "media_player",
    cover: "cover",
  };

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function startOfWeek(date) {
    const d = startOfDay(date);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function toLocalInputValue(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function fromLocalInputValue(value) {
    return new Date(value);
  }

  function formatHourLabel(hour) {
    const h = hour % 24;
    const period = h < 12 ? "AM" : "PM";
    let displayHour = h % 12;
    if (displayHour === 0) displayHour = 12;
    return `${displayHour} ${period}`;
  }

  function formatDayHeader(date) {
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
  }

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildRRule(recurrence, customDays) {
    if (recurrence === "custom") {
      if (!customDays || !customDays.length) return null;
      return `FREQ=WEEKLY;BYDAY=${customDays.join(",")}`;
    }
    return RECURRENCE_PRESETS[recurrence] || null;
  }

  function domainOf(entityId) {
    return entityId.split(".")[0];
  }

  function kindForDomain(domain) {
    return DOMAIN_KIND[domain] || "toggle";
  }

  function friendlyName(hass, entityId, registryName) {
    if (registryName) return registryName;
    const state = hass.states[entityId];
    if (state && state.attributes && state.attributes.friendly_name) {
      return state.attributes.friendly_name;
    }
    return entityId;
  }

  function parseSchedulerPayload(description) {
    if (!description) return null;
    try {
      const data = JSON.parse(description);
      if (data && Array.isArray(data.entities)) return data;
    } catch (err) {
      // not a scheduler event - plain calendar entry
    }
    return null;
  }

  function computeOverlaps(events) {
    const overlapping = new Set();
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const a = events[i];
        const b = events[j];
        if (a.start < b.end && b.start < a.end) {
          const shared = a.entityIds.some((id) => b.entityIds.includes(id));
          if (shared) {
            overlapping.add(a.uid + "|" + (a.recurrenceId || ""));
            overlapping.add(b.uid + "|" + (b.recurrenceId || ""));
          }
        }
      }
    }
    return overlapping;
  }

  function eventStartDate(event) {
    return new Date(event.start.dateTime || `${event.start.date}T00:00:00`);
  }

  function eventEndDate(event) {
    return new Date(event.end.dateTime || `${event.end.date}T00:00:00`);
  }

  async function fetchEntitiesForDisplay(hass) {
    const result = await hass.callWS({ type: "config/entity_registry/list_for_display" });
    return result.entities.map((e) => ({
      entityId: e.ei,
      name: e.en || null,
      hidden: !!e.hb,
    }));
  }

  function fetchCalendarEvents(hass, entityId, start, end) {
    const params = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
    });
    return hass.callApi("GET", `calendars/${entityId}?${params.toString()}`);
  }

  function createCalendarEvent(hass, entityId, payload) {
    return hass.callWS({
      type: "calendar/event/create",
      entity_id: entityId,
      event: payload,
    });
  }

  function updateCalendarEvent(hass, entityId, uid, payload, recurrenceId, recurrenceRange) {
    const msg = {
      type: "calendar/event/update",
      entity_id: entityId,
      uid,
      event: payload,
    };
    if (recurrenceId) {
      msg.recurrence_id = recurrenceId;
      msg.recurrence_range = recurrenceRange || "";
    }
    return hass.callWS(msg);
  }

  function deleteCalendarEvent(hass, entityId, uid, recurrenceId, recurrenceRange) {
    const msg = {
      type: "calendar/event/delete",
      entity_id: entityId,
      uid,
    };
    if (recurrenceId) {
      msg.recurrence_id = recurrenceId;
      msg.recurrence_range = recurrenceRange || "";
    }
    return hass.callWS(msg);
  }

  const CARD_CSS = `
    :host { display: block; }
    ha-card { overflow: hidden; display: flex; flex-direction: column; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--divider-color); flex-wrap: wrap; gap: 8px; }
    .nav { display: flex; align-items: center; gap: 8px; }
    .nav-btn, .today-btn, .view-btn { background: none; border: 1px solid var(--divider-color); border-radius: 4px; color: var(--primary-text-color); cursor: pointer; padding: 4px 10px; font-size: 14px; }
    .nav-btn:hover, .today-btn:hover, .view-btn:hover { background: var(--secondary-background-color); }
    .view-toggle { display: flex; gap: 4px; }
    .view-btn.active { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
    .range-label { font-weight: 500; margin-left: 8px; }
    .grid { display: flex; flex-direction: column; height: 600px; }
    .grid-header { display: flex; border-bottom: 1px solid var(--divider-color); }
    .gutter-spacer { width: 56px; flex-shrink: 0; }
    .day-headers { flex: 1; display: flex; }
    .day-header { flex: 1; text-align: center; padding: 8px 4px; font-size: 13px; font-weight: 500; border-left: 1px solid var(--divider-color); }
    .grid-scroll-body { flex: 1; overflow-y: auto; display: flex; }
    .time-gutter { width: 56px; flex-shrink: 0; position: relative; }
    .hour-label { position: absolute; right: 6px; transform: translateY(-50%); font-size: 11px; color: var(--secondary-text-color); }
    .day-body { flex: 1; display: flex; position: relative; }
    .day-col { flex: 1; position: relative; border-left: 1px solid var(--divider-color); cursor: pointer; }
    .day-col.today { background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.05); }
    .hour-line { position: absolute; left: 0; right: 0; border-top: 1px solid var(--divider-color); opacity: 0.5; }
    .event-block { position: absolute; background: var(--primary-color); color: var(--text-primary-color, #fff); border-radius: 4px; padding: 2px 4px; font-size: 12px; overflow: hidden; box-sizing: border-box; cursor: pointer; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3); }
    .event-block.plain { background: var(--secondary-background-color); color: var(--primary-text-color); opacity: 0.7; }
    .event-block.overlap { background: var(--warning-color, #ff9800); border: 2px solid var(--error-color, #db4437); }
    .event-title { display: block; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
    ha-dialog { --mdc-dialog-min-width: 420px; --mdc-dialog-max-width: 520px; }
    .dialog-body { display: flex; flex-direction: column; gap: 12px; min-width: 320px; }
    .field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--secondary-text-color); }
    .field input, .field select { font-size: 14px; padding: 6px 8px; border: 1px solid var(--divider-color); border-radius: 4px; background: var(--card-background-color); color: var(--primary-text-color); }
    .field-row { display: flex; gap: 12px; }
    .field-row .field { flex: 1; }
    .custom-days { display: flex; gap: 6px; flex-wrap: wrap; }
    .day-chip { display: flex; align-items: center; gap: 4px; border: 1px solid var(--divider-color); border-radius: 12px; padding: 4px 8px; font-size: 12px; cursor: pointer; }
    .search-results { max-height: 160px; overflow-y: auto; border: 1px solid var(--divider-color); border-radius: 4px; margin-top: 4px; }
    .result-group-label { font-size: 11px; text-transform: uppercase; color: var(--secondary-text-color); padding: 4px 8px; background: var(--secondary-background-color); }
    .result-item { padding: 6px 8px; cursor: pointer; display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
    .result-item:hover { background: var(--secondary-background-color); }
    .result-entity-id { color: var(--secondary-text-color); font-size: 11px; }
    .no-results { padding: 8px; font-size: 13px; color: var(--secondary-text-color); }
    .selected-entities { display: flex; flex-direction: column; gap: 8px; }
    .entity-row { border: 1px solid var(--divider-color); border-radius: 6px; padding: 8px; }
    .entity-row-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .entity-row-name { font-weight: 500; flex: 1; }
    .entity-row-domain { font-size: 11px; color: var(--secondary-text-color); text-transform: uppercase; }
    .remove-btn { background: none; border: none; color: var(--secondary-text-color); cursor: pointer; font-size: 14px; }
    .entity-row-controls { display: flex; flex-direction: column; gap: 6px; }
    .control { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
    .checkbox-control { flex-direction: row; align-items: center; gap: 6px; }
    .hint { font-size: 12px; color: var(--secondary-text-color); margin: 0; }
    mwc-button.danger { --mdc-theme-primary: var(--error-color, #db4437); }
  `;

  class HassCalendarScheduler extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._config = {};
      this._entityId = "calendar.calendar";
      this._view = "week";
      this._anchor = startOfWeek(new Date());
      this._events = [];
      this._entityList = null;
      this._entityListPromise = null;
      this._built = false;
      this._loading = false;
      this._dialogEl = null;
      this._dialogData = null;
      this.attachShadow({ mode: "open" });
    }

    setConfig(config) {
      this._config = config || {};
      this._entityId = this._config.entity || "calendar.calendar";
    }

    static getStubConfig() {
      return { entity: "calendar.calendar" };
    }

    getCardSize() {
      return 8;
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (!this._built) {
        this._buildSkeleton();
        this._built = true;
      }
      if (first) {
        this._loadEvents();
      }
    }

    get hass() {
      return this._hass;
    }

    connectedCallback() {
      if (this._hass && !this._built) {
        this._buildSkeleton();
        this._built = true;
        this._loadEvents();
      }
    }

    _buildSkeleton() {
      this.shadowRoot.innerHTML = `
        <style>${CARD_CSS}</style>
        <ha-card>
          <div class="toolbar">
            <div class="nav">
              <button class="nav-btn" id="prev" aria-label="Previous">&#8249;</button>
              <button class="today-btn" id="today">Today</button>
              <button class="nav-btn" id="next" aria-label="Next">&#8250;</button>
              <span class="range-label" id="range-label"></span>
            </div>
            <div class="view-toggle">
              <button class="view-btn" id="view-day" data-view="day">Day</button>
              <button class="view-btn" id="view-week" data-view="week">Week</button>
            </div>
          </div>
          <div class="grid" id="grid"></div>
        </ha-card>
      `;
      this._gridEl = this.shadowRoot.getElementById("grid");
      this._rangeLabelEl = this.shadowRoot.getElementById("range-label");
      this.shadowRoot.getElementById("prev").addEventListener("click", () => this._navigate(-1));
      this.shadowRoot.getElementById("next").addEventListener("click", () => this._navigate(1));
      this.shadowRoot.getElementById("today").addEventListener("click", () => this._goToday());
      this.shadowRoot.getElementById("view-day").addEventListener("click", () => this._setView("day"));
      this.shadowRoot.getElementById("view-week").addEventListener("click", () => this._setView("week"));
    }

    _navigate(delta) {
      const step = this._view === "day" ? 1 : 7;
      this._anchor = addDays(this._anchor, delta * step);
      this._loadEvents();
    }

    _goToday() {
      this._anchor = this._view === "day" ? startOfDay(new Date()) : startOfWeek(new Date());
      this._loadEvents();
    }

    _setView(view) {
      if (this._view === view) return;
      this._anchor = view === "day" ? startOfDay(this._anchor) : startOfWeek(this._anchor);
      this._view = view;
      this._loadEvents();
    }

    _visibleRange() {
      const start = this._view === "day" ? startOfDay(this._anchor) : startOfWeek(this._anchor);
      const days = this._view === "day" ? 1 : 7;
      const end = addDays(start, days);
      return { start, end, days };
    }

    async _loadEvents() {
      if (!this._hass) return;
      const { start, end } = this._visibleRange();
      this._loading = true;
      this._renderHeader();
      try {
        const raw = await fetchCalendarEvents(this._hass, this._entityId, start, end);
        this._events = raw.map((e) => this._normalizeEvent(e));
      } catch (err) {
        console.error("hass-calendar-scheduler: failed to load events", err);
        this._events = [];
      }
      this._loading = false;
      this._renderHeader();
      this._renderGrid();
    }

    _normalizeEvent(raw) {
      const start = eventStartDate(raw);
      const end = eventEndDate(raw);
      const payload = parseSchedulerPayload(raw.description);
      const entityIds = payload ? payload.entities.map((e) => e.entity_id) : [];
      return {
        uid: raw.uid,
        recurrenceId: raw.recurrence_id || null,
        summary: raw.summary || "(untitled)",
        description: raw.description || "",
        start,
        end,
        allDay: !raw.start.dateTime,
        payload,
        entityIds,
      };
    }

    _renderHeader() {
      const { start, end } = this._visibleRange();
      const label = this._view === "day"
        ? formatDayHeader(start)
        : `${formatDayHeader(start)} – ${formatDayHeader(addDays(end, -1))}`;
      this._rangeLabelEl.textContent = this._loading ? `${label} (loading…)` : label;
      this.shadowRoot.getElementById("view-day").classList.toggle("active", this._view === "day");
      this.shadowRoot.getElementById("view-week").classList.toggle("active", this._view === "week");
    }

    _layoutDayEvents(events) {
      const sorted = [...events].sort((a, b) => a.start - b.start);
      const columns = [];
      const placements = [];
      sorted.forEach((event) => {
        let placedColumn = columns.findIndex((col) => col.end <= event.start);
        if (placedColumn === -1) {
          columns.push({ end: event.end });
          placedColumn = columns.length - 1;
        } else {
          columns[placedColumn].end = event.end;
        }
        placements.push({ event, column: placedColumn });
      });
      const columnCount = Math.max(1, columns.length);
      return placements.map((p) => ({ ...p, columnCount }));
    }

    _renderEventBlock(event, day, dayEnd, overlapKeys, column, columnCount) {
      const clampedStart = event.start < day ? day : event.start;
      const clampedEnd = event.end > dayEnd ? dayEnd : event.end;
      const top = minutesSinceMidnight(clampedStart) * (HOUR_PX / 60);
      let height = ((clampedEnd - clampedStart) / 60000) * (HOUR_PX / 60);
      height = Math.max(height, 18);
      const widthPct = 100 / columnCount;
      const leftPct = widthPct * column;
      const key = event.uid + "|" + (event.recurrenceId || "");
      const isOverlap = overlapKeys.has(key);
      const isScheduler = !!event.payload;
      const classes = ["event-block"];
      if (isOverlap) classes.push("overlap");
      if (!isScheduler) classes.push("plain");
      return `
        <div class="${classes.join(" ")}"
             style="top:${top}px;height:${height}px;left:${leftPct}%;width:calc(${widthPct}% - 4px)"
             data-uid="${event.uid}"
             data-recurrence-id="${event.recurrenceId || ""}"
             title="${escapeHtml(event.summary)}">
          <span class="event-title">${escapeHtml(event.summary)}</span>
        </div>
      `;
    }

    _renderGrid() {
      const { start, days } = this._visibleRange();
      const overlapKeys = computeOverlaps(this._events);
      const dayList = [];
      for (let i = 0; i < days; i++) dayList.push(addDays(start, i));
      const totalHeight = 24 * HOUR_PX;

      const hourLabels = [];
      const hourLines = [];
      for (let h = 0; h < 24; h++) {
        hourLabels.push(`<div class="hour-label" style="top:${h * HOUR_PX}px">${formatHourLabel(h)}</div>`);
        hourLines.push(`<div class="hour-line" style="top:${h * HOUR_PX}px"></div>`);
      }

      const dayColumnsHtml = dayList.map((day, idx) => {
        const dayEnd = addDays(day, 1);
        const dayEvents = this._events.filter((ev) => !ev.allDay && ev.start < dayEnd && ev.end > day);
        const blocksHtml = this._layoutDayEvents(dayEvents)
          .map(({ event, column, columnCount }) =>
            this._renderEventBlock(event, day, dayEnd, overlapKeys, column, columnCount))
          .join("");
        const isToday = startOfDay(new Date()).getTime() === day.getTime();
        return `<div class="day-col${isToday ? " today" : ""}" data-day-index="${idx}" style="height:${totalHeight}px">${hourLines.join("")}${blocksHtml}</div>`;
      }).join("");

      this._gridEl.innerHTML = `
        <div class="grid-header">
          <div class="gutter-spacer"></div>
          <div class="day-headers">
            ${dayList.map((d) => `<div class="day-header">${formatDayHeader(d)}</div>`).join("")}
          </div>
        </div>
        <div class="grid-scroll-body">
          <div class="time-gutter" style="height:${totalHeight}px">${hourLabels.join("")}</div>
          <div class="day-body">${dayColumnsHtml}</div>
        </div>
      `;

      this._attachGridListeners(dayList);
    }

    _attachGridListeners(dayList) {
      const dayCols = this._gridEl.querySelectorAll(".day-col");
      dayCols.forEach((col, idx) => {
        col.addEventListener("click", (e) => {
          if (e.target.closest(".event-block")) return;
          const rect = col.getBoundingClientRect();
          const offsetY = e.clientY - rect.top;
          const minutes = clamp(Math.round(((offsetY / HOUR_PX) * 60) / 15) * 15, 0, 1425);
          const slotStart = new Date(dayList[idx]);
          slotStart.setMinutes(minutes);
          const slotEnd = new Date(slotStart.getTime() + 3600000);
          this._openDialog({ mode: "create", start: slotStart, end: slotEnd });
        });
      });

      this._gridEl.querySelectorAll(".event-block").forEach((block) => {
        block.addEventListener("click", (e) => {
          e.stopPropagation();
          const uid = block.getAttribute("data-uid");
          const recurrenceId = block.getAttribute("data-recurrence-id") || null;
          const event = this._events.find((ev) => ev.uid === uid && (ev.recurrenceId || null) === recurrenceId);
          if (event) this._openDialog({ mode: "edit", event });
        });
      });
    }

    async _ensureEntityList() {
      if (this._entityList) return this._entityList;
      if (!this._entityListPromise) {
        this._entityListPromise = fetchEntitiesForDisplay(this._hass).then((list) => {
          this._entityList = list.filter((e) => !e.hidden);
          return this._entityList;
        });
      }
      return this._entityListPromise;
    }

    _entityRegistryName(entityId) {
      if (!this._entityList) return null;
      const found = this._entityList.find((e) => e.entityId === entityId);
      return found ? found.name : null;
    }

    _expandPayloadToRows(payload) {
      const rows = [];
      const byEntity = new Map();
      payload.entities.forEach((item) => {
        const domain = domainOf(item.entity_id);
        const kind = kindForDomain(domain);
        let row = byEntity.get(item.entity_id);
        if (!row) {
          row = {
            entityId: item.entity_id,
            domain,
            kind,
            name: friendlyName(this._hass, item.entity_id, this._entityRegistryName(item.entity_id)),
            params: {},
            actions: { volume: false, source: false },
          };
          byEntity.set(item.entity_id, row);
          rows.push(row);
        }
        if (kind === "media_player") {
          if (item.service === "media_player.volume_set") {
            row.actions.volume = true;
            row.params.volume_level = item.params.volume_level;
          } else if (item.service === "media_player.select_source") {
            row.actions.source = true;
            row.params.source = item.params.source;
          }
        } else {
          Object.assign(row.params, item.params || {});
        }
      });
      return rows;
    }

    _defaultRowForEntity(entityId) {
      const domain = domainOf(entityId);
      const kind = kindForDomain(domain);
      const state = this._hass.states[entityId];
      const attrs = (state && state.attributes) || {};
      const row = {
        entityId,
        domain,
        kind,
        name: friendlyName(this._hass, entityId, this._entityRegistryName(entityId)),
        params: {},
        actions: { volume: true, source: false },
      };
      if (kind === "light") {
        row.params.brightness_pct = 100;
        if (attrs.min_color_temp_kelvin && attrs.max_color_temp_kelvin) {
          row.params.color_temp_kelvin = Math.round((attrs.min_color_temp_kelvin + attrs.max_color_temp_kelvin) / 2);
        }
      } else if (kind === "climate") {
        row.params.temperature = attrs.temperature || 21;
        row.params.hvac_mode = (attrs.hvac_modes && attrs.hvac_modes[0]) || "heat";
      } else if (kind === "media_player") {
        row.params.volume_level = 0.5;
        row.params.source = (attrs.source_list && attrs.source_list[0]) || "";
      } else if (kind === "cover") {
        row.params.position = 100;
      }
      return row;
    }

    _openDialog(opts) {
      const isEdit = opts.mode === "edit";
      const event = opts.event;
      const payload = isEdit ? event.payload : null;
      this._dialogData = {
        mode: opts.mode,
        uid: isEdit ? event.uid : null,
        recurrenceId: isEdit ? event.recurrenceId : null,
        name: isEdit ? event.summary : "",
        start: isEdit ? event.start : opts.start,
        end: isEdit ? event.end : opts.end,
        recurrence: "none",
        customDays: [],
        entities: isEdit && payload ? this._expandPayloadToRows(payload) : [],
      };
      this._buildDialogSkeleton();
    }

    _closeDialog() {
      if (this._dialogEl) {
        this._dialogEl.open = false;
      }
    }

    _buildDialogSkeleton() {
      if (this._dialogEl) {
        this._dialogEl.remove();
        this._dialogEl = null;
      }
      const data = this._dialogData;
      const isEdit = data.mode === "edit";
      const wrapper = document.createElement("div");
      wrapper.innerHTML = `
        <ha-dialog open heading="${isEdit ? "Edit Event" : "New Event"}">
          <div class="dialog-body">
            <label class="field">
              <span>Event name</span>
              <input type="text" id="f-name" placeholder="e.g. Evening lights">
            </label>
            <div class="field-row">
              <label class="field">
                <span>Start</span>
                <input type="datetime-local" id="f-start">
              </label>
              <label class="field">
                <span>End</span>
                <input type="datetime-local" id="f-end">
              </label>
            </div>
            ${isEdit
              ? (data.recurrenceId ? `<p class="hint">Part of a recurring series — this edit applies to this occurrence only.</p>` : "")
              : `
            <label class="field">
              <span>Repeats</span>
              <select id="f-recurrence">
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="weekdays">Weekdays (Mon–Fri)</option>
                <option value="weekends">Weekends (Sat–Sun)</option>
                <option value="custom">Custom…</option>
              </select>
            </label>
            <div class="custom-days" id="f-custom-days" hidden>
              ${DAY_LABELS.map((label, i) => `
                <label class="day-chip">
                  <input type="checkbox" value="${DAY_CODES[i]}">
                  <span>${label}</span>
                </label>
              `).join("")}
            </div>
            `}
            <hr>
            <div class="field">
              <span>Add entity</span>
              <input type="text" id="f-entity-search" placeholder="Search entities…" autocomplete="off">
              <div class="search-results" id="f-search-results"></div>
            </div>
            <div class="selected-entities" id="f-selected-entities"></div>
          </div>
          <mwc-button slot="secondaryAction" id="f-cancel">Cancel</mwc-button>
          ${isEdit ? `<mwc-button slot="secondaryAction" id="f-delete" class="danger">Delete</mwc-button>` : ""}
          <mwc-button slot="primaryAction" id="f-save">Save</mwc-button>
        </ha-dialog>
      `;
      const dialogEl = wrapper.firstElementChild;
      this.shadowRoot.appendChild(dialogEl);
      this._dialogEl = dialogEl;

      this._nameInput = dialogEl.querySelector("#f-name");
      this._startInput = dialogEl.querySelector("#f-start");
      this._endInput = dialogEl.querySelector("#f-end");
      this._recurrenceSelect = dialogEl.querySelector("#f-recurrence");
      this._customDaysEl = dialogEl.querySelector("#f-custom-days");
      this._searchInput = dialogEl.querySelector("#f-entity-search");
      this._searchResultsEl = dialogEl.querySelector("#f-search-results");
      this._selectedEntitiesEl = dialogEl.querySelector("#f-selected-entities");

      this._nameInput.value = data.name;
      this._startInput.value = toLocalInputValue(data.start);
      this._endInput.value = toLocalInputValue(data.end);

      this._nameInput.addEventListener("input", () => { data.name = this._nameInput.value; });
      this._startInput.addEventListener("change", () => { data.start = fromLocalInputValue(this._startInput.value); });
      this._endInput.addEventListener("change", () => { data.end = fromLocalInputValue(this._endInput.value); });

      if (this._recurrenceSelect) {
        this._recurrenceSelect.value = data.recurrence;
        this._recurrenceSelect.addEventListener("change", () => {
          data.recurrence = this._recurrenceSelect.value;
          this._customDaysEl.hidden = data.recurrence !== "custom";
        });
        this._customDaysEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
          cb.addEventListener("change", () => {
            data.customDays = Array.from(this._customDaysEl.querySelectorAll("input:checked")).map((c) => c.value);
          });
        });
      }

      this._searchInput.addEventListener("input", () => this._handleEntitySearch());
      dialogEl.querySelector("#f-cancel").addEventListener("click", () => this._closeDialog());
      dialogEl.querySelector("#f-save").addEventListener("click", () => this._saveDialog());
      const deleteBtn = dialogEl.querySelector("#f-delete");
      if (deleteBtn) deleteBtn.addEventListener("click", () => this._deleteDialogEvent());

      dialogEl.addEventListener("closed", () => {
        if (this._dialogEl === dialogEl) {
          dialogEl.remove();
          this._dialogEl = null;
        }
      });

      this._renderSelectedEntities();
      this._ensureEntityList();
    }

    async _handleEntitySearch() {
      const query = this._searchInput.value.trim().toLowerCase();
      if (!query) {
        this._searchResultsEl.innerHTML = "";
        return;
      }
      const list = await this._ensureEntityList();
      const matches = list
        .filter((e) => {
          const name = friendlyName(this._hass, e.entityId, e.name).toLowerCase();
          return name.includes(query) || e.entityId.toLowerCase().includes(query);
        })
        .slice(0, 40);

      const byDomain = new Map();
      matches.forEach((e) => {
        const domain = domainOf(e.entityId);
        if (!byDomain.has(domain)) byDomain.set(domain, []);
        byDomain.get(domain).push(e);
      });

      const html = Array.from(byDomain.entries()).map(([domain, items]) => `
        <div class="result-group">
          <div class="result-group-label">${domain}</div>
          ${items.map((e) => `
            <div class="result-item" data-entity-id="${e.entityId}">
              <span>${escapeHtml(friendlyName(this._hass, e.entityId, e.name))}</span>
              <span class="result-entity-id">${e.entityId}</span>
            </div>
          `).join("")}
        </div>
      `).join("");

      this._searchResultsEl.innerHTML = html || `<div class="no-results">No matches</div>`;
      this._searchResultsEl.querySelectorAll(".result-item").forEach((item) => {
        item.addEventListener("click", () => {
          this._addEntity(item.getAttribute("data-entity-id"));
          this._searchInput.value = "";
          this._searchResultsEl.innerHTML = "";
          this._searchInput.focus();
        });
      });
    }

    _addEntity(entityId) {
      if (this._dialogData.entities.some((r) => r.entityId === entityId)) return;
      this._dialogData.entities.push(this._defaultRowForEntity(entityId));
      this._renderSelectedEntities();
    }

    _removeEntity(entityId) {
      this._dialogData.entities = this._dialogData.entities.filter((r) => r.entityId !== entityId);
      this._renderSelectedEntities();
    }

    _hvacModesFor(row) {
      const state = this._hass.states[row.entityId];
      return (state && state.attributes && state.attributes.hvac_modes) || ["heat", "cool", "off"];
    }

    _sourceListFor(row) {
      const state = this._hass.states[row.entityId];
      return (state && state.attributes && state.attributes.source_list) || [];
    }

    _renderRowControlsHtml(row) {
      switch (row.kind) {
        case "light":
          return `
            <label class="control">
              <span>Brightness: <b class="val" data-val="brightness_pct">${row.params.brightness_pct}</b>%</span>
              <input type="range" min="1" max="100" value="${row.params.brightness_pct}" data-param="brightness_pct">
            </label>
            ${row.params.color_temp_kelvin != null ? `
            <label class="control">
              <span>Color temp: <b class="val" data-val="color_temp_kelvin">${row.params.color_temp_kelvin}</b>K</span>
              <input type="range" min="2000" max="6500" value="${row.params.color_temp_kelvin}" data-param="color_temp_kelvin">
            </label>` : ""}
          `;
        case "climate":
          return `
            <label class="control">
              <span>Target temp: <b class="val" data-val="temperature">${row.params.temperature}</b>°</span>
              <input type="range" min="10" max="32" step="0.5" value="${row.params.temperature}" data-param="temperature">
            </label>
            <label class="control">
              <span>Mode</span>
              <select data-param="hvac_mode">
                ${this._hvacModesFor(row).map((m) =>
                  `<option value="${m}" ${m === row.params.hvac_mode ? "selected" : ""}>${m}</option>`).join("")}
              </select>
            </label>
          `;
        case "media_player":
          return `
            <label class="control checkbox-control">
              <input type="checkbox" data-action="volume" ${row.actions.volume ? "checked" : ""}>
              <span>Set volume: <b class="val" data-val="volume_level">${Math.round((row.params.volume_level || 0) * 100)}</b>%</span>
            </label>
            <input type="range" min="0" max="100" value="${Math.round((row.params.volume_level || 0) * 100)}" data-param="volume_level" ${row.actions.volume ? "" : "disabled"}>
            <label class="control checkbox-control">
              <input type="checkbox" data-action="source" ${row.actions.source ? "checked" : ""}>
              <span>Set source</span>
            </label>
            <select data-param="source" ${row.actions.source ? "" : "disabled"}>
              ${this._sourceListFor(row).map((s) =>
                `<option value="${escapeHtml(s)}" ${s === row.params.source ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
            </select>
          `;
        case "cover":
          return `
            <label class="control">
              <span>Position: <b class="val" data-val="position">${row.params.position}</b>%</span>
              <input type="range" min="0" max="100" value="${row.params.position}" data-param="position">
            </label>
          `;
        case "trigger":
          return `<p class="hint">Triggers the scene when the event starts.</p>`;
        default:
          return `<p class="hint">Turns on at event start, off at event end.</p>`;
      }
    }

    _renderEntityRowHtml(row) {
      return `
        <div class="entity-row" data-entity-id="${row.entityId}">
          <div class="entity-row-header">
            <span class="entity-row-name">${escapeHtml(row.name)}</span>
            <span class="entity-row-domain">${row.domain}</span>
            <button class="remove-btn" data-remove="${row.entityId}" title="Remove">&#10005;</button>
          </div>
          <div class="entity-row-controls">${this._renderRowControlsHtml(row)}</div>
        </div>
      `;
    }

    _wireEntityRow(row) {
      const rowEl = this._selectedEntitiesEl.querySelector(`.entity-row[data-entity-id="${row.entityId}"]`);
      if (!rowEl) return;
      rowEl.querySelector(".remove-btn").addEventListener("click", () => this._removeEntity(row.entityId));

      rowEl.querySelectorAll("[data-param]").forEach((input) => {
        input.addEventListener("input", () => {
          const key = input.getAttribute("data-param");
          if (input.type === "range") {
            const value = Number(input.value);
            row.params[key] = key === "volume_level" ? value / 100 : value;
            const label = rowEl.querySelector(`.val[data-val="${key}"]`);
            if (label) label.textContent = value;
          } else {
            row.params[key] = input.value;
          }
        });
      });

      rowEl.querySelectorAll("[data-action]").forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
          const action = checkbox.getAttribute("data-action");
          row.actions[action] = checkbox.checked;
          const input = action === "volume"
            ? rowEl.querySelector('[data-param="volume_level"]')
            : rowEl.querySelector('[data-param="source"]');
          if (input) input.disabled = !checkbox.checked;
        });
      });
    }

    _renderSelectedEntities() {
      const rows = this._dialogData.entities;
      if (!rows.length) {
        this._selectedEntitiesEl.innerHTML = `<p class="hint">No entities added yet.</p>`;
        return;
      }
      this._selectedEntitiesEl.innerHTML = rows.map((row) => this._renderEntityRowHtml(row)).join("");
      rows.forEach((row) => this._wireEntityRow(row));
    }

    _buildEntitiesPayload() {
      const entitiesPayload = [];
      this._dialogData.entities.forEach((row) => {
        if (row.kind === "media_player") {
          if (row.actions.volume) {
            entitiesPayload.push({ entity_id: row.entityId, service: "media_player.volume_set", params: { volume_level: row.params.volume_level } });
          }
          if (row.actions.source) {
            entitiesPayload.push({ entity_id: row.entityId, service: "media_player.select_source", params: { source: row.params.source } });
          }
        } else if (row.kind === "light") {
          const params = { brightness_pct: row.params.brightness_pct };
          if (row.params.color_temp_kelvin != null) params.color_temp_kelvin = row.params.color_temp_kelvin;
          entitiesPayload.push({ entity_id: row.entityId, service: "light.turn_on", params });
        } else if (row.kind === "climate") {
          entitiesPayload.push({ entity_id: row.entityId, service: "climate.set_temperature", params: { temperature: row.params.temperature, hvac_mode: row.params.hvac_mode } });
        } else if (row.kind === "cover") {
          entitiesPayload.push({ entity_id: row.entityId, service: "cover.set_cover_position", params: { position: row.params.position } });
        } else if (row.kind === "trigger") {
          entitiesPayload.push({ entity_id: row.entityId, service: "scene.turn_on", params: {} });
        } else {
          entitiesPayload.push({ entity_id: row.entityId, service: `${row.domain}.turn_on`, params: {} });
        }
      });
      return entitiesPayload;
    }

    async _saveDialog() {
      const data = this._dialogData;
      if (!data.entities.length) {
        alert("Add at least one entity.");
        return;
      }
      if (data.end <= data.start) {
        alert("End time must be after start time.");
        return;
      }
      const description = JSON.stringify({ entities: this._buildEntitiesPayload() });
      const eventPayload = {
        summary: data.name || "Scheduled event",
        description,
        dtstart: data.start.toISOString(),
        dtend: data.end.toISOString(),
      };
      const rrule = data.mode === "create" ? buildRRule(data.recurrence, data.customDays) : null;
      if (rrule) eventPayload.rrule = rrule;

      try {
        if (data.mode === "edit") {
          await updateCalendarEvent(this._hass, this._entityId, data.uid, eventPayload, data.recurrenceId, "");
        } else {
          await createCalendarEvent(this._hass, this._entityId, eventPayload);
        }
        this._closeDialog();
        this._loadEvents();
      } catch (err) {
        console.error("hass-calendar-scheduler: save failed", err);
        alert("Failed to save event: " + (err && err.message ? err.message : err));
      }
    }

    async _deleteDialogEvent() {
      const data = this._dialogData;
      if (!confirm("Delete this event?")) return;
      try {
        await deleteCalendarEvent(this._hass, this._entityId, data.uid, data.recurrenceId, "");
        this._closeDialog();
        this._loadEvents();
      } catch (err) {
        console.error("hass-calendar-scheduler: delete failed", err);
        alert("Failed to delete event: " + (err && err.message ? err.message : err));
      }
    }
  }

  customElements.define("hass-calendar-scheduler", HassCalendarScheduler);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "hass-calendar-scheduler",
    name: "Calendar Scheduler",
    description: "Week/day timeline calendar for scheduling Home Assistant entity actions",
  });
})();
