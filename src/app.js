import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";

const AUTH_STORAGE_KEY = "focusAttendanceSession";
const SAVED_LOGIN_STORAGE_KEY = "focusAttendanceSavedLogin";
const colors = ["#0f766e", "#2563eb", "#9333ea", "#d97706", "#db2777", "#16a34a", "#475569", "#dc2626"];
const scheduleColors = ["#007D74", "#2563EB", "#E11D48", "#F59E0B", "#7C3AED", "#16A34A", "#0F172A", "#EC4899"];
const loginAssetsPath = "/assets/login";
const calendarAssetsPath = "/assets/calendar";

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
  if (window.location.pathname === "/checkin") return "checkin";
  return "dashboard";
};
const isCheckinRoute = () => route() === "checkin";
const isEmployeeRoute = () => ["checkin", "calendar"].includes(route());
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
    (a.startTime || "99:99").localeCompare(b.startTime || "99:99") ||
    String(a.title || "").localeCompare(String(b.title || ""), "ko-KR")
  );
}

function normalizedScheduleColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : scheduleColors[0];
}

function filteredSchedules() {
  const schedules = state.schedules || [];
  if (!isAdminRoute() || state.employeeFilter === "all") return schedules;
  return schedules.filter((schedule) => schedule.isOfficial || schedule.employeeId === state.employeeFilter);
}

function schedulesForDate(dateKey) {
  return filteredSchedules()
    .filter((schedule) => schedule.dateKey === dateKey)
    .sort(compareSchedules);
}

function schedulesByDate() {
  return filteredSchedules().reduce((acc, schedule) => {
    acc[schedule.dateKey] ||= [];
    acc[schedule.dateKey].push(schedule);
    return acc;
  }, {});
}

function scheduleById(scheduleId) {
  return (state.schedules || []).find((schedule) => schedule.id === scheduleId);
}

function scheduleTimeLabel(schedule) {
  if (schedule.startTime && schedule.endTime) return `${schedule.startTime} - ${schedule.endTime}`;
  if (schedule.startTime) return schedule.startTime;
  return "시간 미정";
}

function scheduleOwnerLabel(schedule) {
  if (schedule.isOfficial) return "공식 일정";
  return schedule.employeeName || employeeById(schedule.employeeId)?.name || "개인 일정";
}

function canManageSchedule(schedule) {
  if (!state.auth.employee || !schedule) return false;
  if (isAdminEmployee() && isAdminRoute()) return schedule.isOfficial;
  return !schedule.isOfficial && schedule.employeeId === state.auth.employee.id;
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
  state.daySheetOpen = false;
  state.scheduleEditorMode = "";
  state.selectedScheduleId = "";
}

function renderTopbar() {
  const todayLabel = state.today?.dateKey ? formatFullDate(state.today.dateKey) : "";
  const topActions = isAdminRoute()
    ? `
      <button class="btn secondary" data-action="refresh">새로고침</button>
      <button class="btn secondary" data-action="go-home">출근 화면</button>
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
              const visibleSchedules = schedules.slice(0, employeeView ? 3 : 4);
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
                            <div class="schedule-pill ${schedule.isOfficial ? "official" : ""}" style="--schedule-color:${normalizedScheduleColor(schedule.color)}">
                              <span class="schedule-pill-title">${escapeHtml(schedule.title)}</span>
                              ${schedule.startTime ? `<time>${escapeHtml(schedule.startTime)}</time>` : ""}
                            </div>
                          `
                        )
                        .join("")
                    }
                    ${schedules.length > visibleSchedules.length ? `<div class="more">+${schedules.length - visibleSchedules.length}개 더</div>` : ""}
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
  const selectedColor = normalizedScheduleColor(schedule?.color);

  return `
    <form class="schedule-form" data-form="schedule" data-schedule-id="${escapeHtml(schedule?.id || "")}">
      <label class="field">
        <span>일정명</span>
        <input class="input" name="title" maxlength="40" placeholder="예: 지점 교육, 고객 미팅" value="${escapeHtml(schedule?.title || "")}" required />
      </label>
      <div class="schedule-time-grid">
        <label class="field">
          <span>시작</span>
          <input class="input" name="startTime" type="time" value="${escapeHtml(schedule?.startTime || "")}" />
        </label>
        <label class="field">
          <span>종료</span>
          <input class="input" name="endTime" type="time" value="${escapeHtml(schedule?.endTime || "")}" />
        </label>
      </div>
      ${
        isAdmin
          ? `
            <div class="official-schedule-note">관리자 페이지에서 추가하는 일정은 모든 지점원에게 보이는 공식 일정입니다.</div>
            <input type="hidden" name="isOfficial" value="true" />
            <input type="hidden" name="employeeId" value="" />
          `
          : `
            <input type="hidden" name="isOfficial" value="false" />
            <input type="hidden" name="employeeId" value="${escapeHtml(state.auth.employee?.id || "")}" />
          `
      }
      <fieldset class="color-picker">
        <legend>일정 색상</legend>
        <div>
          ${scheduleColors
            .map(
              (color) => `
                <label class="color-choice" title="${color}">
                  <input type="radio" name="color" value="${color}"${selectedColor.toUpperCase() === color.toUpperCase() ? " checked" : ""} />
                  <span style="background:${color}"></span>
                </label>
              `
            )
            .join("")}
        </div>
      </fieldset>
      <label class="field">
        <span>메모</span>
        <textarea class="input textarea" name="memo" maxlength="300" placeholder="필요한 내용을 간단히 적어주세요.">${escapeHtml(schedule?.memo || "")}</textarea>
      </label>
      <div class="sheet-actions">
        <button class="btn secondary" type="button" data-action="cancel-schedule-edit">취소</button>
        <button class="btn primary" type="submit">${editing ? "수정 저장" : "일정 추가"}</button>
      </div>
    </form>
  `;
}

