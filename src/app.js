import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";

const AUTH_STORAGE_KEY = "focusAttendanceSession";
const SAVED_LOGIN_STORAGE_KEY = "focusAttendanceSavedLogin";
const colors = ["#0f766e", "#2563eb", "#9333ea", "#d97706", "#db2777", "#16a34a", "#475569", "#dc2626"];
const scheduleTypes = [
  { value: "customer", label: "고객미팅", color: "#22C55E" },
  { value: "education", label: "교육/행사", color: "#8B5CF6" },
  { value: "personal", label: "개인일정", color: "#F97316" },
  { value: "vacation", label: "휴가", color: "#6B7280" }
];
const loginAssetsPath = "/assets/login";
const calendarAssetsPath = "/assets/calendar";
const mobileCarriers = ["SKT", "KT", "LGU+", "SKT(알뜰)", "KT(알뜰)", "LGU+(알뜰)"];
const defaultScheduleColor = "#10B981";
const pastelScheduleColors = [
  "#10B981",
  "#A7F3D0",
  "#93C5FD",
  "#C4B5FD",
  "#FBCFE8",
  "#FDBA74",
  "#FDE68A",
  "#67E8F9",
  "#CBD5E1",
  "#FCA5A5"
];
const insuranceCompanies = {
  GA: [{ id: "ga-aplus", name: "에이플러스에셋" }],
  LIFE: [
    { id: "life-lina", name: "라이나생명" },
    { id: "life-miraeasset", name: "미래에셋생명" },
    { id: "life-heungkuk", name: "흥국생명" },
    { id: "life-db", name: "DB생명" },
    { id: "life-im", name: "iM라이프" },
    { id: "life-kdb", name: "KDB생명" },
    { id: "life-dongyang", name: "동양생명" },
    { id: "life-prudential", name: "푸르덴셜" },
    { id: "life-hanwha", name: "한화생명" },
    { id: "life-metlife", name: "메트라이프" },
    { id: "life-samsung", name: "삼성생명" },
    { id: "life-abl", name: "ABL생명" },
    { id: "life-bnp", name: "BNP PARIBAS" },
    { id: "life-nh", name: "NH농협생명" },
    { id: "life-shinhan", name: "신한라이프" },
    { id: "life-ibk", name: "IBK연금보험" },
    { id: "life-kb", name: "KB생명보험" },
    { id: "life-chubb", name: "CHUBB" },
    { id: "life-kyobo", name: "교보생명" },
    { id: "life-fubon", name: "푸본현대생명" },
    { id: "life-hana", name: "하나생명" },
    { id: "life-aia", name: "AIA생명" }
  ],
  NONLIFE: [
    { id: "nonlife-meritz", name: "메리츠화재" },
    { id: "nonlife-hyundai", name: "현대해상" },
    { id: "nonlife-db", name: "DB손해보험" },
    { id: "nonlife-samsung", name: "삼성화재" },
    { id: "nonlife-lotte", name: "롯데손해보험" },
    { id: "nonlife-kb", name: "KB손해보험" },
    { id: "nonlife-hanwha", name: "한화손해보험" },
    { id: "nonlife-nh", name: "NH농협손해보험" },
    { id: "nonlife-mg", name: "MG손해보험" },
    { id: "nonlife-hana", name: "하나손해보험" },
    { id: "nonlife-heungkuk", name: "흥국화재" },
    { id: "nonlife-aig", name: "AIG손해보험" },
    { id: "nonlife-chubb", name: "CHUBB손해보험" }
  ]
};

let app = null;
let supabase = null;
let activeScanner = null;
let scanInFlight = false;
let scannerModulePromise = null;
let Html5QrcodeClass = null;
let Html5QrcodeFormats = null;

let state = {
  settings: { branchName: "FOCUS 지점", timezone: "Asia/Seoul" },
  employees: [],
  records: [],
  schedules: [],
  insuranceAccounts: [],
  insuranceCanManageAll: false,
  insuranceAccountError: "",
  today: null,
  checkInUrl: "",
  wallQrUrl: "",
  attendanceCode: "",
  qrDataUrl: "",
  selectedDate: toDateKey(new Date()),
  monthCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  employeeFilter: "all",
  daySheetOpen: false,
  scheduleEditorMode: "",
  selectedScheduleId: "",
  scheduleSheetMode: "summary",
  scheduleDraftColor: defaultScheduleColor,
  scheduleDraftForm: null,
  colorPaletteOpen: false,
  scheduleNoticeOn: false,
  calendarSearchOpen: false,
  calendarSearchQuery: "",
  accountTab: "LIFE",
  accountSearch: "",
  accountSearchOpen: false,
  accountEditMode: false,
  accountEmployeeId: "",
  authMode: "login",
  auth: { status: "checking", token: "", employee: null },
  savedLogin: { employeeNo: "", password: "", rememberCredentials: false, autoLogin: false },
  scannerStatus: "idle",
  scannerError: "",
  pendingQrCode: "",
  checkInStatus: "idle",
  checkInError: "",
  checkInAttemptedFor: "",
  lastCheckIn: null
};

export function startApp(rootElement) {
  app = rootElement;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    renderConfigError();
    return () => {};
  }

  supabase = createClient(url, anonKey);
  initializeSafely();
  return () => stopScanner({ rerender: false });
}

const route = () => {
  if (window.location.pathname === "/calendar") return "calendar";
  if (window.location.pathname === "/accounts") return "accounts";
  if (window.location.pathname === "/checkin") return "checkin";
  return "dashboard";
};
const isCheckinRoute = () => route() === "checkin";
const isAccountsRoute = () => route() === "accounts";
const isEmployeeRoute = () => ["checkin", "calendar", "accounts"].includes(route());
const isAdminRoute = () => route() === "dashboard";

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatKoreanDate(key) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(dateFromKey(key));
}

function formatFullDate(key) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(dateFromKey(key));
}

function formatWeekdayShort(key) {
  return new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(dateFromKey(key));
}

const koreaHolidaysByYear = {
  2026: new Set([
    "2026-01-01",
    "2026-02-16",
    "2026-02-17",
    "2026-02-18",
    "2026-03-01",
    "2026-03-02",
    "2026-05-05",
    "2026-05-24",
    "2026-05-25",
    "2026-06-03",
    "2026-06-06",
    "2026-08-15",
    "2026-08-17",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
    "2026-10-03",
    "2026-10-05",
    "2026-10-09",
    "2026-12-25"
  ])
};
const fixedKoreaHolidayMonthDays = new Set(["01-01", "03-01", "05-05", "06-06", "08-15", "10-03", "10-09", "12-25"]);

function isKoreaHolidayKey(key) {
  const year = Number(key.slice(0, 4));
  const monthDay = key.slice(5);
  return koreaHolidaysByYear[year]?.has(key) || fixedKoreaHolidayMonthDays.has(monthDay);
}

function calendarDayTone(day, key) {
  if (isKoreaHolidayKey(key) || day.getDay() === 0) return "holiday";
  if (day.getDay() === 6) return "saturday";
  return "normal";
}

function getUrlQrCode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("qr") || params.get("code") || "";
}

function parseScannedQr(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return (
      url.searchParams.get("qr") ||
      url.searchParams.get("code") ||
      url.searchParams.get("attendanceCode") ||
      raw
    );
  } catch {
    const match = raw.match(/[?&#](?:qr|code|attendanceCode)=([^&#]+)/);
    return match ? decodeURIComponent(match[1]) : raw;
  }
}

function employeeColor(employeeId) {
  let hash = 0;
  for (const char of String(employeeId)) hash = (hash + char.charCodeAt(0)) % colors.length;
  return colors[hash];
}

function employeeNoLabel(value) {
  return value ? value : "사번 미등록";
}

function defaultSavedLogin() {
  return { employeeNo: "", password: "", rememberCredentials: false, autoLogin: false };
}

function readSavedLogin() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_LOGIN_STORAGE_KEY) || "{}");
    return {
      employeeNo: typeof saved.employeeNo === "string" ? saved.employeeNo : "",
      password: typeof saved.password === "string" ? saved.password : "",
      rememberCredentials: Boolean(saved.rememberCredentials),
      autoLogin: Boolean(saved.autoLogin)
    };
  } catch {
    return defaultSavedLogin();
  }
}

function writeSavedLogin({ employeeNo = "", password = "", rememberCredentials = false, autoLogin = false }) {
  const shouldRemember = Boolean(rememberCredentials || autoLogin);
  if (!shouldRemember) {
    localStorage.removeItem(SAVED_LOGIN_STORAGE_KEY);
    return defaultSavedLogin();
  }

  const saved = {
    employeeNo: String(employeeNo).trim(),
    password: String(password),
    rememberCredentials: true,
    autoLogin: Boolean(autoLogin)
  };
  localStorage.setItem(SAVED_LOGIN_STORAGE_KEY, JSON.stringify(saved));
  return saved;
}

function disableSavedAutoLogin() {
  const saved = { ...state.savedLogin, autoLogin: false };
  localStorage.setItem(SAVED_LOGIN_STORAGE_KEY, JSON.stringify(saved));
  state.savedLogin = saved;
}

function activeEmployees() {
  return state.employees.filter((employee) => employee.active !== false);
}

function employeeById(employeeId) {
  return activeEmployees().find((employee) => employee.id === employeeId);
}

function isAdminEmployee(employee = state.auth.employee) {
  return Boolean(employee?.isAdmin);
}

function filteredRecords() {
  if (state.employeeFilter === "all") return state.records;
  return state.records.filter((record) => record.employeeId === state.employeeFilter);
}

function recordsForDate(dateKey) {
  return filteredRecords()
    .filter((record) => record.dateKey === dateKey)
    .sort((a, b) => a.localTime.localeCompare(b.localTime));
}

function recordsByDate() {
  return filteredRecords().reduce((acc, record) => {
    acc[record.dateKey] ||= [];
    acc[record.dateKey].push(record);
    return acc;
  }, {});
}

function monthRecords() {
  const year = state.monthCursor.getFullYear();
  const month = String(state.monthCursor.getMonth() + 1).padStart(2, "0");
  return filteredRecords().filter((record) => record.dateKey.startsWith(`${year}-${month}`));
}

