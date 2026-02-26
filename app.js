const DAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const STATUS_META = {
  planned: { label: "Geplant", cls: "status-planned" },
  problem: { label: "Problem", cls: "status-problem" },
  water: { label: "Wasser", cls: "status-water" },
  done: { label: "Erledigt", cls: "status-done" },
};

const STORAGE_KEY = "dispoplan.v1";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("dispoplan-sync") : null;

const initialState = {
  currentWeekKey: getWeekKey(new Date()),
  entrepreneurs: [
    { id: crypto.randomUUID(), name: "PODTIS", plate: "MM-UB-5222AL" },
    { id: crypto.randomUUID(), name: "Sky Trans", plate: "SV-46" },
  ],
  vehicles: [],
  accounts: [{ id: crypto.randomUUID(), username: "dispatcher", role: "Admin" }],
  weeks: {},
};

let state = loadState();
let selectedTourId = null;
ensureWeekExists(state.currentWeekKey);
seedExampleTours(state.currentWeekKey);
saveState();

const board = document.getElementById("board");
const stats = document.getElementById("stats");
const weekLabel = document.getElementById("currentWeekLabel");
const entrepreneurFilter = document.getElementById("entrepreneurFilter");

bindEvents();
render();

function bindEvents() {
  document.getElementById("prevWeekBtn").addEventListener("click", () => switchWeek(-1));
  document.getElementById("nextWeekBtn").addEventListener("click", () => switchWeek(1));

  document.getElementById("newTourBtn").addEventListener("click", () => {
    hydrateEntrepreneurOptions();
    document.getElementById("tourDialog").showModal();
  });
  document.getElementById("cancelTourDialog").addEventListener("click", () => document.getElementById("tourDialog").close());

  document.getElementById("tourForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const tour = {
      id: crypto.randomUUID(),
      title: String(formData.get("title") || ""),
      entrepreneurId: String(formData.get("entrepreneurId") || ""),
      dayIndex: Number(formData.get("dayIndex")),
      status: String(formData.get("status") || "planned"),
      stops: String(formData.get("stops") || "").split(";").map((item) => item.trim()).filter(Boolean),
      notes: String(formData.get("notes") || ""),
      customerStatusRequired: formData.get("customerStatusRequired") === "on",
      customerStatusReportedAt: null,
      arrivalTime: "",
      driverNotified: false,
      updatedAt: new Date().toISOString(),
    };
    state.weeks[state.currentWeekKey].tours.push(tour);
    persistAndRender();
    event.target.reset();
    document.getElementById("tourDialog").close();
  });

  document.getElementById("cancelTourStatusDialog").addEventListener("click", () => {
    selectedTourId = null;
    document.getElementById("tourStatusDialog").close();
  });

  document.getElementById("tourStatusForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const tour = getCurrentWeekTours().find((item) => item.id === selectedTourId);
    if (!tour) return;

    const formData = new FormData(event.target);
    tour.status = String(formData.get("status") || "planned");
    tour.arrivalTime = String(formData.get("arrivalTime") || "");
    tour.driverNotified = formData.get("driverNotified") === "on";
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

  document.getElementById("entrepreneurForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    state.entrepreneurs.push({
      id: crypto.randomUUID(),
      name: String(formData.get("name") || ""),
      plate: String(formData.get("plate") || ""),
    });
    persistAndRender();
    event.target.reset();
  });

  document.getElementById("accountForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    state.accounts.push({ id: crypto.randomUUID(), username: String(formData.get("username") || ""), role: String(formData.get("role") || "") });
    persistAndRender();
    event.target.reset();
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
  renderEntrepreneurs();
  renderAccounts();
  hydrateEntrepreneurFilter();
  hydrateEntrepreneurOptions();
}

