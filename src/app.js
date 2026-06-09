import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";

const AUTH_STORAGE_KEY = "focusAttendanceSession";
const SAVED_LOGIN_STORAGE_KEY = "focusAttendanceSavedLogin";
const colors = ["#0f766e", "#2563eb", "#9333ea", "#d97706", "#db2777", "#16a34a", "#475569", "#dc2626"];

let app = null;
let supabase = null;
let activeScanner = null;
let scanInFlight = false;
let scannerModulePromise = null;
let Html5QrcodeClass = null;
let Html5QrcodeFormats = null;
let deferredInstallPrompt = null;

let state = {
  settings: { branchName: "FOCUS 지점", timezone: "Asia/Seoul" },
  employees: [],
  records: [],
  today: null,
  checkInUrl: "",
  wallQrUrl: "",
  attendanceCode: "",
  qrDataUrl: "",
  selectedDate: toDateKey(new Date()),
  monthCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  employeeFilter: "all",
  authMode: "login",
  auth: { status: "checking", token: "", employee: null },
  savedLogin: { employeeNo: "", password: "", rememberCredentials: false, autoLogin: false },
  canInstallApp: false,
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
  registerServiceWorker();
  initializeSafely();
  return () => stopScanner({ rerender: false });
}

const route = () => (window.location.pathname === "/checkin" ? "checkin" : "dashboard");
const isCheckinRoute = () => route() === "checkin";

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

function isStandaloneApp() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/service-worker.js").catch(() => undefined);
}

function activeEmployees() {
  return state.employees.filter((employee) => employee.active !== false);
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
  if (isCheckinRoute()) {
    if (state.auth.employee) {
      payload = await callRpc("get_employee_state", { session_token_input: state.auth.token });
    } else {
      try {
        payload = await callRpc("get_checkin_public_state");
      } catch {
        payload = localCheckinPublicState();
      }
    }
  } else {
    payload = await callRpc("get_public_state");
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
}

function renderTopbar() {
  const todayLabel = state.today?.dateKey ? formatFullDate(state.today.dateKey) : "";
  const checkinActions =
    isCheckinRoute()
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
      <div class="top-actions">${checkinActions}</div>
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
        <h2>지점원</h2>
      </div>
      <div class="panel-body">
        <div class="employee-list no-top">
          ${
            employees.length
              ? employees
                  .map(
                    (employee) => `
                      <div class="employee-row">
                        <span class="dot" style="background:${employeeColor(employee.id)}"></span>
                        <span>
                          <span class="employee-name">${escapeHtml(employee.name)}</span>
                          <span class="employee-meta">${escapeHtml(employeeNoLabel(employee.employeeNo))}</span>
                        </span>
                        <span></span>
                      </div>
                    `
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
  const employeeView = isCheckinRoute();
  const monthTitle = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long"
  }).format(state.monthCursor);

  return `
    <div class="panel-header calendar-toolbar">
      <div class="toolbar-group">
        <button class="icon-btn" title="이전 달" data-action="prev-month">‹</button>
        <button class="icon-btn" title="다음 달" data-action="next-month">›</button>
        <button class="btn secondary" data-action="today">오늘</button>
      </div>
      <h2 class="month-title">${employeeView ? "내 출근 캘린더" : escapeHtml(monthTitle)}</h2>
      ${
        employeeView
          ? `<span class="meta-line">${escapeHtml(monthTitle)}</span>`
          : `
            <label class="field">
              <span>지점원 필터</span>
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
          `
      }
    </div>
  `;
}

function renderCalendar() {
  const employeeView = isCheckinRoute();
  const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];
  const year = state.monthCursor.getFullYear();
  const month = state.monthCursor.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const todayKey = state.today?.dateKey || toDateKey(new Date());
  const grouped = recordsByDate();
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });

  return `
    <section class="panel">
      ${renderCalendarToolbar()}
      <div class="calendar-wrap">
        <div class="calendar">
          ${weekdayLabels.map((day) => `<div class="weekday">${day}</div>`).join("")}
          ${days
            .map((day) => {
              const key = toDateKey(day);
              const records = (grouped[key] || []).sort((a, b) => a.localTime.localeCompare(b.localTime));
              const visible = records.slice(0, 3);
              const classes = [
                "day",
                day.getMonth() !== month ? "outside" : "",
                key === todayKey ? "today" : "",
                key === state.selectedDate ? "selected" : "",
                employeeView && records.length ? "checked-in" : ""
              ]
                .filter(Boolean)
                .join(" ");

              return `
                <button class="${classes}" data-action="select-date" data-date="${key}">
                  <div class="day-number">
                    <span>${day.getDate()}</span>
                    ${records.length && !employeeView ? `<span class="count-pill">${records.length}</span>` : ""}
                  </div>
                  <div class="record-list">
                    ${
                      employeeView
                        ? records
                            .slice(0, 1)
                            .map((record) => `<div class="own-checkin">출근 ${escapeHtml(record.localTime)}</div>`)
                            .join("")
                        : visible
                            .map(
                              (record) => `
                                <div class="record-pill">
                                  <span class="dot" style="background:${employeeColor(record.employeeId)}"></span>
                                  <span>${escapeHtml(record.employeeName)}</span>
                                  <time>${escapeHtml(record.localTime)}</time>
                                </div>
                              `
                            )
                            .join("")
                    }
                    ${!employeeView && records.length > visible.length ? `<div class="more">+${records.length - visible.length}명 더</div>` : ""}
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

