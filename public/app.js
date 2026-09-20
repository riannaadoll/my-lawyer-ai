// app.js — brauzerdagi mantiq: chatlar, yuborish, limitlar.
const MAX_MESSAGES = 40;              // bitta chatdagi xabarlar limiti (savol + javob)
const KEY = "advocate_chats_v1";      // localStorage kaliti
const $ = (s) => document.querySelector(s);
const el = { chat: $("#chat"), list: $("#chatList"), msgs: $("#messages"), input: $("#input"),
             send: $("#send"), status: $("#status"), side: $("#sidebar"), back: $("#backdrop") };

let chats = load();          // faqat kamida 1 ta xabari bor chatlar saqlanadi
let current = newDraft();    // hozir ochiq chat (bo'sh bo'lishi mumkin)
let busy = false;            // javob kutilyapti-mi

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function save() { localStorage.setItem(KEY, JSON.stringify(chats)); }
function newDraft() { return { id: Date.now().toString(36), title: "", messages: [] }; }

// Xavfsizlik: matnni HTML'ga qo'yishdan oldin belgilarni "zararsizlantiramiz" (XSS'dan himoya)
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");

// ---- YANGI CHAT TUGMASI: xatoning tuzatilishi ----
// Hozirgi chat bo'sh bo'lsa, yangisini YARATMAYMIZ — faqat inputga fokus beramiz.
function newChat() {
  if (busy) return;
  if (current.messages.length > 0) current = newDraft();
  closeSidebar(); render(); el.input.focus();
}

async function send() {
  const text = el.input.value.trim();
  if (!text || busy || current.messages.length >= MAX_MESSAGES) return;

  current.messages.push({ role: "user", text });
  if (!current.title) current.title = text.slice(0, 40);
  if (!chats.includes(current)) chats.unshift(current);   // ro'yxatga birinchi xabardan keyin qo'shiladi
  el.input.value = ""; el.input.style.height = "auto";
  el.status.textContent = ""; busy = true; save(); render();

  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: current.messages.map(({ role, text }) => ({ role, text })) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Xatolik yuz berdi.");
    current.messages.push({ role: "assistant", text: data.text, sources: data.sources || [] });
  } catch (e) {
    el.status.textContent = e.message || "Ulanishda xatolik.";
  }
  busy = false; save(); render();
}

function render() {
  const empty = current.messages.length === 0;
  el.chat.classList.toggle("is-empty", empty);

  // Yon paneldagi chatlar ro'yxati
  el.list.innerHTML = "";
  chats.forEach((c) => {
    const li = document.createElement("li");
    li.className = c === current ? "active" : "";
    li.innerHTML = `<button class="chat-title">${esc(c.title)}</button><button class="chat-del" aria-label="O'chirish">✕</button>`;
    li.children[0].onclick = () => { if (!busy) { current = c; closeSidebar(); render(); } };
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
    return `<div class="msg ${m.role}">${fmt(m.text)}${src ? `<div class="sources">${src}</div>` : ""}</div>`;
  }).join("") + (busy ? `<div class="msg assistant loading">Javob izlanmoqda…</div>` : "");
  el.msgs.scrollTop = el.msgs.scrollHeight;

  // Limitga yetganda yozishni to'xtatamiz
  const full = current.messages.length >= MAX_MESSAGES;
  el.input.disabled = full;
  el.input.placeholder = full ? "Chat to'ldi. Yangi chat oching." : "Savolingizni yozing…";
  el.send.disabled = busy || full;
}

function closeSidebar() { el.side.classList.remove("open"); el.back.classList.remove("show"); }
function openSidebar() { el.side.classList.add("open"); el.back.classList.add("show"); }

$("#newChat").onclick = newChat;
$("#menu").onclick = openSidebar;
el.back.onclick = closeSidebar;
el.send.onclick = send;
el.input.addEventListener("keydown", (e) => {          // Enter — yuborish, Shift+Enter — yangi qator
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
el.input.addEventListener("input", () => {              // input balandligi matnga qarab o'sadi
  el.input.style.height = "auto"; el.input.style.height = el.input.scrollHeight + "px";
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");   // PWA
function fitHeight() {
  document.documentElement.style.setProperty("--app-h", (window.visualViewport?.height || innerHeight) + "px");
}
window.visualViewport?.addEventListener("resize", fitHeight);
fitHeight();
render();
