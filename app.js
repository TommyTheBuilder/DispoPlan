const DAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const STATUS_META = {
  planned: { label: "Geplant", cls: "status-planned" },
  problem: { label: "Problem", cls: "status-problem" },
  sent: { label: "Geschickt", cls: "status-sent" },
};

const STORAGE_KEY = "dispoplan.v1";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("dispoplan-sync") : null;

const initialState = {
  currentWeekKey: getWeekKey(new Date()),
  currentDepartmentId: "all",
  departments: [
    { id: crypto.randomUUID(), name: "Fernverkehr" },
    { id: crypto.randomUUID(), name: "Nahverkehr" },
  ],
  entrepreneurs: [
    { id: crypto.randomUUID(), name: "PODTIS", plate: "MM-UB-5222AL" },
    { id: crypto.randomUUID(), name: "Sky Trans", plate: "SV-46" },
  ],
  vehicles: [],
  accounts: [{ id: crypto.randomUUID(), username: "dispatcher", role: "Admin" }],
  weeks: {},
};

const defaultDepartmentId = initialState.departments[0]?.id || "";
initialState.entrepreneurs = initialState.entrepreneurs.map((item) => ({ ...item, departmentId: defaultDepartmentId }));

let state = loadState();
let selectedTourId = null;
ensureWeekExists(state.currentWeekKey);
seedExampleTours(state.currentWeekKey);
saveState();

const board = document.getElementById("board");
const stats = document.getElementById("stats");
const weekLabel = document.getElementById("currentWeekLabel");
const entrepreneurFilter = document.getElementById("entrepreneurFilter");
const departmentFilter = document.getElementById("departmentFilter");

bindEvents();
render();

function bindEvents() {
  document.getElementById("prevWeekBtn").addEventListener("click", () => switchWeek(-1));
  document.getElementById("nextWeekBtn").addEventListener("click", () => switchWeek(1));

  document.getElementById("newTourBtn").addEventListener("click", () => {
    hydrateEntrepreneurOptions();
    hydrateDepartmentOptions();
    prefillTourDateRange();
    document.getElementById("tourDialog").showModal();
  });
  document.getElementById("cancelTourDialog").addEventListener("click", () => document.getElementById("tourDialog").close());

  document.getElementById("tourForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const fromDate = String(formData.get("fromDate") || "");
    const toDate = String(formData.get("toDate") || "");
    if (!isValidDateRange(fromDate, toDate)) return;

    const selectedDepartmentId = String(formData.get("departmentId") || "");
    const tour = {
      id: crypto.randomUUID(),
      title: String(formData.get("title") || ""),
      entrepreneurId: String(formData.get("entrepreneurId") || ""),
      departmentId: getValidDepartmentId(selectedDepartmentId),
      status: normalizeStatus(formData.get("status")),
      fromDate,
      toDate,
      loadLocation: String(formData.get("loadLocation") || ""),
      unloadLocation: String(formData.get("unloadLocation") || ""),
      notes: String(formData.get("notes") || ""),
      customerStatusRequired: formData.get("customerStatusRequired") === "on",
      customerStatusReportedAt: null,
      arrivalTime: "",
      updatedAt: new Date().toISOString(),
    };
    getCurrentWeekTours().push(tour);
    persistAndRender();
    event.target.reset();
    document.getElementById("tourDialog").close();
  });

  document.getElementById("cancelTourStatusDialog").addEventListener("click", () => {
    selectedTourId = null;
    document.getElementById("tourStatusDialog").close();
  });

  document.getElementById("deleteTourBtn").addEventListener("click", () => {
    if (!selectedTourId) return;
    state.weeks[state.currentWeekKey].tours = getCurrentWeekTours().filter((tour) => tour.id !== selectedTourId);
    selectedTourId = null;
    document.getElementById("tourStatusDialog").close();
    persistAndRender();
  });

  document.getElementById("tourStatusForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const tour = getCurrentWeekTours().find((item) => item.id === selectedTourId);
    if (!tour) return;

    const formData = new FormData(event.target);
    const fromDate = String(formData.get("fromDate") || "");
    const toDate = String(formData.get("toDate") || "");
    if (!isValidDateRange(fromDate, toDate)) return;

    tour.status = normalizeStatus(formData.get("status"));
    tour.fromDate = fromDate;
    tour.toDate = toDate;
    tour.loadLocation = String(formData.get("loadLocation") || "");
    tour.unloadLocation = String(formData.get("unloadLocation") || "");
    tour.arrivalTime = String(formData.get("arrivalTime") || "");
    tour.customerStatusRequired = formData.get("customerStatusRequired") === "on";

    const statusDone = formData.get("customerStatusDone") === "on";
    if (!tour.customerStatusRequired) {
      tour.customerStatusReportedAt = null;
    } else if (statusDone) {
      tour.customerStatusReportedAt = tour.customerStatusReportedAt || new Date().toISOString();
    } else {
      tour.customerStatusReportedAt = null;
    }

    tour.updatedAt = new Date().toISOString();
    selectedTourId = null;
    document.getElementById("tourStatusDialog").close();
    persistAndRender();
  });

  document.getElementById("searchInput").addEventListener("input", render);
  document.getElementById("statusFilter").addEventListener("change", render);
  entrepreneurFilter.addEventListener("change", render);
  departmentFilter.addEventListener("change", () => {
    state.currentDepartmentId = departmentFilter.value;
    persistAndRender();
  });

  if (channel) {
    channel.onmessage = ({ data }) => {
      if (data?.type === "state-updated") {
        state = loadState();
        render();
      }
    };
  }
}