function renderDetails() {
  const records = recordsForDate(state.selectedDate);
  const employeeView = isCheckinRoute();
  return `
    <section class="panel">
      <div class="panel-header">
        <h3>${escapeHtml(formatKoreanDate(state.selectedDate))}</h3>
        <span class="meta-line">${employeeView ? (records.length ? "출근 완료" : "기록 없음") : `${records.length}명 출근`}</span>
      </div>
      <div class="panel-body">
        <div class="details-list">
          ${
            records.length
              ? records
                  .map(
                    (record) => `
                      <div class="detail-row">
                        <span class="dot" style="background:${employeeColor(record.employeeId)}"></span>
                        <span>
                          <span class="employee-name">${employeeView ? "내 출근" : escapeHtml(record.employeeName)}</span>
                          <span class="employee-meta">${employeeView ? escapeHtml(record.dateKey) : escapeHtml(employeeNoLabel(record.employeeNo))}</span>
                        </span>
                        <time class="time-text">${escapeHtml(record.localTime)}</time>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="empty">${employeeView ? "선택한 날짜에는 출근 기록이 없습니다." : "선택한 날짜에는 아직 출근 기록이 없습니다."}</div>`
          }
        </div>
      </div>
    </section>
  `;
}

function renderDashboard() {
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
        ${renderDetails()}
      </section>
    </main>
  `;
}

function renderAuthPanel() {
  const isRegister = state.authMode === "register";
  const saved = state.savedLogin;
  return `
    <div class="checkin-form">
      <div class="segmented" role="tablist" aria-label="로그인 방식">
        <button class="${!isRegister ? "active" : ""}" data-action="auth-mode" data-mode="login" type="button">로그인</button>
        <button class="${isRegister ? "active" : ""}" data-action="auth-mode" data-mode="register" type="button">지점원 등록</button>
      </div>
      <form class="auth-form" data-form="${isRegister ? "register" : "login"}">
        ${
          isRegister
            ? `
              <label class="field">
                <span>이름</span>
                <input class="input" name="name" autocomplete="name" required />
              </label>
            `
            : ""
        }
        <label class="field">
          <span>사번</span>
          <input class="input" name="employeeNo" autocomplete="username" inputmode="text" value="${
            !isRegister ? escapeHtml(saved.employeeNo) : ""
          }" required />
        </label>
        <label class="field">
          <span>비밀번호</span>
          <input class="input" name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" value="${
            !isRegister ? escapeHtml(saved.password) : ""
          }" required />
        </label>
        ${
          isRegister
            ? `
              <label class="field">
                <span>비밀번호 확인</span>
                <input class="input" name="passwordConfirm" type="password" autocomplete="new-password" data-password-confirm aria-describedby="password-confirm-error" required />
                <small id="password-confirm-error" class="field-error hidden" data-password-error>비밀번호가 일치하지 않습니다.</small>
              </label>
            `
            : `
              <div class="auth-options">
                <label class="check-option">
                  <input type="checkbox" name="rememberCredentials" data-login-option="remember" ${saved.rememberCredentials ? "checked" : ""} />
                  <span>아이디/비밀번호 저장</span>
                </label>
                <label class="check-option">
                  <input type="checkbox" name="autoLogin" data-login-option="auto" ${saved.autoLogin ? "checked" : ""} />
                  <span>자동 로그인</span>
                </label>
              </div>
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

function renderAccountLine() {
  const employee = state.auth.employee;
  if (!employee) return "";

  return `
    <div class="account-row">
      <span class="dot" style="background:${employeeColor(employee.id)}"></span>
      <span>
        <strong>${escapeHtml(employee.name)}</strong>
        <small>${escapeHtml(employeeNoLabel(employee.employeeNo))}</small>
      </span>
    </div>
  `;
}

function renderScannerPanel() {
  const isWorking = ["starting", "active", "decoding"].includes(state.scannerStatus);
  const statusLabel =
    state.scannerStatus === "active" ? "카메라 스캔 중" : state.scannerStatus === "decoding" ? "QR 확인 중" : "QR 스캔";

  return `
    <div class="status-box">
      <div class="status-mark">QR</div>
      <h3 data-scan-title>${statusLabel}</h3>
      ${renderAccountLine()}
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

function renderEmployeeCalendar() {
  return `
    <div class="employee-calendar-stack">
      ${renderCalendar()}
      ${renderDetails()}
    </div>
  `;
}

function renderCheckinActions() {
  if (!state.auth.employee) return "";

  return `
    <div class="checkin-bottom-actions">
      ${
        state.canInstallApp && !isStandaloneApp()
          ? `<button class="btn secondary wide" data-action="install-app">바로가기만들기</button>`
          : ""
      }
      <button class="btn secondary wide" data-action="logout">로그아웃</button>
    </div>
  `;
}

function renderEmployeeHome(primaryPanel) {
  return `
    <div class="employee-home">
      ${primaryPanel}
      ${renderEmployeeCalendar()}
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
        ${renderAccountLine()}
      </div>
    `);
  }

  if (state.checkInStatus === "error") {
    return renderEmployeeHome(`
      <div class="status-box error-box">
        <div class="status-mark">!</div>
        <h3>출근 기록 실패</h3>
        <p>${escapeHtml(state.checkInError)}</p>
        ${renderAccountLine()}
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
        ${renderAccountLine()}
      </div>
    `);
  }

  return renderEmployeeHome(renderScannerPanel());
}