function compareSchedules(a, b) {
  return (
    scheduleStartTime(a).localeCompare(scheduleStartTime(b)) ||
    String(a.title || "").localeCompare(String(b.title || ""), "ko-KR")
  );
}

function scheduleTypeMeta(type) {
  return scheduleTypes.find((item) => item.value === type) || scheduleTypes[2];
}

function normalizedScheduleColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "";
}

function scheduleColor(schedule) {
  return normalizedScheduleColor(schedule?.color) || scheduleTypeMeta(schedule?.type).color || defaultScheduleColor;
}

function scheduleStartDate(schedule) {
  return schedule?.startDateKey || schedule?.dateKey || toDateKey(new Date());
}

function scheduleEndDate(schedule) {
  return schedule?.endDateKey || schedule?.dateKey || scheduleStartDate(schedule);
}

function scheduleStartTime(schedule) {
  return schedule?.startTime || "99:99";
}

function scheduleEndTime(schedule) {
  return schedule?.endTime || schedule?.startTime || "";
}

function dateTimeLocalValue(dateKey, timeValue = "09:00") {
  return `${dateKey}T${timeValue || "09:00"}`;
}

function addHoursToDateTimeLocal(value, hours) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setHours(date.getHours() + hours);
  return `${toDateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function defaultScheduleStartValue() {
  const selected = state.selectedDate || state.today?.dateKey || toDateKey(new Date());
  const defaultTime = selected === state.today?.dateKey && state.today?.localTime ? state.today.localTime : "09:00";
  return dateTimeLocalValue(selected, defaultTime);
}

function scheduleStartValue(schedule) {
  return dateTimeLocalValue(scheduleStartDate(schedule), schedule?.startTime || "09:00");
}

function scheduleEndValue(schedule) {
  const fallbackStart = scheduleStartValue(schedule);
  if (!schedule?.endDateKey && !schedule?.endTime) return addHoursToDateTimeLocal(fallbackStart, 1);
  return dateTimeLocalValue(scheduleEndDate(schedule), schedule?.endTime || schedule?.startTime || "10:00");
}

function dateKeyInRange(dateKey, startKey, endKey) {
  return dateKey >= startKey && dateKey <= endKey;
}

function scheduleOccursOnDate(schedule, dateKey) {
  return dateKeyInRange(dateKey, scheduleStartDate(schedule), scheduleEndDate(schedule));
}

function scheduleSegmentClass(schedule, dateKey) {
  const startKey = scheduleStartDate(schedule);
  const endKey = scheduleEndDate(schedule);
  if (startKey === endKey) return "single";
  if (dateKey === startKey) return "start";
  if (dateKey === endKey) return "end";
  return "middle";
}

function filteredSchedules() {
  const schedules = state.schedules || [];
  if (!isAdminRoute() || state.employeeFilter === "all") return schedules;
  return schedules.filter((schedule) => schedule.isOfficial || schedule.employeeId === state.employeeFilter);
}

function schedulesForDate(dateKey) {
  return filteredSchedules()
    .filter((schedule) => scheduleOccursOnDate(schedule, dateKey))
    .sort(compareSchedules);
}

function schedulesByDate() {
  return filteredSchedules().reduce((acc, schedule) => {
    const startKey = scheduleStartDate(schedule);
    const endKey = scheduleEndDate(schedule);
    const start = dateFromKey(startKey);
    const end = dateFromKey(endKey);
    const dayCount = Math.min(370, Math.max(1, Math.floor((end - start) / 86400000) + 1));
    for (let index = 0; index < dayCount; index += 1) {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      const key = toDateKey(day);
      acc[key] ||= [];
      acc[key].push(schedule);
    }
    return acc;
  }, {});
}

function scheduleById(scheduleId) {
  return (state.schedules || []).find((schedule) => schedule.id === scheduleId);
}

function scheduleTimeLabel(schedule) {
  const startKey = scheduleStartDate(schedule);
  const endKey = scheduleEndDate(schedule);
  const startTime = schedule?.startTime;
  const endTime = scheduleEndTime(schedule);
  if (startKey !== endKey) {
    return `${startKey} ${startTime || ""} - ${endKey} ${endTime || ""}`.trim();
  }
  if (startTime && endTime) return `${startTime} - ${endTime}`;
  if (startTime) return startTime;
  return "시간 미정";
}

function scheduleOwnerLabel(schedule) {
  if (schedule.isOfficial) return "공식 일정";
  return schedule.employeeName || employeeById(schedule.employeeId)?.name || "개인 일정";
}

function canManageSchedule(schedule) {
  if (!state.auth.employee || !schedule) return false;
  if (isAdminEmployee() && isAdminRoute()) return true;
  return !schedule.isOfficial && schedule.employeeId === state.auth.employee.id;
}

function defaultScheduleScopeValue() {
  if (isAdminEmployee() && isAdminRoute()) {
    return state.employeeFilter !== "all" ? state.employeeFilter : "official";
  }
  return state.auth.employee?.id || "";
}

function selectedAccountOwnerId() {
  return state.accountEmployeeId || defaultAccountEmployeeId();
}

function selectedAccountOwner() {
  const ownerId = selectedAccountOwnerId();
  return state.employees.find((employee) => employee.id === ownerId) || state.auth.employee;
}

function accountLookup(type, companyName, ownerId = selectedAccountOwnerId()) {
  return (state.insuranceAccounts || []).find(
    (account) =>
      account.ownerUserId === ownerId &&
      account.companyType === type &&
      account.companyName === companyName
  );
}

function accountDisplayValue(value) {
  const text = String(value || "").trim();
  return text || "미입력";
}

function accountInputName(field, company) {
  return `${field}__${company.id}`;
}

function formatBirthDate(value) {
  if (!value) return "미입력";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-");
    return `${year}.${month}.${day}`;
  }
  return text;
}

function employeePrivateDetails(employee) {
  return {
    birthDate: formatBirthDate(employee?.birthDate),
    mobileCarrier: accountDisplayValue(employee?.mobileCarrier),
    phoneNumber: accountDisplayValue(employee?.phoneNumber)
  };
}

function currentInsuranceCompanies() {
  const query = state.accountSearch.trim().toLowerCase();
  return insuranceCompanies[state.accountTab].filter((company) =>
    company.name.toLowerCase().includes(query)
  );
}

function renderAccountValue(label, value) {
  return `
    <div class="insurance-value">
      <span>${label}</span>
      <strong class="${value ? "" : "empty"}">${escapeHtml(accountDisplayValue(value))}</strong>
    </div>
  `;
}

function renderAccountInput(label, field, company, value) {
  return `
    <label class="insurance-input-field">
      <span>${label}</span>
      <input class="input" name="${accountInputName(field, company)}" value="${escapeHtml(value || "")}" placeholder="미입력" autocomplete="off" />
    </label>
  `;
}

function renderInsuranceTableCell(field, company, value) {
  if (!state.accountEditMode) {
    return `<span class="${value ? "" : "empty"}">${escapeHtml(accountDisplayValue(value))}</span>`;
  }

  return `<input class="input insurance-table-input" name="${accountInputName(field, company)}" value="${escapeHtml(value || "")}" placeholder="미입력" autocomplete="off" />`;
}

function renderInsuranceTableRow(type, company, { fixed = false } = {}) {
  const account = accountLookup(type, company.name);
  const employeeNumber = account?.employeeNumber || "";
  const password = account?.password || "";
  const extraAuth = account?.extraAuth || "";

  return `
    <tr class="${fixed ? "ga-row" : ""}">
      <th scope="row">${escapeHtml(company.name)}</th>
      <td>${renderInsuranceTableCell("employeeNumber", company, employeeNumber)}</td>
      <td>${renderInsuranceTableCell("password", company, password)}</td>
      <td>${renderInsuranceTableCell("extraAuth", company, extraAuth)}</td>
    </tr>
  `;
}

function renderInsuranceAccountContent() {
  const companies = currentInsuranceCompanies();
  return `
    <section class="insurance-list-section">
      <div class="insurance-list-title">
        <h2>${state.accountTab === "LIFE" ? "생명보험" : "손해보험"}</h2>
        <span>${companies.length}개</span>
      </div>
      <div class="insurance-table-wrap">
        <table class="insurance-account-table">
          <thead>
            <tr>
              <th scope="col">회사명</th>
              <th scope="col">사번</th>
              <th scope="col">비밀번호</th>
              <th scope="col">기타인증</th>
            </tr>
          </thead>
          <tbody>
            ${renderInsuranceTableRow("GA", insuranceCompanies.GA[0], { fixed: true })}
            ${
              companies.length
                ? companies.map((company) => renderInsuranceTableRow(state.accountTab, company)).join("")
                : `<tr><td class="insurance-empty-row" colspan="4">검색 결과가 없습니다.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderInsuranceEmployeeSelector() {
  if (!canManageInsuranceAccounts()) return "";

  return `
    <label class="insurance-employee-select">
      <span>조회 지점원</span>
      <select class="select" data-action="account-employee">
        ${state.employees
          .map(
            (employee) =>
              `<option value="${employee.id}"${selectedAccountOwnerId() === employee.id ? " selected" : ""}>${escapeHtml(employee.name)} (${escapeHtml(employeeNoLabel(employee.employeeNo))})</option>`
          )
          .join("")}
      </select>
    </label>
  `;
}

function renderInsuranceAccountsPage() {
  const owner = selectedAccountOwner();
  const privateDetails = employeePrivateDetails(owner);
  const content = `
    <header class="insurance-page-header">
      <button class="insurance-back-btn" type="button" data-action="go-home">홈</button>
      <div class="insurance-user-summary">
        <strong>${escapeHtml(owner?.name || "지점원")}</strong>
        <span>${escapeHtml(privateDetails.birthDate)} · ${escapeHtml(privateDetails.mobileCarrier)} · ${escapeHtml(privateDetails.phoneNumber)}</span>
      </div>
      <div class="insurance-header-actions">
        <button class="insurance-search-btn" type="button" data-action="account-search-toggle" title="검색">
          <span class="search-icon-shape" aria-hidden="true"></span>
        </button>
        ${
          state.accountEditMode
            ? `<button class="insurance-edit-btn" type="button" data-action="account-cancel">취소</button>`
            : `<button class="insurance-edit-btn" type="button" data-action="account-edit">수정</button>`
        }
      </div>
    </header>
    ${
      state.insuranceAccountError
        ? `
          <div class="insurance-error-box">
            <strong>설정이 필요합니다.</strong>
            <p>${escapeHtml(state.insuranceAccountError)}</p>
          </div>
        `
        : `
          <div class="insurance-controls">
            ${renderInsuranceEmployeeSelector()}
            ${
              state.accountSearchOpen
                ? `
                  <label class="insurance-search">
                    <span>회사명 검색</span>
                    <input class="input" data-action="account-search-input" value="${escapeHtml(state.accountSearch)}" placeholder="예: 삼성" ${state.accountEditMode ? "disabled" : ""} />
                  </label>
                `
                : ""
            }
            <div class="insurance-tabs" role="tablist" aria-label="보험사 구분">
              <button type="button" class="${state.accountTab === "LIFE" ? "active" : ""}" data-action="account-tab" data-tab="LIFE">생명보험</button>
              <button type="button" class="${state.accountTab === "NONLIFE" ? "active" : ""}" data-action="account-tab" data-tab="NONLIFE">손해보험</button>
            </div>
          </div>
          <div class="insurance-account-content">
            ${renderInsuranceAccountContent()}
          </div>
          ${
            state.accountEditMode
              ? `
                <div class="insurance-save-bar">
                  <button class="btn secondary" type="button" data-action="account-cancel">취소</button>
                  <button class="btn primary" type="submit">저장</button>
                </div>
              `
              : ""
          }
        `
    }
  `;

  app.innerHTML = `
    <div class="insurance-page">
      <main class="insurance-shell">
        ${
          state.auth.employee
            ? state.accountEditMode
              ? `<form class="insurance-form" data-form="insurance-accounts">${content}</form>`
              : content
            : renderAuthPanel()
        }
      </main>
    </div>
  `;
}

function captureScheduleDraft() {
  const form = document.querySelector('[data-form="schedule"]');
  if (!form) return null;
  const data = new FormData(form);
  return {
    title: String(data.get("title") || ""),
    memo: String(data.get("memo") || ""),
    scope: String(data.get("scope") || ""),
    startDateTime: String(data.get("startDateTime") || ""),
    endDateTime: String(data.get("endDateTime") || ""),
    color: String(data.get("color") || "")
  };
}

function memoPreview(value, maxLength = 35) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function timeDisplayParts(timeValue) {
  const [hourRaw, minute = "00"] = String(timeValue || "00:00").split(":");
  const hour = Number(hourRaw);
  const period = hour < 12 ? "오전" : "오후";
  const displayHour = hour % 12 || 12;
  return { period, text: `${displayHour}:${minute}` };
}

function scheduleTimeStack(schedule) {
  const start = timeDisplayParts(schedule.startTime || "00:00");
  const end = timeDisplayParts(scheduleEndTime(schedule) || schedule.startTime || "00:00");
  return {
    start: `${start.period} ${start.text}`,
    end: start.period === end.period ? end.text : `${end.period} ${end.text}`
  };
}

function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

function localCheckinPublicState() {
  const now = new Date();
  return {
    settings: state.settings,
    employees: [],
    records: [],
    today: {
      dateKey: toDateKey(now),
      localTime: new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now)
    }
  };
}

function renderConfigError() {
  app.innerHTML = `
    <div class="loading">
      Supabase 환경변수가 없습니다. Vercel에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 등록해 주세요.
    </div>
  `;
}

function renderLoading() {
  app.innerHTML = `<div class="loading">앱을 불러오는 중입니다.</div>`;
}

async function callRpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message || "요청을 처리하지 못했습니다.");
  return data;
}

function canManageInsuranceAccounts() {
  return Boolean(state.insuranceCanManageAll || state.auth.employee?.isAdmin || state.auth.employee?.isSecretary);
}

function defaultAccountEmployeeId(employees = state.employees) {
  if (canManageInsuranceAccounts()) {
    if (state.accountEmployeeId && employees.some((employee) => employee.id === state.accountEmployeeId)) {
      return state.accountEmployeeId;
    }
    return employees[0]?.id || state.auth.employee?.id || "";
  }
  return state.auth.employee?.id || "";
}

async function loadInsuranceAccountState() {
  if (!state.auth.employee) return;

  try {
    const payload = await callRpc("get_insurance_account_state", {
      session_token_input: state.auth.token
    });
    const employees = payload.employees ?? state.employees ?? [];
    state = {
      ...state,
      employees,
      insuranceAccounts: payload.insuranceAccounts ?? [],
      insuranceCanManageAll: Boolean(payload.canManageAllAccounts),
      insuranceAccountError: ""
    };
    state.accountEmployeeId = defaultAccountEmployeeId(employees);
  } catch (error) {
    state.insuranceAccountError = `사번/비밀번호 기능 SQL을 Supabase에 먼저 적용해 주세요. ${error.message}`;
    state.insuranceAccounts = [];
    state.insuranceCanManageAll = false;
    state.accountEmployeeId = state.auth.employee?.id || "";
  }
}

async function loadState({ keepCheckIn = false } = {}) {
  let payload;
  if (isEmployeeRoute()) {
    if (state.auth.employee) {
      payload = await callRpc("get_employee_state", { session_token_input: state.auth.token });
    } else {
      try {
        payload = await callRpc("get_checkin_public_state");
      } catch {
        payload = localCheckinPublicState();
      }
    }
  } else if (isAdminRoute() && isAdminEmployee() && state.auth.token) {
    try {
      payload = await callRpc("get_admin_state", { session_token_input: state.auth.token });
    } catch (error) {
      throw new Error(`관리자 기능을 사용하려면 Supabase에 관리자 SQL을 먼저 적용해 주세요. ${error.message}`);
    }
  } else {
    try {
      payload = await callRpc("get_checkin_public_state");
    } catch {
      payload = localCheckinPublicState();
    }
  }

  const origin = window.location.origin;
  const checkInUrl = `${origin}/checkin`;
  const attendanceCode = payload.attendanceCode ?? state.attendanceCode;
  const wallQrUrl = attendanceCode ? `${origin}/checkin?qr=${encodeURIComponent(attendanceCode)}` : "";
  const qrDataUrl = wallQrUrl
    ? await QRCode.toDataURL(wallQrUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 320
      })
    : state.qrDataUrl;

  const checkInFields = keepCheckIn
    ? {
        scannerStatus: state.scannerStatus,
        scannerError: state.scannerError,
        pendingQrCode: state.pendingQrCode,
        checkInStatus: state.checkInStatus,
        checkInError: state.checkInError,
        checkInAttemptedFor: state.checkInAttemptedFor,
        lastCheckIn: state.lastCheckIn
      }
    : {
        scannerStatus: "idle",
        scannerError: "",
        pendingQrCode: "",
        checkInStatus: "idle",
        checkInError: "",
        checkInAttemptedFor: "",
        lastCheckIn: null
      };

  state = {
    ...state,
    ...payload,
    employees: payload.employees ?? [],
    records: payload.records ?? [],
    schedules: payload.schedules ?? [],
    checkInUrl,
    wallQrUrl,
    attendanceCode,
    qrDataUrl,
    ...checkInFields
  };

  if ((isAccountsRoute() || (isAdminRoute() && isAdminEmployee())) && state.auth.employee) {
    await loadInsuranceAccountState();
  }
}

async function loadAuth() {
  state.savedLogin = readSavedLogin();
  const token = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!token) {
    if (state.savedLogin.autoLogin && state.savedLogin.employeeNo && state.savedLogin.password) {
      state.auth = { status: "checking", token: "", employee: null };
      try {
        const result = await callRpc("login_employee", {
          employee_no_input: state.savedLogin.employeeNo,
          password_input: state.savedLogin.password
        });
        saveSession(result.token, result.employee, { persist: true });
        return;
      } catch {
        disableSavedAutoLogin();
      }
    }

    state.auth = { status: "anonymous", token: "", employee: null };
    return;
  }

  state.auth = { status: "checking", token, employee: null };
  try {
    const result = await callRpc("session_employee", { session_token_input: token });
    state.auth = { status: "authenticated", token, employee: result.employee };
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    state.auth = { status: "anonymous", token: "", employee: null };
  }
}

function saveSession(token, employee, { persist = false } = {}) {
  if (persist) localStorage.setItem(AUTH_STORAGE_KEY, token);
  else localStorage.removeItem(AUTH_STORAGE_KEY);
  state.auth = { status: "authenticated", token, employee };
}

function clearSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  state.auth = { status: "anonymous", token: "", employee: null };
  state.lastCheckIn = null;
  state.checkInStatus = "idle";
  state.checkInError = "";
  state.checkInAttemptedFor = "";
  state.pendingQrCode = "";
  state.scannerStatus = "idle";
  state.scannerError = "";
  state.schedules = [];
  state.insuranceAccounts = [];
  state.insuranceCanManageAll = false;
  state.insuranceAccountError = "";
  state.daySheetOpen = false;
  state.scheduleEditorMode = "";
  state.selectedScheduleId = "";
  state.calendarSearchOpen = false;
  state.calendarSearchQuery = "";
  state.accountSearch = "";
  state.accountSearchOpen = false;
  state.accountEditMode = false;
  state.accountEmployeeId = "";
}

function renderTopbar() {
  const todayLabel = state.today?.dateKey ? formatFullDate(state.today.dateKey) : "";
  const topActions = isAdminRoute()
    ? `
      <button class="btn secondary" data-action="refresh">새로고침</button>
      <button class="btn secondary" data-action="go-home">출근 화면</button>
      <button class="btn secondary" data-action="open-accounts">사번/비밀번호</button>
      <button class="btn secondary" data-action="logout">로그아웃</button>
    `
    : isCheckinRoute()
      ? ""
      : `<button class="btn secondary" data-action="refresh">새로고침</button>`;

  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">QR</div>
        <div>
          <h1>포커스앱</h1>
          <p>${escapeHtml(state.settings.branchName)} · ${escapeHtml(todayLabel)}</p>
        </div>
      </div>
      <div class="top-actions">${topActions}</div>
    </header>
  `;
}

