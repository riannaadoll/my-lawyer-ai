// app.js — brauzerdagi mantiq: chatlar, yuborish, limitlar.
const MAX_MESSAGES = 40;              // bitta chatdagi xabarlar limiti (savol + javob)
const KEY = "advocate_chats_v1";      // localStorage kaliti
const $ = (s) => document.querySelector(s);

// Til: saqlangan bo'lsa o'sha, bo'lmasa o'zbekcha. t("kalit") — tanlangan tildagi matn (i18n.js)
const LANG_KEY = "advocate_lang";
let lang = localStorage.getItem(LANG_KEY);
if (!I18N[lang]) lang = "uz";
const t = (k) => I18N[lang][k];
const el = { chat: $("#chat"), list: $("#chatList"), msgs: $("#messages"), input: $("#input"), send: $("#send"),
             status: $("#status"), back: $("#backdrop"), search: $("#search"), pop: $("#pop"), name: $("#nameInput"),
             file: $("#fileInput"), preview: $("#preview"), previewImg: $("#previewImg") };

// Rasm yuklash: hozir biriktirilgan (hali yuborilmagan) rasm. Yuborilgach tozalanadi.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;         // brauzerdan qabul qilinadigan asl fayl chegarasi
let pendingImage = null;   // { sendMime, sendData, thumbMime, thumbData } — hammasi base64 (prefiksiz)

// Rasmni ikki o'lchamda siqadi: "send" — Geminiga yuboriladigan sifat, "thumb" — chatda ko'rsatish/saqlash uchun kichik nusxa
async function compressImage(file) {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
    const draw = (maxDim, quality) => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", quality).split(",")[1];
    };
    return { sendMime: "image/jpeg", sendData: draw(1400, 0.75), thumbMime: "image/jpeg", thumbData: draw(240, 0.5) };
  } finally {
    URL.revokeObjectURL(src);
  }
}
function showPreview() { el.previewImg.src = `data:${pendingImage.thumbMime};base64,${pendingImage.thumbData}`; el.preview.hidden = false; }
function clearPreview() { pendingImage = null; el.preview.hidden = true; el.previewImg.src = ""; }
el.file.addEventListener("change", async () => {
  const file = el.file.files[0]; el.file.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) { el.status.textContent = t("badFile"); return; }
  if (file.size > MAX_IMAGE_BYTES) { el.status.textContent = t("tooBig"); return; }
  try { pendingImage = await compressImage(file); el.status.textContent = ""; showPreview(); }
  catch { el.status.textContent = t("badFile"); }
});
$("#attachBtn").onclick = () => el.file.click();
$("#removeImage").onclick = clearPreview;

let chats = load();          // faqat kamida 1 ta xabari bor chatlar saqlanadi
let current = newDraft();    // hozir ochiq chat (bo'sh bo'lishi mumkin)
let busy = false;            // javob kutilyapti-mi

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function save() { localStorage.setItem(KEY, JSON.stringify(chats)); }
function newDraft() { return { id: Date.now().toString(36), title: "", messages: [] }; }

// Xavfsizlik: matnni HTML'ga qo'yishdan oldin belgilarni "zararsizlantiramiz" (XSS'dan himoya)
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (s) => esc(s)
  .replace(/^\s*(\*\*\*|---)\s*$/gm, "<hr>")             // *** yoki --- : ajratuvchi chiziq
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/\*(.+?)\*/g, "<i>$1</i>")                    // *qiya matn*
  .replace(/\n/g, "<br>");

// Javob tagidagi ishonchlilik belgisi (trust qiymatini server hisoblaydi)
const BADGE = { official: ["ok", "badgeOfficial"], unverified: ["warn", "badgeUnverified"], nosearch: ["warn", "badgeNosearch"] };

// ---- YANGI CHAT TUGMASI: xatoning tuzatilishi ----
// Hozirgi chat bo'sh bo'lsa, yangisini YARATMAYMIZ — faqat inputga fokus beramiz.
function newChat() {
  if (busy) return;
  if (current.messages.length > 0) current = newDraft();
  autoClose(); render(); el.input.focus();
}

// "Mening holatim": yangi chat ochiladi, bot birinchi bo'lib salomlashadi (server bu xabarni Geminiga yubormaydi)
function startCase() {
  if (busy) return;
  current = newDraft(); current.mode = "case";
  current.messages.push({ role: "assistant", text: t("caseHello") });
  autoClose(); render(); el.input.focus();
}

async function send() {
  const text = el.input.value.trim();
  const img = pendingImage;                              // yuborilayotgan rasm (bo'lsa)
  if ((!text && !img) || busy || current.messages.length >= MAX_MESSAGES) return;

  current.messages.push({ role: "user", text: text || t("imageMsg"), image: img ? { mime: img.thumbMime, data: img.thumbData } : undefined });
  if (!current.title) current.title = (current.mode === "case" ? "🧭 " : "") + (text || t("imageMsg")).slice(0, 40);
  if (!chats.includes(current)) chats.unshift(current);   // ro'yxatga birinchi xabardan keyin qo'shiladi
  el.input.value = ""; el.input.style.height = "auto"; clearPreview();
  el.status.textContent = ""; busy = true; save(); render();

  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: current.mode, lang,
        messages: current.messages.map(({ role, text }) => ({ role, text })),
        image: img ? { mime: img.sendMime, data: img.sendData } : undefined,   // faqat shu so'rov uchun, tarixga qayta yuborilmaydi
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("errGeneric"));
    current.messages.push({ role: "assistant", text: data.text, sources: data.sources || [], trust: data.trust, date: data.date });
  } catch (e) {
    el.status.textContent = e instanceof TypeError ? t("errNet") : e instanceof SyntaxError ? t("errGeneric") : (e.message || t("errGeneric"));
  }
  busy = false; save(); render();
}