function renderDaySheet() {
  if (!state.daySheetOpen || !state.selectedDate || !state.auth.employee) return "";

  const records = recordsForDate(state.selectedDate);
  const schedules = schedulesForDate(state.selectedDate);
  const selectedSchedule = scheduleById(state.selectedScheduleId);
  const showEditor = state.scheduleEditorMode === "create" || state.scheduleEditorMode === "edit";

  return `
    <div class="sheet-backdrop" data-action="close-day-sheet"></div>
    <section class="day-sheet" role="dialog" aria-modal="true" aria-label="날짜 상세">
      <div class="sheet-handle" aria-hidden="true"></div>
      <header class="sheet-header">
        <div>
          <span>선택한 날짜</span>
          <h2>${escapeHtml(formatFullDate(state.selectedDate))}</h2>
        </div>
        <button class="sheet-close" type="button" data-action="close-day-sheet" title="닫기">×</button>
      </header>

      <div class="sheet-section">
        <div class="sheet-section-title">
          <h3>출근 확인</h3>
          <span>${records.length ? `${records.length}건` : "기록 없음"}</span>
        </div>
        <div class="attendance-summary-list">
          ${
            records.length
              ? records
                  .map(
                    (record) => `
                      <div class="attendance-summary-row">
                        <img src="${calendarAssetsPath}/stamp-attendance.svg" alt="" aria-hidden="true" />
                        <span>${isEmployeeRoute() ? "내 출근" : escapeHtml(record.employeeName)}</span>
                        <time>${escapeHtml(record.localTime)}</time>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="sheet-empty">선택한 날짜의 출근 기록이 없습니다.</div>`
          }
        </div>
      </div>

      <div class="sheet-section">
        <div class="sheet-section-title">
          <h3>일정</h3>
          <button class="mini-btn primary" type="button" data-action="add-schedule">일정 추가</button>
        </div>
        <div class="schedule-detail-list">
          ${
            schedules.length
              ? schedules
                  .map((schedule) => {
                    const color = normalizedScheduleColor(schedule.color);
                    const selected = schedule.id === state.selectedScheduleId;
                    return `
                      <div class="schedule-detail-row ${selected ? "selected" : ""}">
                        <button class="schedule-row-main" type="button" data-action="select-schedule" data-schedule-id="${escapeHtml(schedule.id)}">
                          <span class="schedule-color-dot" style="background:${color}"></span>
                          <span>
                            <strong>${escapeHtml(schedule.title)}</strong>
                            <small>${escapeHtml(scheduleOwnerLabel(schedule))} · ${escapeHtml(scheduleTimeLabel(schedule))}</small>
                          </span>
                        </button>
                        ${
                          canManageSchedule(schedule)
                            ? `
                              <div class="schedule-row-actions">
                                <button type="button" data-action="edit-schedule" data-schedule-id="${escapeHtml(schedule.id)}">수정</button>
                                <button type="button" data-action="delete-schedule" data-schedule-id="${escapeHtml(schedule.id)}">삭제</button>
                              </div>
                            `
                            : ""
                        }
                      </div>
                    `;
                  })
                  .join("")
              : `<div class="sheet-empty">등록된 일정이 없습니다.</div>`
          }
        </div>
      </div>

      ${
        selectedSchedule && !showEditor
          ? `
            <article class="schedule-preview-card" style="--schedule-color:${normalizedScheduleColor(selectedSchedule.color)}">
              <span>${escapeHtml(scheduleOwnerLabel(selectedSchedule))}</span>
              <h3>${escapeHtml(selectedSchedule.title)}</h3>
              <p>${escapeHtml(scheduleTimeLabel(selectedSchedule))}</p>
              <p>${selectedSchedule.memo ? escapeHtml(selectedSchedule.memo) : "메모가 없습니다."}</p>
            </article>
          `
          : ""
      }

      ${showEditor ? renderScheduleForm() : ""}
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
      <button class="btn secondary wide" data-action="open-calendar">캘린더 보기</button>
      <button class="btn secondary wide" data-action="logout">로그아웃</button>
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
      <button class="floating-home-btn" data-action="go-home" title="홈">홈</button>
      ${state.auth.employee ? renderDaySheet() : ""}
    </div>
  `;
}