function renderQrPanel() {
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>벽 부착 QR</h2>
        <button class="icon-btn" title="QR 새로고침" data-action="refresh">↻</button>
      </div>
      <div class="panel-body qr-box">
        <img class="qr-image" src="${state.qrDataUrl}" alt="벽에 붙일 출근 QR 코드" />
        <div class="qr-meta">
          <span>인쇄해서 붙여둘 고정 QR입니다.</span>
          <span>Vercel 배포 후 HTTPS 주소로 표시됩니다.</span>
        </div>
        <div class="url-box">
          <div class="url-text">${escapeHtml(state.checkInUrl)}</div>
          <button class="btn primary" data-action="copy-url">휴대폰 주소 복사</button>
        </div>
      </div>
    </section>
  `;
}

function renderBranchPanel() {
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>지점 설정</h2>
      </div>
      <div class="panel-body">
        <form class="form-row" data-form="settings">
          <label class="field">
            <span>지점명</span>
            <input class="input" name="branchName" value="${escapeHtml(state.settings.branchName)}" autocomplete="organization" />
          </label>
          <button class="btn primary" type="submit">저장</button>
        </form>
      </div>
    </section>
  `;
}

function renderEmployeesPanel() {
  const employees = activeEmployees();
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>등록 지점원</h2>
      </div>
      <div class="panel-body">
        <div class="employee-admin-list">
          ${
            employees.length
              ? employees
                  .map(
                    (employee) => {
                      const isSelf = employee.id === state.auth.employee?.id;
                      return `
                      <div class="employee-admin-card">
                        <div class="employee-admin-main">
                          <span class="dot" style="background:${employeeColor(employee.id)}"></span>
                          <span>
                            <span class="employee-name">
                              ${escapeHtml(employee.name)}
                              ${employee.isAdmin ? `<em class="admin-chip">관리자</em>` : ""}
                            </span>
                            <span class="employee-meta">${escapeHtml(employeeNoLabel(employee.employeeNo))}</span>
                            <span class="employee-private-meta">
                              ${escapeHtml(formatBirthDate(employee.birthDate))} · ${escapeHtml(accountDisplayValue(employee.mobileCarrier))} · ${escapeHtml(accountDisplayValue(employee.phoneNumber))}
                            </span>
                          </span>
                        </div>
                        <div class="employee-admin-actions">
                          <form class="password-reset-form" data-form="employee-password" data-employee-id="${escapeHtml(employee.id)}">
                            <input class="input" name="password" type="password" minlength="4" placeholder="새 비밀번호" autocomplete="new-password" required />
                            <button class="btn secondary" type="submit">비밀번호 변경</button>
                          </form>
                          <button class="btn danger" data-action="delete-employee" data-employee-id="${escapeHtml(employee.id)}" data-employee-name="${escapeHtml(employee.name)}" ${
                            isSelf ? "disabled" : ""
                          }>삭제</button>
                        </div>
                      </div>
                    `;
                    }
                  )
                  .join("")
              : `<div class="empty">등록된 지점원이 없습니다.</div>`
          }
        </div>
      </div>
    </section>
  `;
}

function renderStats() {
  const todayKey = state.today?.dateKey || toDateKey(new Date());
  const todayCount = state.records.filter((record) => record.dateKey === todayKey).length;
  const monthCount = monthRecords().length;
  const employeeCount = activeEmployees().length;
  return `
    <div class="stat-strip">
      <div class="stat"><b>${todayCount}</b><span>오늘 출근 기록</span></div>
      <div class="stat"><b>${monthCount}</b><span>이번 달 기록</span></div>
      <div class="stat"><b>${employeeCount}</b><span>등록 지점원</span></div>
    </div>
  `;
}

function renderCalendarToolbar() {
  const employeeView = isEmployeeRoute();
  const monthTitle = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long"
  }).format(state.monthCursor);
  const compactMonthTitle = monthTitle.replace("년 ", ". ").replace("월", ".");

  if (employeeView) {
    return `
      <div class="employee-calendar-header">
        <button class="calendar-nav-btn" title="이전 달" data-action="prev-month">‹</button>
        <button class="calendar-month-title" data-action="today" title="오늘로 이동">${escapeHtml(compactMonthTitle)}</button>
        <button class="calendar-nav-btn" title="다음 달" data-action="next-month">›</button>
      </div>
    `;
  }

  return `
    <div class="panel-header calendar-toolbar">
      <div class="toolbar-group">
        <button class="icon-btn" title="이전 달" data-action="prev-month">‹</button>
        <button class="icon-btn" title="다음 달" data-action="next-month">›</button>
        <button class="btn secondary" data-action="today">오늘</button>
      </div>
      <h2 class="month-title">${escapeHtml(monthTitle)}</h2>
      <label class="field calendar-filter">
        <span>지점원 캘린더</span>
        <select class="select" data-action="employee-filter">
          <option value="all"${state.employeeFilter === "all" ? " selected" : ""}>전체 지점원</option>
          ${activeEmployees()
            .map(
              (employee) =>
                `<option value="${employee.id}"${state.employeeFilter === employee.id ? " selected" : ""}>${escapeHtml(employee.name)} (${escapeHtml(employeeNoLabel(employee.employeeNo))})</option>`
            )
            .join("")}
        </select>
      </label>
    </div>
  `;
}

function renderCalendar() {
  const employeeView = isEmployeeRoute();
  const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];
  const year = state.monthCursor.getFullYear();
  const month = state.monthCursor.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const todayKey = state.today?.dateKey || toDateKey(new Date());
  const grouped = recordsByDate();
  const scheduleGrouped = schedulesByDate();
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });

  return `
    <section class="${employeeView ? "employee-calendar-view" : "panel calendar-panel"}">
      ${renderCalendarToolbar()}
      <div class="calendar-wrap">
        <div class="calendar">
          ${weekdayLabels
            .map((day, index) => `<div class="weekday ${index === 0 ? "holiday" : index === 6 ? "saturday" : ""}">${day}</div>`)
            .join("")}
          ${days
            .map((day) => {
              const key = toDateKey(day);
              const records = (grouped[key] || []).sort((a, b) => a.localTime.localeCompare(b.localTime));
              const schedules = (scheduleGrouped[key] || []).sort(compareSchedules);
              const visibleSchedules = schedules.slice(0, 4);
              const tone = calendarDayTone(day, key);
              const classes = [
                "day",
                day.getMonth() !== month ? "outside" : "",
                key === todayKey ? "today" : "",
                key === state.selectedDate ? "selected" : "",
                tone,
                records.length ? "checked-in" : ""
              ]
                .filter(Boolean)
                .join(" ");
              const dateNumberClasses = ["date-number", tone, key === todayKey ? "today-marker" : ""]
                .filter(Boolean)
                .join(" ");

              return `
                <button class="${classes}" data-action="select-date" data-date="${key}">
                  <div class="day-number">
                    <span class="${dateNumberClasses}">${day.getDate()}</span>
                    ${records.length ? `<img class="attendance-stamp" src="${calendarAssetsPath}/stamp-attendance.svg" alt="출근" />` : ""}
                  </div>
                  <div class="schedule-list">
                    ${
                      visibleSchedules
                        .map(
                          (schedule) => `
                            <div class="schedule-pill schedule-${escapeHtml(schedule.type || "personal")} ${schedule.isOfficial ? "official" : ""} ${scheduleSegmentClass(schedule, key)}" style="--schedule-color:${scheduleColor(schedule)}">
                              <span class="schedule-pill-title">${escapeHtml(schedule.title)}</span>
                            </div>
                          `
                        )
                        .join("")
                    }
                    ${schedules.length > visibleSchedules.length ? `<span class="more-schedules">+</span>` : ""}
                  </div>
                </button>
              `;
            })
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function renderScheduleForm() {
  const editing = state.scheduleEditorMode === "edit";
  const schedule = editing ? scheduleById(state.selectedScheduleId) : null;
  if (editing && !canManageSchedule(schedule)) return "";

  const isAdmin = isAdminEmployee() && isAdminRoute();
  const draft = state.scheduleDraftForm || {};
  const baseStartValue = schedule ? scheduleStartValue(schedule) : defaultScheduleStartValue();
  const startValue = draft.startDateTime || baseStartValue;
  const endValue = draft.endDateTime || (schedule ? scheduleEndValue(schedule) : addHoursToDateTimeLocal(startValue, 1));
  const selectedScope = draft.scope || (schedule?.isOfficial ? "official" : schedule?.employeeId || defaultScheduleScopeValue());
  const selectedColor = state.scheduleDraftColor || draft.color || scheduleColor(schedule) || defaultScheduleColor;
  const noticeOn = isAdmin && state.scheduleNoticeOn;
  const titleValue = draft.title ?? schedule?.title ?? "";
  const memoValue = draft.memo ?? schedule?.memo ?? "";

  return `
    <form class="schedule-form" data-form="schedule" data-schedule-id="${escapeHtml(schedule?.id || "")}">
      <div class="schedule-title-row">
        <span class="selected-color-dot" style="background:${selectedColor}"></span>
        <input class="input schedule-title-input" name="title" maxlength="40" placeholder="일정을 입력하세요" value="${escapeHtml(titleValue)}" required />
        ${isAdmin ? `<button class="notice-toggle ${noticeOn ? "active" : ""}" type="button" data-action="toggle-notice">${noticeOn ? "공지 on" : "공지"}</button>` : ""}
      </div>
      <input type="hidden" name="color" value="${escapeHtml(selectedColor)}" />
      <input type="hidden" name="type" value="personal" />
      <div class="color-control">
        <button class="color-tab" type="button" data-action="toggle-color-palette">색상</button>
        ${
          state.colorPaletteOpen
            ? `
              <div class="color-palette">
                ${pastelScheduleColors
                  .map(
                    (color) => `
                      <button class="palette-color ${selectedColor.toUpperCase() === color.toUpperCase() ? "selected" : ""}" type="button" data-action="select-schedule-color" data-color="${color}" style="background:${color}" title="${color}"></button>
                    `
                  )
                  .join("")}
              </div>
            `
            : ""
        }
      </div>
      ${
        isAdmin
          ? `
            ${
              noticeOn
                ? `<input type="hidden" name="scope" value="official" />`
                : `
                  <label class="field">
                    <span>대상</span>
                    <select class="select" name="scope">
                      ${activeEmployees()
                        .map(
                          (employee) =>
                            `<option value="${employee.id}"${selectedScope === employee.id ? " selected" : ""}>${escapeHtml(employee.name)} (${escapeHtml(employeeNoLabel(employee.employeeNo))})</option>`
                        )
                        .join("")}
                    </select>
                  </label>
                `
            }
          `
          : `
            <input type="hidden" name="scope" value="${escapeHtml(state.auth.employee?.id || "")}" />
          `
      }
      <div class="schedule-time-grid stacked">
        <label class="field compact-time-field">
          <input class="input schedule-datetime-input" name="startDateTime" type="datetime-local" value="${escapeHtml(startValue)}" required />
        </label>
        <div class="time-separator">~</div>
        <label class="field compact-time-field">
          <input class="input schedule-datetime-input" name="endDateTime" type="datetime-local" value="${escapeHtml(endValue)}" required />
        </label>
      </div>
      <label class="field">
        <span>메모</span>
        <textarea class="input textarea" name="memo" maxlength="300" placeholder="필요한 내용을 간단히 적어주세요.">${escapeHtml(memoValue)}</textarea>
      </label>
      <div class="sheet-actions">
        <button class="btn secondary" type="button" data-action="cancel-schedule-edit">취소</button>
        <button class="btn primary" type="submit">일정 저장</button>
      </div>
    </form>
  `;
}

function renderScheduleSummaryRow(schedule) {
  const times = scheduleTimeStack(schedule);
  const preview = memoPreview(schedule.memo);
  return `
    <button class="summary-schedule-row" type="button" data-action="select-schedule" data-schedule-id="${escapeHtml(schedule.id)}">
      <span class="summary-time">
        <strong>${escapeHtml(times.start)}</strong>
        <small>${escapeHtml(times.end)}</small>
      </span>
      <span class="summary-color-bar" style="background:${scheduleColor(schedule)}"></span>
      <span class="summary-main">
        <strong>${escapeHtml(schedule.title)}</strong>
        ${preview ? `<small>${escapeHtml(preview)}</small>` : `<small>메모 없음</small>`}
      </span>
    </button>
  `;
}

function renderScheduleDetailView(schedule) {
  if (!schedule) return "";
  return `
    <article class="schedule-detail-sheet-card" style="--schedule-color:${scheduleColor(schedule)}">
      <div class="detail-color-line"></div>
      <header class="detail-title-row">
        <div>
          <span>${escapeHtml(scheduleOwnerLabel(schedule))}</span>
          <h3>${escapeHtml(schedule.title)}</h3>
        </div>
        ${
          canManageSchedule(schedule)
            ? `
              <div class="detail-icon-actions">
                <button type="button" data-action="edit-schedule" data-schedule-id="${escapeHtml(schedule.id)}" title="수정">수정</button>
                <button type="button" data-action="delete-schedule" data-schedule-id="${escapeHtml(schedule.id)}" title="삭제">삭제</button>
              </div>
            `
            : ""
        }
      </header>
      <dl class="schedule-detail-meta">
        <div>
          <dt>시간</dt>
          <dd>${escapeHtml(scheduleTimeLabel(schedule))}</dd>
        </div>
        <div>
          <dt>메모</dt>
          <dd>${schedule.memo ? escapeHtml(schedule.memo) : "메모가 없습니다."}</dd>
        </div>
      </dl>
    </article>
  `;
}

function renderDaySheet() {
  if (!state.daySheetOpen || !state.selectedDate || !state.auth.employee) return "";

  const records = recordsForDate(state.selectedDate);
  const schedules = schedulesForDate(state.selectedDate);
  const selectedSchedule = scheduleById(state.selectedScheduleId);
  const showEditor = state.scheduleEditorMode === "create" || state.scheduleEditorMode === "edit";
  const showDetail = !showEditor && state.scheduleSheetMode === "detail" && selectedSchedule;
  const sheetTitle = showEditor
    ? state.scheduleEditorMode === "edit"
      ? "일정 수정"
      : "일정 추가"
    : showDetail
      ? formatFullDate(scheduleStartDate(selectedSchedule))
    : formatFullDate(state.selectedDate);

  return `
    <div class="sheet-backdrop" data-action="close-day-sheet"></div>
    <section class="day-sheet" role="dialog" aria-modal="true" aria-label="날짜 상세">
      <div class="sheet-handle" aria-hidden="true"></div>
      <header class="sheet-header">
        <div>
          <h2>${escapeHtml(sheetTitle)}</h2>
        </div>
        <button class="sheet-close" type="button" data-action="close-day-sheet" title="닫기">×</button>
      </header>

      ${
        showEditor
          ? renderScheduleForm()
          : showDetail
            ? renderScheduleDetailView(selectedSchedule)
          : `
            ${
              records.length
                ? `
                  <div class="attendance-compact-list">
                    ${records
                      .map(
                        (record) => `
                          <div class="attendance-compact-row">
                            <img src="${calendarAssetsPath}/stamp-attendance.svg" alt="" aria-hidden="true" />
                            <span>${isEmployeeRoute() ? "내 출근" : escapeHtml(record.employeeName)}</span>
                            <time>${escapeHtml(record.localTime)}</time>
                          </div>
                        `
                      )
                      .join("")}
                  </div>
                `
                : ""
            }
            <div class="sheet-section">
              <div class="sheet-section-title">
                <h3>일정 (${schedules.length})</h3>
                <button class="mini-btn primary" type="button" data-action="add-schedule">일정 추가</button>
              </div>
              <div class="schedule-summary-list">
                ${
                  schedules.length
                    ? schedules
                        .map((schedule) => renderScheduleSummaryRow(schedule))
                        .join("")
                    : `<div class="sheet-empty">등록된 일정이 없습니다.</div>`
                }
              </div>
            </div>
          `
      }
    </section>
  `;
}

function searchedSchedules() {
  const query = state.calendarSearchQuery.trim().toLowerCase();
  if (!query) return [];
  return filteredSchedules()
    .filter((schedule) => String(schedule.title || "").toLowerCase().includes(query))
    .sort((a, b) => scheduleStartDate(a).localeCompare(scheduleStartDate(b)) || compareSchedules(a, b));
}

function renderCalendarSearchResults() {
  const results = searchedSchedules();
  return `
    <h3>검색 결과 (${results.length})</h3>
    ${
      state.calendarSearchQuery.trim()
        ? results.length
          ? results
              .map(
                (schedule) => `
                  <button class="calendar-search-result" type="button" data-action="open-search-result" data-schedule-id="${escapeHtml(schedule.id)}">
                    <span class="search-result-date">
                      <b>${Number(scheduleStartDate(schedule).slice(8, 10))}</b>
                      <small>${escapeHtml(formatWeekdayShort(scheduleStartDate(schedule)))}</small>
                    </span>
                    <span class="search-result-main">
                      <strong>${escapeHtml(schedule.title)}</strong>
                      <small>${escapeHtml(scheduleTimeLabel(schedule))}</small>
                    </span>
                    <span class="search-result-arrow">›</span>
                  </button>
                `
              )
              .join("")
          : `<div class="sheet-empty">검색 결과가 없습니다.</div>`
        : `<div class="sheet-empty">검색어를 입력하면 일정이 표시됩니다.</div>`
    }
  `;
}

function renderCalendarSearch() {
  if (!state.calendarSearchOpen || !state.auth.employee) return "";

  return `
    <div class="calendar-search-backdrop" data-action="close-calendar-search"></div>
    <section class="calendar-search-panel" role="dialog" aria-modal="true" aria-label="일정 검색">
      <header class="calendar-search-header">
        <button class="calendar-search-close" type="button" data-action="close-calendar-search">‹</button>
        <h2>일정 검색</h2>
      </header>
      <label class="calendar-search-input-wrap">
        <img src="${calendarAssetsPath}/icon-calendar-search.svg" alt="" aria-hidden="true" />
        <input class="calendar-search-input" data-action="calendar-search-input" value="${escapeHtml(state.calendarSearchQuery)}" placeholder="일정 제목을 입력하세요" autocomplete="off" />
      </label>
      <div class="calendar-search-results">
        ${renderCalendarSearchResults()}
      </div>
    </section>
  `;
}

function renderAdminGate() {
  app.innerHTML = `
    <div class="checkin-page">
      <main class="checkin-shell">
        <section class="checkin-panel">
          <div class="checkin-hero">
            <h2>관리자 페이지</h2>
            <p>관리자 계정으로 로그인한 뒤 이용할 수 있습니다.</p>
          </div>
          <div class="status-box">
            <h3>관리자 전용 화면입니다.</h3>
            <p>출근 화면에서 관리자 계정으로 로그인하면 관리자 페이지 버튼이 표시됩니다.</p>
            <div class="scan-actions">
              <button class="btn primary" data-action="go-home">출근 화면으로 이동</button>
            </div>
          </div>
        </section>
      </main>
    </div>
  `;
}

function renderDashboard() {
  if (!isAdminEmployee()) {
    renderAdminGate();
    return;
  }

  app.innerHTML = `
    ${renderTopbar()}
    <main class="layout">
      <aside class="side-stack">
        ${renderQrPanel()}
        ${renderBranchPanel()}
        ${renderEmployeesPanel()}
      </aside>
      <section class="main-stack">
        ${renderStats()}
        ${renderCalendar()}
      </section>
    </main>
    ${renderDaySheet()}
    ${renderCalendarSearch()}
  `;
}

function renderAuthPanel() {
  const isRegister = state.authMode === "register";
  const saved = state.savedLogin;
  return `
    <div class="checkin-form">
      <div class="segmented" role="tablist" aria-label="로그인 방식">
        <button class="${!isRegister ? "active" : ""}" data-action="auth-mode" data-mode="login" type="button">
          <img class="tab-icon" src="${loginAssetsPath}/icon-login-user.svg" alt="" aria-hidden="true" />
          <span>로그인</span>
        </button>
        <button class="${isRegister ? "active" : ""}" data-action="auth-mode" data-mode="register" type="button">
          <img class="tab-icon" src="${loginAssetsPath}/icon-register-users.svg" alt="" aria-hidden="true" />
          <span>지점원 등록</span>
        </button>
      </div>
      <form class="auth-form" data-form="${isRegister ? "register" : "login"}">
        ${
          isRegister
            ? `
              <label class="field">
                <span>이름</span>
                <span class="auth-input-wrap">
                  <img class="input-icon-img" src="${loginAssetsPath}/icon-input-user.svg" alt="" aria-hidden="true" />
                  <input class="input" name="name" autocomplete="name" placeholder="이름을 입력하세요" required />
                </span>
              </label>
            `
            : ""
        }
        ${
          isRegister
            ? `
              <label class="field">
                <span>생년월일</span>
                <span class="auth-input-wrap">
                  <img class="input-icon-img" src="${loginAssetsPath}/icon-input-user.svg" alt="" aria-hidden="true" />
                  <input class="input" name="birthDate" type="date" autocomplete="bday" required />
                </span>
              </label>
              <label class="field">
                <span>통신사</span>
                <select class="select auth-select" name="mobileCarrier" required>
                  <option value="">통신사를 선택하세요</option>
                  ${mobileCarriers.map((carrier) => `<option value="${escapeHtml(carrier)}">${escapeHtml(carrier)}</option>`).join("")}
                </select>
              </label>
              <label class="field">
                <span>핸드폰번호</span>
                <span class="auth-input-wrap">
                  <img class="input-icon-img" src="${loginAssetsPath}/icon-input-user.svg" alt="" aria-hidden="true" />
                  <input class="input" name="phoneNumber" autocomplete="tel" inputmode="tel" placeholder="01012345678" required />
                </span>
              </label>
            `
            : ""
        }
        <label class="field">
          <span>사번</span>
          <span class="auth-input-wrap">
            <img class="input-icon-img" src="${loginAssetsPath}/icon-input-user.svg" alt="" aria-hidden="true" />
            <input class="input" name="employeeNo" autocomplete="username" inputmode="text" placeholder="사번을 입력하세요" value="${
              !isRegister ? escapeHtml(saved.employeeNo) : ""
            }" required />
          </span>
        </label>
        <label class="field">
          <span>비밀번호</span>
          <span class="auth-input-wrap">
            <img class="input-icon-img" src="${loginAssetsPath}/icon-lock.svg" alt="" aria-hidden="true" />
            <input class="input" name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" placeholder="비밀번호를 입력하세요" value="${
              !isRegister ? escapeHtml(saved.password) : ""
            }" required />
          </span>
        </label>
        ${
          isRegister
            ? `
              <label class="field">
                <span>비밀번호 확인</span>
                <span class="auth-input-wrap">
                  <img class="input-icon-img" src="${loginAssetsPath}/icon-lock.svg" alt="" aria-hidden="true" />
                  <input class="input" name="passwordConfirm" type="password" autocomplete="new-password" placeholder="비밀번호를 다시 입력하세요" data-password-confirm aria-describedby="password-confirm-error" required />
                </span>
                <small id="password-confirm-error" class="field-error hidden" data-password-error>비밀번호가 일치하지 않습니다.</small>
              </label>
            `
            : `
              <div class="auth-options">
                <label class="check-option">
                  <input type="checkbox" name="rememberCredentials" data-login-option="remember" ${saved.rememberCredentials ? "checked" : ""} />
                  <span class="check-box-visual" aria-hidden="true">
                    <img src="${loginAssetsPath}/icon-check.svg" alt="" />
                  </span>
                  <span>아이디/비밀번호 저장</span>
                </label>
                <label class="check-option">
                  <input type="checkbox" name="autoLogin" data-login-option="auto" ${saved.autoLogin ? "checked" : ""} />
                  <span class="check-box-visual" aria-hidden="true">
                    <img src="${loginAssetsPath}/icon-check.svg" alt="" />
                  </span>
                  <span>자동 로그인</span>
                </label>
              </div>
              <button class="forgot-password" type="button" data-action="password-help">
                <span>
                  <img src="${loginAssetsPath}/icon-help-lock.svg" alt="" aria-hidden="true" />
                  <span>비밀번호를 잊으셨나요?</span>
                </span>
                <img class="forgot-arrow" src="${loginAssetsPath}/icon-arrow-right.svg" alt="" aria-hidden="true" />
              </button>
            `
        }
        <button class="btn primary" type="submit">${isRegister ? "등록" : "로그인"}</button>
      </form>
    </div>
  `;
}

function updatePasswordConfirmState(form, { showError = false } = {}) {
  const passwordInput = form.elements.password;
  const confirmInput = form.elements.passwordConfirm;
  const error = form.querySelector("[data-password-error]");
  if (!passwordInput || !confirmInput || !error) return true;

  const mismatch = passwordInput.value !== confirmInput.value;
  const shouldShow = showError && mismatch;

  confirmInput.classList.toggle("invalid", shouldShow);
  error.classList.toggle("hidden", !shouldShow);
  confirmInput.setCustomValidity(mismatch ? "비밀번호가 일치하지 않습니다." : "");
  return !mismatch;
}

function renderHeroAccount() {
  const employee = state.auth.employee;
  if (!employee) return "";

  return `
    <div class="hero-account">
      <strong>${escapeHtml(employee.name)}</strong>
      <span>${escapeHtml(employeeNoLabel(employee.employeeNo))}</span>
    </div>
  `;
}

function renderScannerPanel() {
  const isWorking = ["starting", "active", "decoding"].includes(state.scannerStatus);
  const statusLabel =
    state.scannerStatus === "active" ? "카메라 스캔 중" : state.scannerStatus === "decoding" ? "QR 확인 중" : "QR 스캔";

  return `
    <div class="status-box scanner-card">
      ${isWorking ? `<h3 data-scan-title>${statusLabel}</h3>` : ""}
      <div id="qr-reader" class="qr-reader ${isWorking ? "" : "hidden"}"></div>
      ${state.scannerError ? `<div class="notice error-notice">${escapeHtml(state.scannerError)}</div>` : ""}
      <div class="scan-actions">
        ${
          state.scannerStatus === "active" || state.scannerStatus === "starting"
            ? `<button class="btn secondary" data-scan-button data-action="stop-scanner">스캔 중지</button>`
            : `<button class="btn primary" data-scan-button data-action="start-scanner">QR스캔 출근</button>`
        }
      </div>
    </div>
  `;
}

function renderCheckinActions() {
  if (!state.auth.employee) return "";

  return `
    <div class="checkin-bottom-actions">
      ${isAdminEmployee() ? `<button class="btn secondary wide" data-action="open-admin">관리자 페이지</button>` : ""}
      <button class="btn secondary wide" data-action="open-calendar">캘린더</button>
      <button class="btn secondary wide" data-action="open-accounts">사번/비밀번호</button>
      <button class="logout-link" data-action="logout">로그아웃</button>
    </div>
  `;
}

function renderEmployeeHome(primaryPanel) {
  return `
    <div class="employee-home">
      ${primaryPanel}
      ${renderCheckinActions()}
    </div>
  `;
}

function renderCheckinBody() {
  if (state.auth.status === "checking") {
    return `
      <div class="status-box">
        <div class="status-mark">...</div>
        <h3>계정 확인 중</h3>
        <p>자동 로그인 정보를 확인하고 있습니다.</p>
      </div>
    `;
  }

  if (!state.auth.employee) return renderAuthPanel();

  if (state.checkInStatus === "processing") {
    return renderEmployeeHome(`
      <div class="status-box">
        <div class="status-mark">...</div>
        <h3>출근 기록 중</h3>
        <p>스캔한 QR을 확인하고 있습니다.</p>
      </div>
    `);
  }

  if (state.checkInStatus === "error") {
    return renderEmployeeHome(`
      <div class="status-box error-box">
        <div class="status-mark">!</div>
        <h3>출근 기록 실패</h3>
        <p>${escapeHtml(state.checkInError)}</p>
        <div class="scan-actions">
          <button class="btn primary" data-action="start-scanner">다시 스캔</button>
        </div>
      </div>
    `);
  }

  if (state.checkInStatus === "success" && state.lastCheckIn) {
    const result = state.lastCheckIn;
    const message = result.duplicate
      ? "오늘은 이미 출근 기록이 있어 기존 시간을 보여드립니다."
      : "출근 시간이 캘린더에 기록되었습니다.";

    return renderEmployeeHome(`
      <div class="success-box">
        <div class="success-mark">✓</div>
        <h3>${escapeHtml(result.record.employeeName)}님 ${escapeHtml(result.record.localTime)}</h3>
        <p>${message}</p>
      </div>
    `);
  }

  return renderEmployeeHome(renderScannerPanel());
}

function renderCheckin() {
  app.innerHTML = `
    <div class="checkin-page">
      <main class="checkin-shell">
        <section class="checkin-panel">
          <div class="checkin-hero">
            <div class="portal-skyline" aria-hidden="true"></div>
            <div class="focus-brand">
              <img class="focus-logo" src="${loginAssetsPath}/focus-logo.svg" alt="FOCUS" />
            </div>
            <p class="hero-greeting">안녕하세요!</p>
            <h2>FOCUS 지점 업무 포털</h2>
            <p class="hero-copy">지점의 모든 업무를 한 곳에서 편리하게</p>
            ${renderHeroAccount()}
          </div>
          ${renderCheckinBody()}
        </section>
      </main>
    </div>
  `;
}

function renderEmployeeCalendarPage() {
  app.innerHTML = `
    <div class="calendar-page">
      <main class="calendar-page-shell">
        ${state.auth.employee ? renderCalendar() : renderAuthPanel()}
      </main>
      <button class="calendar-home-btn" data-action="go-home" title="홈">홈</button>
      ${state.auth.employee ? `<button class="calendar-search-fab" data-action="open-calendar-search" title="일정 검색"><img src="${calendarAssetsPath}/icon-calendar-search.svg" alt="일정 검색" /></button>` : ""}
      ${state.auth.employee ? `<button class="calendar-fab" data-action="add-schedule" title="일정 추가">+</button>` : ""}
      ${state.auth.employee ? renderDaySheet() : ""}
      ${state.auth.employee ? renderCalendarSearch() : ""}
    </div>
  `;
}

function render() {
  if (route() === "calendar") renderEmployeeCalendarPage();
  else if (route() === "accounts") renderInsuranceAccountsPage();
  else if (route() === "checkin") renderCheckin();
  else renderDashboard();
}

async function refresh({ keepCheckIn = false } = {}) {
  await loadState({ keepCheckIn });
  render();
  maybeCompleteCheckIn();
}

function cameraNeedsFallback() {
  return !window.isSecureContext || !navigator.mediaDevices?.getUserMedia;
}

async function ensureScannerModule() {
  scannerModulePromise ||= import("html5-qrcode");
  const scannerModule = await scannerModulePromise;
  Html5QrcodeClass = scannerModule.Html5Qrcode;
  Html5QrcodeFormats = scannerModule.Html5QrcodeSupportedFormats;
}

function getScannerOptions() {
  const qrFormat = Html5QrcodeFormats?.QR_CODE;
  const options = { useBarCodeDetectorIfSupported: true };
  if (qrFormat !== undefined) options.formatsToSupport = [qrFormat];
  return options;
}

function getScannerConfig() {
  return {
    fps: 15,
    disableFlip: false,
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
      const size = Math.max(220, Math.min(360, Math.floor(minEdge * 0.82)));
      return { width: size, height: size };
    }
  };
}

async function clearScannerInstance() {
  if (!activeScanner) return;
  try {
    if (activeScanner.isScanning) await activeScanner.stop();
    await activeScanner.clear();
  } catch {
    // The scanner may already be stopped by the browser.
  }
  activeScanner = null;
}

function onQrDecoded(decodedText) {
  if (scanInFlight) return;
  scanInFlight = true;
  handleScannedQr(decodedText).finally(() => {
    scanInFlight = false;
  });
}

async function startScannerWith(cameraIdOrConfig) {
  await clearScannerInstance();
  activeScanner = new Html5QrcodeClass("qr-reader", getScannerOptions());
  await activeScanner.start(cameraIdOrConfig, getScannerConfig(), onQrDecoded, () => {});
}

function markScannerActive() {
  state.scannerStatus = "active";
  const title = document.querySelector("[data-scan-title]");
  const button = document.querySelector("[data-scan-button]");
  if (title) title.textContent = "카메라 스캔 중";
  if (button) {
    button.textContent = "스캔 중지";
    button.dataset.action = "stop-scanner";
    button.classList.remove("primary");
    button.classList.add("secondary");
  }
}

async function startScanner() {
  if (!state.auth.employee) return;
  state.scannerError = "";
  state.checkInStatus = "idle";

  try {
    await ensureScannerModule();
  } catch {
    state.scannerError = "QR 스캐너를 불러오지 못했습니다.";
    renderCheckin();
    return;
  }

  if (cameraNeedsFallback()) {
    state.scannerError =
      "이 브라우저에서는 카메라 스캔이 제한됩니다. HTTPS 주소로 접속했는지 확인해 주세요.";
    renderCheckin();
    return;
  }

  state.scannerStatus = "starting";
  renderCheckin();
  await new Promise((resolve) => requestAnimationFrame(resolve));

  try {
    try {
      await startScannerWith({ facingMode: { exact: "environment" } });
    } catch {
      try {
        await startScannerWith({ facingMode: "environment" });
      } catch {
        const cameras = await Html5QrcodeClass.getCameras();
        const camera = cameras.find((item) => /back|rear|environment/i.test(item.label)) || cameras[0];
        if (!camera) throw new Error("사용 가능한 카메라를 찾지 못했습니다.");
        await startScannerWith(camera.id);
      }
    }
    markScannerActive();
  } catch {
    await clearScannerInstance();
    state.scannerStatus = "idle";
    state.scannerError =
      "카메라를 시작하지 못했습니다. 브라우저의 카메라 권한을 허용해 주세요.";
    renderCheckin();
  }
}

async function stopScanner({ rerender = true } = {}) {
  await clearScannerInstance();
  state.scannerStatus = "idle";
  if (rerender) renderCheckin();
}

async function handleScannedQr(rawText) {
  const qrCode = parseScannedQr(rawText);
  await stopScanner({ rerender: false });

  if (!qrCode) {
    state.scannerError = "QR 내용을 읽지 못했습니다.";
    renderCheckin();
    return;
  }

  state.pendingQrCode = qrCode;
  await maybeCompleteCheckIn(qrCode);
}

async function maybeCompleteCheckIn(forcedQrCode = "") {
  if (route() !== "checkin" || !state.auth.employee) return;

  const qrCode = forcedQrCode || getUrlQrCode() || state.pendingQrCode;
  if (!qrCode) return;

  const attemptKey = `${state.auth.employee.id}:${qrCode}`;
  if (state.checkInAttemptedFor === attemptKey && state.checkInStatus !== "error") return;

  state.checkInAttemptedFor = attemptKey;
  state.checkInStatus = "processing";
  state.checkInError = "";
  renderCheckin();

  try {
    const result = await callRpc("check_in", {
      session_token_input: state.auth.token,
      qr_code_input: qrCode
    });
    state.lastCheckIn = result;
    state.checkInStatus = "success";
    state.pendingQrCode = "";
    await loadState({ keepCheckIn: true });
    renderCheckin();
  } catch (error) {
    state.checkInStatus = "error";
    state.checkInError = error.message;
    renderCheckin();
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;

  try {
    if (action === "refresh") {
      await refresh({ keepCheckIn: route() === "checkin" });
      showToast("최신 기록을 불러왔습니다.");
    }

    if (action === "copy-url") {
      await navigator.clipboard.writeText(state.checkInUrl);
      showToast("휴대폰 접속 주소를 복사했습니다.");
    }

    if (action === "prev-month" || action === "next-month") {
      const direction = action === "prev-month" ? -1 : 1;
      state.monthCursor = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth() + direction, 1);
      state.daySheetOpen = false;
      state.scheduleEditorMode = "";
      state.selectedScheduleId = "";
      state.scheduleSheetMode = "summary";
      render();
    }

    if (action === "today") {
      const today = new Date();
      state.monthCursor = new Date(today.getFullYear(), today.getMonth(), 1);
      state.selectedDate = state.today?.dateKey || toDateKey(today);
      state.daySheetOpen = true;
      state.scheduleEditorMode = "";
      state.selectedScheduleId = "";
      state.scheduleSheetMode = "summary";
      render();
    }

    if (action === "select-date") {
      state.selectedDate = target.dataset.date;
      state.daySheetOpen = true;
      state.scheduleEditorMode = "";
      state.selectedScheduleId = "";
      state.scheduleSheetMode = "summary";
      render();
    }

    if (action === "close-day-sheet") {
      state.daySheetOpen = false;
      state.scheduleEditorMode = "";
      state.selectedScheduleId = "";
      state.scheduleSheetMode = "summary";
      render();
    }

    if (action === "open-calendar-search") {
      state.calendarSearchOpen = true;
      state.daySheetOpen = false;
      state.scheduleEditorMode = "";
      state.selectedScheduleId = "";
      state.scheduleSheetMode = "summary";
      render();
      window.requestAnimationFrame(() => document.querySelector(".calendar-search-input")?.focus());
    }

    if (action === "close-calendar-search") {
      state.calendarSearchOpen = false;
      state.calendarSearchQuery = "";
      render();
    }

    if (action === "open-search-result") {
      const schedule = scheduleById(target.dataset.scheduleId);
      if (!schedule) return;
      const dateKey = scheduleStartDate(schedule);
      const date = dateFromKey(dateKey);
      state.monthCursor = new Date(date.getFullYear(), date.getMonth(), 1);
      state.selectedDate = dateKey;
      state.selectedScheduleId = schedule.id;
      state.scheduleEditorMode = "";
      state.scheduleSheetMode = "detail";
      state.daySheetOpen = true;
      state.calendarSearchOpen = false;
      state.calendarSearchQuery = "";
      render();
    }

    if (action === "add-schedule") {
      state.scheduleEditorMode = "create";
      state.selectedScheduleId = "";
      state.scheduleSheetMode = "input";
      state.scheduleDraftColor = defaultScheduleColor;
      state.scheduleDraftForm = null;
      state.colorPaletteOpen = false;
      state.scheduleNoticeOn = false;
      state.daySheetOpen = true;
      render();
    }

    if (action === "select-schedule") {
      state.selectedScheduleId = target.dataset.scheduleId;
      state.scheduleEditorMode = "";
      state.scheduleSheetMode = "detail";
      state.daySheetOpen = true;
      render();
    }

    if (action === "edit-schedule") {
      const schedule = scheduleById(target.dataset.scheduleId);
      state.selectedScheduleId = target.dataset.scheduleId;
      state.scheduleEditorMode = "edit";
      state.scheduleSheetMode = "input";
      state.scheduleDraftColor = schedule ? scheduleColor(schedule) : defaultScheduleColor;
      state.scheduleDraftForm = null;
      state.colorPaletteOpen = false;
      state.scheduleNoticeOn = Boolean(schedule?.isOfficial);
      state.daySheetOpen = true;
      render();
    }

    if (action === "cancel-schedule-edit") {
      state.scheduleEditorMode = "";
      state.scheduleSheetMode = state.selectedScheduleId ? "detail" : "summary";
      state.scheduleDraftForm = null;
      state.colorPaletteOpen = false;
      render();
    }

    if (action === "toggle-color-palette") {
      state.scheduleDraftForm = captureScheduleDraft();
      state.colorPaletteOpen = !state.colorPaletteOpen;
      render();
    }

    if (action === "select-schedule-color") {
      const color = target.dataset.color || defaultScheduleColor;
      state.scheduleDraftColor = color;
      state.colorPaletteOpen = false;
      state.scheduleDraftForm = captureScheduleDraft();
      const form = target.closest("form");
      if (form) {
        const colorInput = form.querySelector('input[name="color"]');
        const colorDot = form.querySelector(".selected-color-dot");
        const palette = form.querySelector(".color-palette");
        if (colorInput) colorInput.value = color;
        if (colorDot) colorDot.style.background = color;
        if (palette) palette.remove();
      } else {
        render();
      }
    }

    if (action === "toggle-notice") {
      state.scheduleDraftForm = captureScheduleDraft();
      state.scheduleNoticeOn = !state.scheduleNoticeOn;
      render();
    }

    if (action === "delete-schedule") {
      const schedule = scheduleById(target.dataset.scheduleId);
      if (!schedule || !canManageSchedule(schedule)) return;
      if (!window.confirm(`'${schedule.title}' 일정을 삭제할까요?`)) return;
      await callRpc("delete_schedule_event", {
        session_token_input: state.auth.token,
        schedule_id_input: schedule.id
      });
      state.selectedScheduleId = "";
      state.scheduleEditorMode = "";
      state.scheduleSheetMode = "summary";
      state.scheduleDraftForm = null;
      state.daySheetOpen = true;
      await refresh({ keepCheckIn: route() === "checkin" });
      showToast("일정을 삭제했습니다.");
    }

    if (action === "auth-mode") {
      state.authMode = target.dataset.mode;
      renderCheckin();
    }

    if (action === "password-help") {
      showToast("비밀번호 변경은 관리자에게 문의해 주세요.");
    }

    if (action === "logout") {
      await stopScanner({ rerender: false });
      clearSession();
      if (route() === "calendar" || route() === "dashboard" || route() === "accounts") window.history.pushState({}, "", "/checkin");
      render();
    }

    if (action === "open-calendar") {
      window.history.pushState({}, "", "/calendar");
      await loadState({ keepCheckIn: true });
      renderEmployeeCalendarPage();
    }

    if (action === "open-accounts") {
      window.history.pushState({}, "", "/accounts");
      state.accountEditMode = false;
      state.accountSearch = "";
      await loadState({ keepCheckIn: true });
      renderInsuranceAccountsPage();
    }

    if (action === "open-admin") {
      window.history.pushState({}, "", "/dashboard");
      await loadState();
      renderDashboard();
    }

    if (action === "go-home") {
      window.history.pushState({}, "", "/checkin");
      renderCheckin();
    }

    if (action === "account-tab") {
      state.accountTab = target.dataset.tab || "LIFE";
      state.accountSearch = "";
      state.accountSearchOpen = false;
      renderInsuranceAccountsPage();
    }

    if (action === "account-search-toggle") {
      state.accountSearchOpen = !state.accountSearchOpen;
      if (!state.accountSearchOpen) state.accountSearch = "";
      renderInsuranceAccountsPage();
      if (state.accountSearchOpen) {
        window.requestAnimationFrame(() => document.querySelector('[data-action="account-search-input"]')?.focus());
      }
    }

    if (action === "account-edit") {
      state.accountEditMode = true;
      state.accountSearch = "";
      state.accountSearchOpen = false;
      renderInsuranceAccountsPage();
    }

    if (action === "account-cancel") {
      state.accountEditMode = false;
      renderInsuranceAccountsPage();
    }

    if (action === "delete-employee") {
      const employeeName = target.dataset.employeeName || "선택한 계정";
      if (!window.confirm(`${employeeName} 계정을 삭제할까요? 삭제하면 해당 지점원은 로그인할 수 없습니다.`)) return;
      await callRpc("delete_employee", {
        session_token_input: state.auth.token,
        employee_id_input: target.dataset.employeeId
      });
      await refresh();
      showToast("계정을 삭제했습니다.");
    }

    if (action === "start-scanner") await startScanner();
    if (action === "stop-scanner") await stopScanner();
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.dataset.loginOption === "auto") {
    const form = event.target.closest('form[data-form="login"]');
    if (form && event.target.checked) form.elements.rememberCredentials.checked = true;
  }

  if (event.target.dataset.loginOption === "remember") {
    const form = event.target.closest('form[data-form="login"]');
    if (form && !event.target.checked) form.elements.autoLogin.checked = false;
  }

  if (event.target.dataset.action === "employee-filter") {
    state.employeeFilter = event.target.value;
    state.daySheetOpen = false;
    state.scheduleEditorMode = "";
    state.selectedScheduleId = "";
    renderDashboard();
  }

  if (event.target.dataset.action === "account-employee") {
    state.accountEmployeeId = event.target.value;
    state.accountEditMode = false;
    state.accountSearch = "";
    state.accountSearchOpen = false;
    renderInsuranceAccountsPage();
  }

});

