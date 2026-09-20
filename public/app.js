// app.js — brauzerdagi mantiq: chatlar, yuborish, limitlar.
const MAX_MESSAGES = 40;              // bitta chatdagi xabarlar limiti (savol + javob)
const KEY = "advocate_chats_v1";      // localStorage kaliti
const $ = (s) => document.querySelector(s);
const el = { chat: $("#chat"), list: $("#chatList"), msgs: $("#messages"), input: $("#input"), send: $("#send"),
             status: $("#status"), back: $("#backdrop"), search: $("#search"), pop: $("#pop"), name: $("#nameInput") };

let chats = load();          // faqat kamida 1 ta xabari bor chatlar saqlanadi
let current = newDraft();    // hozir ochiq chat (bo'sh bo'lishi mumkin)
let busy = false;            // javob kutilyapti-mi

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function save() { localStorage.setItem(KEY, JSON.stringify(chats)); }
function newDraft() { return { id: Date.now().toString(36), title: "", messages: [] }; }

// Xavfsizlik: matnni HTML'ga qo'yishdan oldin belgilarni "zararsizlantiramiz" (XSS'dan himoya)
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");

// Javob tagidagi ishonchlilik belgisi (trust qiymatini server hisoblaydi)
const BADGE = {
  official:   ["ok",   "✅ Rasmiy manba topildi"],
  unverified: ["warn", "⚠️ Rasmiy manba topilmadi. Lex.uz dan tekshiring"],
  nosearch:   ["warn", "⚠️ Jonli qidiruvsiz javob. Lex.uz dan tekshiring"],
};

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
  current.messages.push({ role: "assistant", text: "Vaziyatingizni qisqa yozing. Men bir nechta aniqlashtiruvchi savol beraman, keyin sizga yo'l xaritasini tayyorlayman." });
  autoClose(); render(); el.input.focus();
}

async function send() {
  const text = el.input.value.trim();
  if (!text || busy || current.messages.length >= MAX_MESSAGES) return;

  current.messages.push({ role: "user", text });
  if (!current.title) current.title = (current.mode === "case" ? "🧭 " : "") + text.slice(0, 40);
  if (!chats.includes(current)) chats.unshift(current);   // ro'yxatga birinchi xabardan keyin qo'shiladi
  el.input.value = ""; el.input.style.height = "auto";
  el.status.textContent = ""; busy = true; save(); render();

  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: current.mode, messages: current.messages.map(({ role, text }) => ({ role, text })) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Xatolik yuz berdi.");
    current.messages.push({ role: "assistant", text: data.text, sources: data.sources || [], trust: data.trust, date: data.date });
  } catch (e) {
    el.status.textContent = e.message || "Ulanishda xatolik.";
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
    const badge = b ? `<div class="badge ${b[0]}">${b[1]}${m.date ? " · " + esc(m.date) : ""}</div>` : "";
    return `<div class="msg ${m.role}">${fmt(m.text)}${src ? `<div class="sources">${src}</div>` : ""}${badge}</div>`;
  }).join("") + (busy ? `<div class="msg assistant loading" role="status" aria-label="Yuklanmoqda"><span class="spinner"></span></div>` : "");
  el.msgs.scrollTop = el.msgs.scrollHeight;

  // Limitga yetganda yozishni to'xtatamiz
  const full = current.messages.length >= MAX_MESSAGES;
  el.input.disabled = full;
  el.input.placeholder = full ? "Chat to'ldi. Yangi chat oching." : "Savolingizni yozing…";
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
  const hello = h < 5 ? "Xayrli tun" : h < 12 ? "Xayrli tong" : h < 18 ? "Xayrli kun" : "Xayrli kech";
  return `${hello}${userName ? ", " + userName : ""}`;
}
function paintProfile() {
  $("#avatar").textContent = (userName[0] || "M").toUpperCase();
  $("#profileName").textContent = userName || "Mehmon";
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
  if (busy || !confirm("Barcha chatlar o'chirilsinmi?")) return;
  chats = []; current = newDraft(); save(); el.pop.hidden = true; render();
};
paintProfile();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");   // PWA
function fitHeight() {
  document.documentElement.style.setProperty("--app-h", (window.visualViewport?.height || innerHeight) + "px");
}
window.visualViewport?.addEventListener("resize", fitHeight);
fitHeight();
render();