function switchWeek(offset) {
  const [year, week] = state.currentWeekKey.split("-KW").map(Number);
  const monday = isoWeekToDate(year, week);
  monday.setDate(monday.getDate() + offset * 7);
  state.currentWeekKey = getWeekKey(monday);
  ensureWeekExists(state.currentWeekKey);
  persistAndRender();
}

function render() {
  weekLabel.textContent = state.currentWeekKey;
  renderStats();
  renderBoard();
  hydrateEntrepreneurFilter();
  hydrateDepartmentFilter();
  hydrateEntrepreneurOptions();
  hydrateDepartmentOptions();
}

function renderStats() {
  const tours = getFilteredTours();
  const counts = tours.reduce((acc, tour) => {
    acc[tour.status] = (acc[tour.status] || 0) + 1;
    return acc;
  }, {});
  const openCount = tours.filter((tour) => tour.status !== "sent").length;
  const openCustomerStatusCount = tours.filter((tour) => tour.customerStatusRequired && !tour.customerStatusReportedAt).length;

  stats.innerHTML = Object.entries(STATUS_META)
    .map(([key, meta]) => `<div class="stat ${meta.cls}">${counts[key] || 0}<small>${meta.label}</small></div>`)
    .concat(`<div class="stat stat-open">${openCount}<small>Kundenstatus offen: ${openCustomerStatusCount}</small></div>`)
    .join("");
}

function renderBoard() {
  const weekInfo = parseWeekKey(state.currentWeekKey);
  const monday = isoWeekToDate(weekInfo.year, weekInfo.week);
  const tours = getFilteredTours();
  const truckRows = getTruckRows();

  const weekDays = DAY_NAMES.map((name, idx) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + idx);
    return { name, date, dateIso: toIsoDate(date) };
  });

  const headerCells = ['<div class="header-cell">Kennzeichen / LKW</div>']
    .concat(weekDays.map((item) => `<div class="header-cell">${item.name}<div class="small">${formatDate(item.date)}</div></div>`))
    .join("");

  const rowHtml = truckRows
    .map((truckRow) => {
      const toursForTruck = tours.filter((tour) => getTourPlate(tour) === truckRow.plate);
      const cells = weekDays.map((item) => {
        const dayTours = toursForTruck.filter((tour) => tour.fromDate === item.dateIso);
        const emptyHint = dayTours.length === 0 ? renderTruckEmptyHint(toursForTruck, item.dateIso) : "";
        return `<div class="day-cell" data-entrepreneur-id="${truckRow.primaryEntrepreneurId}" data-date="${item.dateIso}">
          ${dayTours.map((tour) => renderCard(tour)).join("")}
          ${emptyHint}
        </div>`;
      }).join("");

      return `<div class="row-label"><strong>${truckRow.plate}</strong><div class="plate">${truckRow.entrepreneurNames}</div></div>${cells}`;
    })
    .join("");

  board.innerHTML = headerCells + rowHtml;
  attachDndEvents();
  attachCardSelectionEvents();
  attachEmptyHintEvents();
}