document.addEventListener("input", (event) => {
  if (event.target.dataset.action === "calendar-search-input") {
    state.calendarSearchQuery = event.target.value;
    const results = document.querySelector(".calendar-search-results");
    if (results) results.innerHTML = renderCalendarSearchResults();
    return;
  }

  if (event.target.dataset.action === "account-search-input") {
    state.accountSearch = event.target.value;
    const content = document.querySelector(".insurance-account-content");
    if (content) content.innerHTML = renderInsuranceAccountContent();
    return;
  }

  if (event.target.name === "startDateTime") {
    const form = event.target.closest('form[data-form="schedule"]');
    const endInput = form?.elements.endDateTime;
    if (endInput && (!endInput.value || endInput.value <= event.target.value)) {
      endInput.value = addHoursToDateTimeLocal(event.target.value, 1);
    }
  }

  const form = event.target.closest('form[data-form="register"]');
  if (!form || !["password", "passwordConfirm"].includes(event.target.name)) return;
  updatePasswordConfirmState(form, { showError: Boolean(form.elements.passwordConfirm.value) });
});

document.addEventListener("focusin", (event) => {
  const field = event.target.closest(".schedule-form input, .schedule-form textarea, .insurance-form input");
  if (!field) return;
  window.setTimeout(() => field.scrollIntoView({ block: "center", behavior: "smooth" }), 120);
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();

  if (form.dataset.form === "register" && !updatePasswordConfirmState(form, { showError: true })) {
    form.elements.passwordConfirm.focus();
    return;
  }

  if (!form.reportValidity()) return;

  const data = Object.fromEntries(new FormData(form).entries());

  try {
    if (form.dataset.form === "settings") {
      const settings = await callRpc("set_branch_name_admin", {
        session_token_input: state.auth.token,
        branch_name_input: data.branchName
      });
      state.settings = settings;
      await refresh();
      showToast("지점명을 저장했습니다.");
    }

    if (form.dataset.form === "employee-password") {
      await callRpc("set_employee_password", {
        session_token_input: state.auth.token,
        employee_id_input: form.dataset.employeeId,
        new_password_input: data.password
      });
      form.reset();
      showToast("비밀번호를 변경했습니다.");
    }

    if (form.dataset.form === "schedule") {
      if (data.endDateTime <= data.startDateTime) {
        throw new Error("종료일시는 시작일시보다 늦어야 합니다.");
      }

      const scope = data.scope || state.auth.employee?.id || "";
      const savedSchedule = await callRpc("upsert_schedule_event", {
        session_token_input: state.auth.token,
        schedule_id_input: form.dataset.scheduleId || null,
        title_input: data.title,
        start_datetime_input: data.startDateTime,
        end_datetime_input: data.endDateTime,
        memo_input: data.memo || "",
        type_input: "personal",
        color_input: data.color || defaultScheduleColor,
        is_official_input: scope === "official",
        employee_id_input: scope === "official" ? null : scope
      });
      state.scheduleEditorMode = "";
      state.selectedScheduleId = "";
      state.scheduleSheetMode = "summary";
      state.colorPaletteOpen = false;
      state.scheduleDraftColor = defaultScheduleColor;
      state.scheduleDraftForm = null;
      state.scheduleNoticeOn = false;
      state.selectedDate = savedSchedule?.startDateKey || state.selectedDate;
      state.monthCursor = new Date(
        dateFromKey(state.selectedDate).getFullYear(),
        dateFromKey(state.selectedDate).getMonth(),
        1
      );
      state.daySheetOpen = true;
      await refresh({ keepCheckIn: route() === "checkin" });
      showToast("일정이 저장되었습니다");
    }

    if (form.dataset.form === "insurance-accounts") {
      const ownerId = selectedAccountOwnerId();
      const companiesToSave = [
        { type: "GA", company: insuranceCompanies.GA[0] },
        ...insuranceCompanies[state.accountTab].map((company) => ({ type: state.accountTab, company }))
      ];
      const accounts = companiesToSave.map(({ type, company }) => ({
        companyType: type,
        companyName: company.name,
        employeeNumber: data[accountInputName("employeeNumber", company)] || "",
        password: data[accountInputName("password", company)] || "",
        extraAuth: data[accountInputName("extraAuth", company)] || ""
      }));

      await callRpc("upsert_insurance_accounts", {
        session_token_input: state.auth.token,
        owner_user_id_input: ownerId,
        accounts_input: accounts
      });
      state.accountEditMode = false;
      await loadInsuranceAccountState();
      renderInsuranceAccountsPage();
      showToast("계정 정보가 저장되었습니다");
    }

    if (form.dataset.form === "register") {
      const result = await callRpc("register_employee", {
        name_input: data.name,
        employee_no_input: data.employeeNo,
        password_input: data.password,
        birth_date_input: data.birthDate,
        mobile_carrier_input: data.mobileCarrier,
        phone_number_input: data.phoneNumber
      });
      saveSession(result.token, result.employee);
      await loadState({ keepCheckIn: true });
      render();
      await maybeCompleteCheckIn();
      showToast("지점원 등록이 완료되었습니다.");
    }

    if (form.dataset.form === "login") {
      const rememberCredentials = data.rememberCredentials === "on";
      const autoLogin = data.autoLogin === "on";
      const result = await callRpc("login_employee", {
        employee_no_input: data.employeeNo,
        password_input: data.password
      });
      state.savedLogin = writeSavedLogin({
        employeeNo: data.employeeNo,
        password: data.password,
        rememberCredentials,
        autoLogin
      });
      saveSession(result.token, result.employee, { persist: autoLogin });
      await loadState({ keepCheckIn: true });
      render();
      await maybeCompleteCheckIn();
      showToast("로그인되었습니다.");
    }

  } catch (error) {
    showToast(error.message);
  }
});

async function initialize() {
  renderLoading();
  await loadAuth();
  await loadState({ keepCheckIn: true });
  render();
  await maybeCompleteCheckIn();
}

window.addEventListener("popstate", () => {
  render();
  maybeCompleteCheckIn();
});

window.setInterval(() => {
  if (route() === "dashboard") refresh().catch(() => undefined);
}, 15000);

async function initializeSafely() {
  try {
    await initialize();
  } catch (error) {
    app.innerHTML = `<div class="loading">${escapeHtml(error.message)}</div>`;
  }
}
