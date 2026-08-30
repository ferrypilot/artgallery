// 관리자 계정 만들기 (일회성)
//
//   node scripts/make-admin.mjs <이메일> <비밀번호>
//
// 관리자 지정(profiles.is_admin)은 화면에서 할 수 없게 막아둔 값입니다.
// 학생이 스스로 관리자가 되는 길을 없애려고 그렇게 뒀습니다. 그래서
// service_role 키를 쥔 이 스크립트나 대시보드 SQL 로만 켤 수 있습니다.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("사용법: node scripts/make-admin.mjs <이메일> <비밀번호>");
  process.exit(1);
}

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8")
                    .split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

// 이미 있으면 비밀번호만 다시 맞춥니다. 두 번 돌려도 안전하도록.
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
const found = list?.users?.find(u => (u.email ?? "").toLowerCase() === email.toLowerCase());

let id;
if (found) {
  id = found.id;
  const { error } = await admin.auth.admin.updateUserById(id, {
    password, email_confirm: true,
  });
  if (error) { console.error("비밀번호를 바꾸지 못했습니다:", error.message); process.exit(1); }
  console.log(`이미 있는 계정입니다 — 비밀번호를 다시 맞췄습니다: ${email}`);
} else {
  // email_confirm: 확인을 마친 상태로 만들어 확인 메일 없이 바로 로그인됩니다.
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) { console.error("만들지 못했습니다:", error.message); process.exit(1); }
  id = data.user.id;
  console.log(`계정을 만들었습니다: ${email}`);
}

const { error: pErr } = await admin
  .from("profiles")
  .update({ is_admin: true, approved: true, email })
  .eq("id", id);
if (pErr) { console.error("관리자 지정에 실패했습니다:", pErr.message); process.exit(1); }

const { data: check } = await admin
  .from("profiles").select("email, is_admin, approved").eq("id", id).single();
console.log("확인:", JSON.stringify(check));