function renderCard(tour) {
  const meta = STATUS_META[tour.status] || STATUS_META.planned;
  const secondaryInfo = [];
  if (tour.arrivalTime) secondaryInfo.push(`Ankunft: ${tour.arrivalTime}`);
  if (tour.customerStatusRequired && !tour.customerStatusReportedAt) secondaryInfo.push("Kundenstatus offen");
  if (tour.customerStatusRequired && tour.customerStatusReportedAt) secondaryInfo.push("Kundenstatus gemeldet");

  return `<article class="card" draggable="true" data-tour-id="${tour.id}">
    <div class="card-header">
      <span class="status ${meta.cls}">${meta.label}</span>
      <small>${new Date(tour.updatedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</small>
    </div>
    <strong>${tour.title}</strong>
    <div class="small">${formatLongDate(tour.fromDate)} ${tour.loadLocation} → ${tour.unloadLocation}</div>
    <div class="small">${tour.notes || ""}</div>
    ${secondaryInfo.length > 0 ? `<div class="small">${secondaryInfo.join(" · ")}</div>` : ""}
  </article>`;
}

function renderTruckEmptyHint(toursForTruck, dateIso) {
  const previousTour = toursForTruck
    .filter((tour) => tour.toDate === dateIso)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!previousTour) return "";

  return `<button type="button" class="empty-hint" data-empty-hint-tour-id="${previousTour.id}">Leer am ${formatLongDate(previousTour.toDate)} in ${previousTour.unloadLocation || "unbekannt"}<small>Ankunftszeit eintragen</small></button>`;
}

function attachCardSelectionEvents() {
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", () => openTourStatusDialog(card.dataset.tourId));
  });
}

function attachEmptyHintEvents() {
  document.querySelectorAll("[data-empty-hint-tour-id]").forEach((hintButton) => {
    hintButton.addEventListener("click", () => openTourStatusDialog(hintButton.dataset.emptyHintTourId));
  });
}

function openTourStatusDialog(tourId) {
  const tour = getCurrentWeekTours().find((item) => item.id === tourId);
  if (!tour) return;
  selectedTourId = tour.id;

  document.getElementById("tourStatusTitle").textContent = `Tour bearbeiten: ${tour.title}`;
  document.getElementById("editTourStatus").value = normalizeStatus(tour.status);
  document.getElementById("editFromDate").value = tour.fromDate;
  document.getElementById("editToDate").value = tour.toDate;
  document.getElementById("editLoadLocation").value = tour.loadLocation;
  document.getElementById("editUnloadLocation").value = tour.unloadLocation;
  document.getElementById("editArrivalTime").value = tour.arrivalTime || "";
  document.getElementById("editCustomerStatusRequired").checked = Boolean(tour.customerStatusRequired);
  document.getElementById("editCustomerStatusDone").checked = Boolean(tour.customerStatusReportedAt);

  document.getElementById("tourStatusDialog").showModal();
  setTimeout(() => document.getElementById("editArrivalTime").focus(), 0);
}

function getEntrepreneursForSelectedDepartment() {
  if (state.currentDepartmentId === "all") return state.entrepreneurs;
  return state.entrepreneurs.filter((item) => item.departmentId === state.currentDepartmentId);
}