function render() {
  const empty = current.messages.length === 0;
  el.chat.classList.toggle("is-empty", empty);
  if (empty) $("#hello").textContent = greet();

  // Yon paneldagi chatlar ro'yxati
  el.list.innerHTML = "";
  visibleChats().forEach((c) => {
    const li = document.createElement("li");
    li.className = c === current ? "active" : "";
    li.innerHTML = `<button class="chat-title">${esc(c.title)}</button><button class="chat-del" aria-label="O'chirish">✕</button>`;
    li.children[0].onclick = () => { if (!busy) { current = c; autoClose(); render(); } };
    li.children[1].onclick = () => {
      if (busy) return;
      chats = chats.filter((x) => x !== c);
      if (c === current) current = newDraft();
      save(); render();
    };
    el.list.append(li);
  });

  // Xabarlar
  el.msgs.innerHTML = current.messages.map((m) => {
    const src = (m.sources || []).filter((s) => /^https?:\/\//.test(s.url))
      .map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`).join("");
    const b = BADGE[m.trust];
    const badge = b ? `<div class="badge ${b[0]}">${t(b[1])}${m.date ? " · " + esc(m.date) : ""}</div>` : "";
    const img = m.image ? `<img class="msg-img" src="data:${esc(m.image.mime)};base64,${esc(m.image.data)}" alt="">` : "";
    return `<div class="msg ${m.role}">${img}${fmt(m.text)}${src ? `<div class="sources">${src}</div>` : ""}${badge}</div>`;
  }).join("") + (busy ? `<div class="msg assistant loading" role="status" aria-label="Yuklanmoqda"><span class="spinner"></span></div>` : "");
  el.msgs.scrollTop = el.msgs.scrollHeight;

  // Limitga yetganda yozishni to'xtatamiz
  const full = current.messages.length >= MAX_MESSAGES;
  el.input.disabled = full;
  el.input.placeholder = full ? t("full") : t("placeholder");
  el.send.disabled = busy || full;
}

function closeSidebar() { document.body.classList.remove("side-open"); }
function openSidebar() { document.body.classList.add("side-open"); }

$("#newChat").onclick = newChat;
$("#caseBtn").onclick = startCase;
document.querySelectorAll(".faq-q").forEach((b) => (b.onclick = () => { el.input.value = b.dataset.q; send(); }));
$("#menu").onclick = () => document.body.classList.toggle("side-open");
el.back.onclick = closeSidebar;
el.send.onclick = send;
el.input.addEventListener("keydown", (e) => {          // Enter — yuborish, Shift+Enter — yangi qator
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
el.input.addEventListener("input", () => {              // input balandligi matnga qarab o'sadi
  el.input.style.height = "auto"; el.input.style.height = el.input.scrollHeight + "px";
});

// ---- Qidiruv, profil va salomlashuv ----
const NAME_KEY = "advocate_name";
let userName = localStorage.getItem(NAME_KEY) || "";
const autoClose = () => { if (innerWidth < 768) closeSidebar(); };   // telefonda tanlagach panel yopiladi

function visibleChats() {                       // qidiruv: sarlavha va xabarlar matni bo'yicha
  const q = el.search.value.trim().toLowerCase();
  return !q ? chats : chats.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.text.toLowerCase().includes(q)));
}
function greet() {                              // soatga qarab salom
  const h = new Date().getHours();
  const hello = t("hello")[h < 5 ? 0 : h < 12 ? 1 : h < 18 ? 2 : 3];
  return `${hello}${userName ? ", " + userName : ""}`;
}
function paintProfile() {
  $("#avatar").textContent = (userName[0] || "M").toUpperCase();
  $("#profileName").textContent = userName || t("guest");
}
el.search.addEventListener("input", render);
$("#topSearch").onclick = () => { openSidebar(); el.search.focus(); };
$("#topNew").onclick = newChat;
$("#closeSide").onclick = closeSidebar;
$("#profileBtn").onclick = (e) => { e.stopPropagation(); el.pop.hidden = !el.pop.hidden; };
el.pop.onclick = (e) => e.stopPropagation();
document.addEventListener("click", () => { el.pop.hidden = true; });
el.name.value = userName;
el.name.addEventListener("input", () => {
  userName = el.name.value.trim(); localStorage.setItem(NAME_KEY, userName); paintProfile(); render();
});
$("#clearAll").onclick = () => {
  if (busy || !confirm(t("confirmClear"))) return;
  chats = []; current = newDraft(); save(); el.pop.hidden = true; render();
};
// ---- Til almashtirish: data-i18n belgili hamma matn qayta yoziladi ----
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((e) => (e.textContent = t(e.dataset.i18n)));
  document.querySelectorAll("[data-i18n-ph]").forEach((e) => (e.placeholder = t(e.dataset.i18nPh)));
  document.querySelectorAll("[data-i18n-title]").forEach((e) => { const v = t(e.dataset.i18nTitle); e.title = v; e.setAttribute("aria-label", v); });
  document.querySelectorAll(".faq-q").forEach((b) => (b.dataset.q = t(b.dataset.key)));   // bosilganda shu tildagi savol yuboriladi
  $("#langSelect").value = lang;
  paintProfile(); render();
}
$("#langSelect").onchange = (e) => { lang = e.target.value; localStorage.setItem(LANG_KEY, lang); applyLang(); };
applyLang();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");   // PWA
function fitHeight() {
  document.documentElement.style.setProperty("--app-h", (window.visualViewport?.height || innerHeight) + "px");
}
window.visualViewport?.addEventListener("resize", fitHeight);
fitHeight();
render();
