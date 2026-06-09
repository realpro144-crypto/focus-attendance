import fs from "node:fs";

const requiredEnvKeys = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
const minimumNodeMajor = 20;
const checks = [];

function addCheck(name, ok, detail = "", { showDetailWhenOk = false } = {}) {
  checks.push({ name, ok, detail, showDetailWhenOk });
}

function readEnvFile() {
  if (!fs.existsSync(".env")) return {};

  return Object.fromEntries(
    fs
      .readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
addCheck("Node.js 20 이상", nodeMajor >= minimumNodeMajor, `현재 ${process.versions.node}`, { showDetailWhenOk: true });
addCheck("package-lock.json 있음", fs.existsSync("package-lock.json"));
addCheck(".env.example 있음", fs.existsSync(".env.example"));

const env = readEnvFile();
addCheck(".env 있음", fs.existsSync(".env"), ".env.example을 복사해서 만들면 됩니다.");
for (const key of requiredEnvKeys) {
  const value = env[key] || process.env[key];
  addCheck(`${key} 설정`, Boolean(value), "Supabase Project URL/API Key 값이 필요합니다.");
}

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  const mark = check.ok ? "OK" : "필요";
  const detail = check.detail && (!check.ok || check.showDetailWhenOk) ? ` - ${check.detail}` : "";
  console.log(`[${mark}] ${check.name}${detail}`);
}

if (failed.length) {
  console.log("");
  console.log("위 항목을 먼저 맞춘 뒤 다시 npm run check를 실행해 주세요.");
  process.exit(1);
}

console.log("");
console.log("개발 환경 기본 점검이 완료되었습니다.");