function getTruckRows() {
  const trucksByPlate = new Map();

  getEntrepreneursForSelectedDepartment().forEach((entrepreneur) => {
    const plate = entrepreneur.plate || "ohne Kennzeichen";
    if (!trucksByPlate.has(plate)) {
      trucksByPlate.set(plate, {
        plate,
        primaryEntrepreneurId: entrepreneur.id,
        entrepreneurNames: new Set([entrepreneur.name]),
      });
      return;
    }
    trucksByPlate.get(plate).entrepreneurNames.add(entrepreneur.name);
  });

  return Array.from(trucksByPlate.values()).map((row) => ({
    ...row,
    entrepreneurNames: Array.from(row.entrepreneurNames).join(", "),
  }));
}

function getTourPlate(tour) {
  const entrepreneur = state.entrepreneurs.find((item) => item.id === tour.entrepreneurId);
  return entrepreneur?.plate || "ohne Kennzeichen";
}

function attachDndEvents() {
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/tour-id", card.dataset.tourId);
    });
  });

  document.querySelectorAll(".day-cell").forEach((cell) => {
    cell.addEventListener("dragover", (event) => {
      event.preventDefault();
      cell.classList.add("drag-over");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
    cell.addEventListener("drop", (event) => {
      event.preventDefault();
      cell.classList.remove("drag-over");
      const tourId = event.dataTransfer.getData("text/tour-id");
      const tour = getCurrentWeekTours().find((item) => item.id === tourId);
      if (!tour) return;

      const startDate = cell.dataset.date;
      const durationDays = Math.max(0, getDateDiffDays(tour.fromDate, tour.toDate));
      tour.fromDate = startDate;
      tour.toDate = addDaysIso(startDate, durationDays);
      tour.entrepreneurId = cell.dataset.entrepreneurId;
      tour.updatedAt = new Date().toISOString();
      persistAndRender();
    });
  });
}

function renderEntrepreneurs() {
  const list = document.getElementById("entrepreneurList");
  list.innerHTML = state.entrepreneurs
    .map((item) => `<li><span>${item.name} · ${item.plate}</span><button class="btn" data-remove-entrepreneur="${item.id}">Löschen</button></li>`)
    .join("");
  list.querySelectorAll("[data-remove-entrepreneur]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.removeEntrepreneur;
      state.entrepreneurs = state.entrepreneurs.filter((item) => item.id !== id);
      Object.values(state.weeks).forEach((week) => {
        week.tours = week.tours.filter((tour) => tour.entrepreneurId !== id);
      });
      persistAndRender();
    });
  });
}

function renderDepartments() {
  const list = document.getElementById("departmentList");
  list.innerHTML = state.departments
    .map((item) => `<li><span>${item.name}</span><button class="btn" data-remove-department="${item.id}">Löschen</button></li>`)
    .join("");
  list.querySelectorAll("[data-remove-department]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.removeDepartment;
      state.departments = state.departments.filter((item) => item.id !== id);
      Object.values(state.weeks).forEach((week) => {
        week.tours = week.tours.filter((tour) => tour.departmentId !== id);
      });
      state.currentDepartmentId = "all";
      persistAndRender();
    });
  });
}

function renderAccounts() {
  const list = document.getElementById("accountList");
  list.innerHTML = state.accounts
    .map((item) => `<li><span>${item.username} (${item.role})</span><button class="btn" data-remove-account="${item.id}">Löschen</button></li>`)
    .join("");
  list.querySelectorAll("[data-remove-account]").forEach((button) => {
    button.addEventListener("click", () => {
      state.accounts = state.accounts.filter((item) => item.id !== button.dataset.removeAccount);
      persistAndRender();
    });
  });
}

function hydrateEntrepreneurFilter() {
  const currentValue = entrepreneurFilter.value;
  const entrepreneurs = getEntrepreneursForSelectedDepartment();
  entrepreneurFilter.innerHTML = '<option value="all">Alle</option>' + entrepreneurs.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  entrepreneurFilter.value = entrepreneurs.some((item) => item.id === currentValue) ? currentValue : "all";
}

function hydrateDepartmentFilter() {
  const currentValue = state.currentDepartmentId;
  departmentFilter.innerHTML = '<option value="all">Alle</option>' + state.departments.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  departmentFilter.value = state.departments.some((item) => item.id === currentValue) ? currentValue : "all";
  state.currentDepartmentId = departmentFilter.value;
}