function renderCheckin() {
  const currentDate = state.today?.dateKey ? formatFullDate(state.today.dateKey) : "";
  app.innerHTML = `
    <div class="checkin-page">
      ${renderTopbar()}
      <main class="checkin-shell">
        <section class="checkin-panel">
          <div class="checkin-hero">
            <h2>포커스앱 출근</h2>
            <p>${escapeHtml(state.settings.branchName)} · ${escapeHtml(currentDate)}</p>
          </div>
          ${renderCheckinBody()}
        </section>
      </main>
    </div>
  `;
}

function render() {
  if (route() === "checkin") renderCheckin();
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

async function installAppShortcut() {
  if (!deferredInstallPrompt) {
    showToast("이 브라우저에서는 바로가기 설치 버튼을 사용할 수 없습니다.");
    return;
  }

  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  state.canInstallApp = false;
  promptEvent.prompt();
  await promptEvent.userChoice.catch(() => undefined);
  if (isCheckinRoute()) renderCheckin();
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
      renderDashboard();
    }

    if (action === "today") {
      const today = new Date();
      state.monthCursor = new Date(today.getFullYear(), today.getMonth(), 1);
      state.selectedDate = state.today?.dateKey || toDateKey(today);
      renderDashboard();
    }

    if (action === "select-date") {
      state.selectedDate = target.dataset.date;
      renderDashboard();
    }

    if (action === "auth-mode") {
      state.authMode = target.dataset.mode;
      renderCheckin();
    }

    if (action === "logout") {
      await stopScanner({ rerender: false });
      clearSession();
      render();
    }

    if (action === "install-app") await installAppShortcut();
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
    renderDashboard();
  }

});

document.addEventListener("input", (event) => {
  const form = event.target.closest('form[data-form="register"]');
  if (!form || !["password", "passwordConfirm"].includes(event.target.name)) return;
  updatePasswordConfirmState(form, { showError: Boolean(form.elements.passwordConfirm.value) });
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  state.canInstallApp = true;
  if (app && isCheckinRoute() && state.auth.employee) renderCheckin();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  state.canInstallApp = false;
  if (app && isCheckinRoute()) renderCheckin();
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
      const settings = await callRpc("set_branch_name", { branch_name_input: data.branchName });
      state.settings = settings;
      await refresh();
      showToast("지점명을 저장했습니다.");
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