function render() {
  if (route() === "calendar") renderEmployeeCalendarPage();
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
      render();
    }

    if (action === "today") {
      const today = new Date();
      state.monthCursor = new Date(today.getFullYear(), today.getMonth(), 1);
      state.selectedDate = state.today?.dateKey || toDateKey(today);
      state.daySheetOpen = true;
      state.scheduleEditorMode = "";
      state.selectedScheduleId = "";
      render();
    }

    if (action === "select-date") {
      state.selectedDate = target.dataset.date;
      state.daySheetOpen = true;
      state.scheduleEditorMode = "";
      state.selectedScheduleId = "";
      render();
    }

    if (action === "close-day-sheet") {
      state.daySheetOpen = false;
      state.scheduleEditorMode = "";
      state.selectedScheduleId = "";
      render();
    }

    if (action === "add-schedule") {
      state.scheduleEditorMode = "create";
      state.selectedScheduleId = "";
      state.daySheetOpen = true;
      render();
    }

    if (action === "select-schedule") {
      state.selectedScheduleId = target.dataset.scheduleId;
      state.scheduleEditorMode = "";
      state.daySheetOpen = true;
      render();
    }

    if (action === "edit-schedule") {
      state.selectedScheduleId = target.dataset.scheduleId;
      state.scheduleEditorMode = "edit";
      state.daySheetOpen = true;
      render();
    }

    if (action === "cancel-schedule-edit") {
      state.scheduleEditorMode = "";
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
      if (route() === "calendar" || route() === "dashboard") window.history.pushState({}, "", "/checkin");
      render();
    }

    if (action === "open-calendar") {
      window.history.pushState({}, "", "/calendar");
      await loadState({ keepCheckIn: true });
      renderEmployeeCalendarPage();
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

});

document.addEventListener("input", (event) => {
  const form = event.target.closest('form[data-form="register"]');
  if (!form || !["password", "passwordConfirm"].includes(event.target.name)) return;
  updatePasswordConfirmState(form, { showError: Boolean(form.elements.passwordConfirm.value) });
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
      await callRpc("upsert_schedule_event", {
        session_token_input: state.auth.token,
        schedule_id_input: form.dataset.scheduleId || null,
        title_input: data.title,
        date_key_input: state.selectedDate || state.today?.dateKey || toDateKey(new Date()),
        start_time_input: data.startTime || "",
        end_time_input: data.endTime || "",
        memo_input: data.memo || "",
        color_input: data.color || scheduleColors[0],
        is_official_input: String(data.isOfficial) === "true",
        employee_id_input: data.employeeId || state.auth.employee?.id || null
      });
      state.scheduleEditorMode = "";
      state.selectedScheduleId = "";
      state.daySheetOpen = true;
      await refresh({ keepCheckIn: route() === "checkin" });
      showToast("일정을 저장했습니다.");
    }

    if (form.dataset.form === "register") {
      const result = await callRpc("register_employee", {
        name_input: data.name,
        employee_no_input: data.employeeNo,
        password_input: data.password
      });
      saveSession(result.token, result.employee);
      await loadState({ keepCheckIn: true });
      renderCheckin();
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
      renderCheckin();
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