function hydrateEntrepreneurOptions() {
  const target = document.getElementById("tourEntrepreneur");
  const entrepreneurs = getEntrepreneursForSelectedDepartment();
  target.innerHTML = entrepreneurs.map((item) => `<option value="${item.id}">${item.name} · ${item.plate}</option>`).join("");
}

function hydrateDepartmentOptions() {
  const target = document.getElementById("tourDepartment");
  target.innerHTML = state.departments.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  const preferred = state.currentDepartmentId !== "all" ? state.currentDepartmentId : (state.departments[0]?.id || "");
  target.value = preferred;
}

function getFilteredTours() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();
  const status = document.getElementById("statusFilter").value;
  const entrepreneurId = entrepreneurFilter.value;

  return getCurrentWeekTours().filter((tour) => {
    const entrepreneur = state.entrepreneurs.find((item) => item.id === tour.entrepreneurId);
    const department = state.departments.find((item) => item.id === tour.departmentId);
    const haystack = `${tour.title} ${tour.notes} ${tour.loadLocation} ${tour.unloadLocation} ${entrepreneur?.name || ""} ${entrepreneur?.plate || ""} ${department?.name || ""}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesStatus = status === "all" || tour.status === status;
    const matchesEntrepreneur = entrepreneurId === "all" || tour.entrepreneurId === entrepreneurId;
    const matchesDepartment = state.currentDepartmentId === "all" || tour.departmentId === state.currentDepartmentId;
    return matchesSearch && matchesStatus && matchesEntrepreneur && matchesDepartment;
  });
}

function getCurrentWeekTours() {
  ensureWeekExists(state.currentWeekKey);
  return state.weeks[state.currentWeekKey].tours;
}

function normalizeStatus(status) {
  if (status === "done") return "sent";
  if (status === "water") return "planned";
  if (!STATUS_META[status]) return "planned";
  return status;
}

function normalizeEntrepreneur(item, departments) {
  const fallbackDepartmentId = departments[0]?.id || "";
  return {
    ...item,
    departmentId: departments.some((dep) => dep.id === item.departmentId) ? item.departmentId : fallbackDepartmentId,
  };
}

function normalizeTour(tour, weekKey) {
  const weekInfo = parseWeekKey(weekKey);
  const monday = isoWeekToDate(weekInfo.year, weekInfo.week);
  const legacyDay = Number.isInteger(tour.dayIndex) ? tour.dayIndex : 0;
  const legacyDate = toIsoDate(addDays(new Date(monday), legacyDay));

  const fromDate = tour.fromDate || legacyDate;
  const toDate = tour.toDate || fromDate;

  return {
    ...tour,
    departmentId: tour.departmentId || "",
    status: normalizeStatus(tour.status),
    fromDate,
    toDate: toDate < fromDate ? fromDate : toDate,
    loadLocation: tour.loadLocation || (tour.stops?.[0] || ""),
    unloadLocation: tour.unloadLocation || (tour.stops?.[1] || ""),
    customerStatusRequired: Boolean(tour.customerStatusRequired),
    customerStatusReportedAt: tour.customerStatusReportedAt || null,
    arrivalTime: tour.arrivalTime || "",
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(initialState);
  try {
    const parsed = JSON.parse(raw);
    const departments = parsed.departments?.length ? parsed.departments : structuredClone(initialState.departments);

    const merged = {
      ...structuredClone(initialState),
      ...parsed,
      departments,
      entrepreneurs: (parsed.entrepreneurs?.length ? parsed.entrepreneurs : structuredClone(initialState.entrepreneurs)).map((item) => normalizeEntrepreneur(item, departments)),
      accounts: parsed.accounts || [],
      vehicles: parsed.vehicles || [],
      weeks: {},
    };

    merged.weeks = Object.fromEntries(
      Object.entries(parsed.weeks || {}).map(([key, value]) => [
        key,
        {
          ...value,
          tours: (value.tours || []).map((tour) => normalizeTourWithDepartments(tour, key, merged.departments)),
        },
      ]),
    );

    return merged;
  } catch {
    return structuredClone(initialState);
  }
}

function normalizeTourWithDepartments(tour, weekKey, departments) {
  const firstDepartmentId = departments[0]?.id || "";
  const normalized = normalizeTour(tour, weekKey);
  if (!departments.some((item) => item.id === normalized.departmentId)) {
    normalized.departmentId = firstDepartmentId;
  }
  return normalized;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function persistAndRender() {
  saveState();
  if (channel) channel.postMessage({ type: "state-updated" });
  render();
}

function ensureWeekExists(weekKey) {
  if (!state.weeks[weekKey]) {
    state.weeks[weekKey] = { tours: [], createdAt: new Date().toISOString() };
  }
  state.weeks[weekKey].tours = (state.weeks[weekKey].tours || []).map((tour) => normalizeTourWithDepartments(tour, weekKey, state.departments));
}

function seedExampleTours(weekKey) {
  if (state.weeks[weekKey].tours.length > 0 || state.entrepreneurs.length === 0) return;
  const weekInfo = parseWeekKey(weekKey);
  const monday = isoWeekToDate(weekInfo.year, weekInfo.week);
  const mondayIso = toIsoDate(monday);
  const tuesdayIso = toIsoDate(addDays(new Date(monday), 1));
  const firstDepartmentId = state.departments[0]?.id || "";

  state.weeks[weekKey].tours.push(
    {
      id: crypto.randomUUID(),
      title: "München → Stuttgart",
      entrepreneurId: state.entrepreneurs[0].id,
      departmentId: firstDepartmentId,
      status: "planned",
      fromDate: mondayIso,
      toDate: tuesdayIso,
      loadLocation: "D-80 München",
      unloadLocation: "D-70 Stuttgart",
      notes: "Trailer 24t",
      customerStatusRequired: true,
      customerStatusReportedAt: null,
      arrivalTime: "",
      updatedAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      title: "Dresden Sonderfahrt",
      entrepreneurId: state.entrepreneurs[1].id,
      departmentId: firstDepartmentId,
      status: "problem",
      fromDate: toIsoDate(addDays(new Date(monday), 4)),
      toDate: toIsoDate(addDays(new Date(monday), 4)),
      loadLocation: "Dresden",
      unloadLocation: "Freilassing",
      notes: "Fahrer bestätigen",
      customerStatusRequired: false,
      customerStatusReportedAt: null,
      arrivalTime: "",
      updatedAt: new Date().toISOString(),
    },
  );
}

function getValidDepartmentId(inputId) {
  if (state.departments.some((item) => item.id === inputId)) return inputId;
  return state.departments[0]?.id || "";
}

function prefillTourDateRange() {
  const form = document.getElementById("tourForm");
  const weekInfo = parseWeekKey(state.currentWeekKey);
  const monday = isoWeekToDate(weekInfo.year, weekInfo.week);
  form.elements.fromDate.value = toIsoDate(monday);
  form.elements.toDate.value = toIsoDate(monday);
}

function isTourActiveOnDate(tour, dateIso) {
  return tour.fromDate <= dateIso && tour.toDate >= dateIso;
}

function isValidDateRange(fromDate, toDate) {
  return Boolean(fromDate) && Boolean(toDate) && fromDate <= toDate;
}

function getDateDiffDays(fromIso, toIso) {
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T00:00:00`);
  return Math.round((to - from) / 86400000);
}

function addDaysIso(baseIso, days) {
  const date = new Date(`${baseIso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(date) {
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function formatLongDate(dateIso) {
  if (!dateIso) return "";
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

function getWeekKey(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-KW${weekNo}`;
}

function parseWeekKey(key) {
  const [yearPart, weekPart] = key.split("-KW");
  return { year: Number(yearPart), week: Number(weekPart) };
}

function isoWeekToDate(year, week) {
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dow = simple.getDay();
  const monday = new Date(simple);
  if (dow <= 4) monday.setDate(simple.getDate() - simple.getDay() + 1);
  else monday.setDate(simple.getDate() + 8 - simple.getDay());
  return monday;
}