function renderStats() {
  const tours = getFilteredTours();
  const counts = tours.reduce((acc, tour) => {
    acc[tour.status] = (acc[tour.status] || 0) + 1;
    return acc;
  }, {});
  const openCount = tours.filter((tour) => tour.status !== "done").length;
  const openCustomerStatusCount = tours.filter((tour) => tour.customerStatusRequired && !tour.customerStatusReportedAt).length;

  stats.innerHTML = Object.entries(STATUS_META)
    .filter(([key]) => key !== "water")
    .map(([key, meta]) => `<div class="stat ${meta.cls}">${counts[key] || 0}<small>${meta.label}</small></div>`)
    .concat(`<div class="stat stat-open">${openCount}<small>Offen zu erledigen · Kundenstatus offen: ${openCustomerStatusCount}</small></div>`)
    .join("");
}

function renderBoard() {
  const weekInfo = parseWeekKey(state.currentWeekKey);
  const monday = isoWeekToDate(weekInfo.year, weekInfo.week);
  const tours = getFilteredTours();
  const truckRows = getTruckRows();

  const headerCells = ['<div class="header-cell">Kennzeichen / LKW</div>']
    .concat(DAY_NAMES.map((name, idx) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + idx);
      return `<div class="header-cell">${name}<div class="small">${formatDate(date)}</div></div>`;
    }))
    .join("");

  const entrepreneurRows = truckRows
    .map((truckRow) => {
      const cells = DAY_NAMES.map((_, dayIndex) => {
        const dayTours = tours.filter((tour) => getTourPlate(tour) === truckRow.plate && tour.dayIndex === dayIndex);
        return `<div class="day-cell" data-entrepreneur-id="${truckRow.primaryEntrepreneurId}" data-day-index="${dayIndex}">
          ${dayTours.map((tour) => renderCard(tour)).join("") || ""}
        </div>`;
      }).join("");

      return `<div class="row-label"><strong>${truckRow.plate}</strong><div class="plate">${truckRow.entrepreneurNames}</div></div>${cells}`;
    })
    .join("");

  board.innerHTML = headerCells + entrepreneurRows;
  attachDndEvents();
  attachCardSelectionEvents();
}

function renderCard(tour) {
  const meta = STATUS_META[tour.status] || STATUS_META.planned;
  const secondaryInfo = [];
  if (tour.arrivalTime) secondaryInfo.push(`Ankunft: ${tour.arrivalTime}`);
  if (tour.driverNotified) secondaryInfo.push("Fahrer informiert");
  if (tour.customerStatusRequired && !tour.customerStatusReportedAt) secondaryInfo.push("Kundenstatus offen");
  if (tour.customerStatusRequired && tour.customerStatusReportedAt) secondaryInfo.push("Kundenstatus gemeldet");

  return `<article class="card" draggable="true" data-tour-id="${tour.id}">
    <div class="card-header">
      <span class="status ${meta.cls}">${meta.label}</span>
      <small>${new Date(tour.updatedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</small>
    </div>
    <strong>${tour.title}</strong>
    <div>${(tour.stops || []).slice(0, 2).join(" → ") || "Freies Feld"}</div>
    <div class="small">${tour.notes || ""}</div>
    ${secondaryInfo.length > 0 ? `<div class="small">${secondaryInfo.join(" · ")}</div>` : ""}
  </article>`;
}

function attachCardSelectionEvents() {
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", () => openTourStatusDialog(card.dataset.tourId));
  });
}

function openTourStatusDialog(tourId) {
  const tour = getCurrentWeekTours().find((item) => item.id === tourId);
  if (!tour) return;
  selectedTourId = tour.id;

  document.getElementById("tourStatusTitle").textContent = `Tour bearbeiten: ${tour.title}`;
  document.getElementById("editTourStatus").value = tour.status;
  document.getElementById("editArrivalTime").value = tour.arrivalTime || "";
  document.getElementById("editDriverNotified").checked = Boolean(tour.driverNotified);
  document.getElementById("editCustomerStatusRequired").checked = Boolean(tour.customerStatusRequired);
  document.getElementById("editCustomerStatusDone").checked = Boolean(tour.customerStatusReportedAt);

  document.getElementById("tourStatusDialog").showModal();
}

function getTruckRows() {
  const trucksByPlate = new Map();

  state.entrepreneurs.forEach((entrepreneur) => {
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
      tour.dayIndex = Number(cell.dataset.dayIndex);
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
  entrepreneurFilter.innerHTML = '<option value="all">Alle</option>' + state.entrepreneurs.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  entrepreneurFilter.value = state.entrepreneurs.some((item) => item.id === currentValue) ? currentValue : "all";
}

function hydrateEntrepreneurOptions() {
  const target = document.getElementById("tourEntrepreneur");
  target.innerHTML = state.entrepreneurs.map((item) => `<option value="${item.id}">${item.name} · ${item.plate}</option>`).join("");
}

function getFilteredTours() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();
  const status = document.getElementById("statusFilter").value;
  const entrepreneurId = entrepreneurFilter.value;

  return getCurrentWeekTours().filter((tour) => {
    const entrepreneur = state.entrepreneurs.find((item) => item.id === tour.entrepreneurId);
    const haystack = `${tour.title} ${tour.notes} ${(tour.stops || []).join(" ")} ${entrepreneur?.name || ""} ${entrepreneur?.plate || ""}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesStatus = status === "all" || tour.status === status;
    const matchesEntrepreneur = entrepreneurId === "all" || tour.entrepreneurId === entrepreneurId;
    return matchesSearch && matchesStatus && matchesEntrepreneur;
  });
}

function getCurrentWeekTours() {
  ensureWeekExists(state.currentWeekKey);
  return state.weeks[state.currentWeekKey].tours;
}

function normalizeTour(tour) {
  return {
    ...tour,
    customerStatusRequired: Boolean(tour.customerStatusRequired),
    customerStatusReportedAt: tour.customerStatusReportedAt || null,
    arrivalTime: tour.arrivalTime || "",
    driverNotified: Boolean(tour.driverNotified),
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(initialState);
  try {
    const parsed = JSON.parse(raw);
    const weeks = Object.fromEntries(
      Object.entries(parsed.weeks || {}).map(([key, value]) => [
        key,
        {
          ...value,
          tours: (value.tours || []).map(normalizeTour),
        },
      ]),
    );

    return {
      ...structuredClone(initialState),
      ...parsed,
      weeks,
      entrepreneurs: parsed.entrepreneurs || [],
      accounts: parsed.accounts || [],
      vehicles: parsed.vehicles || [],
    };
  } catch {
    return structuredClone(initialState);
  }
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
  state.weeks[weekKey].tours = (state.weeks[weekKey].tours || []).map(normalizeTour);
}

function seedExampleTours(weekKey) {
  if (state.weeks[weekKey].tours.length > 0 || state.entrepreneurs.length === 0) return;
  state.weeks[weekKey].tours.push(
    {
      id: crypto.randomUUID(),
      title: "Linz → Gärchzing",
      entrepreneurId: state.entrepreneurs[0].id,
      dayIndex: 0,
      status: "water",
      stops: ["Linz", "Gärchzing"],
      notes: "Trailer 24t",
      customerStatusRequired: true,
      customerStatusReportedAt: null,
      arrivalTime: "",
      driverNotified: false,
      updatedAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      title: "Dresden Sonderfahrt",
      entrepreneurId: state.entrepreneurs[1].id,
      dayIndex: 4,
      status: "problem",
      stops: ["Dresden", "Freilassing"],
      notes: "Fahrer bestätigen",
      customerStatusRequired: false,
      customerStatusReportedAt: null,
      arrivalTime: "",
      driverNotified: false,
      updatedAt: new Date().toISOString(),
    },
  );
}

function formatDate(date) {
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
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
