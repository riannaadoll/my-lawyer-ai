// server.js — backend. Ikki ish qiladi: (1) public/ papkadagi saytni beradi,
// (2) /api/chat orqali savolni Gemini'ga yuborib, javobni qaytaradi.
const express = require("express");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;             // Render portni o'zi beradi
const API_KEY = process.env.GEMINI_API_KEY;        // kalit kodda EMAS, muhit o'zgaruvchisida
const DEBUG = process.env.DEBUG_ERRORS === "1";    // yoqilsa, Google'ning xato xabari ekranda ko'rinadi

// Modellar ketma-ket sinaladi. Har birining kvotasi alohida, shuning uchun biri to'lsa keyingisi ishlashi mumkin.
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"].filter(Boolean);

const MAX_CHARS = 1500;   // bitta xabarning maksimal uzunligi
const MAX_HISTORY = 12;   // Geminiga yuboriladigan oxirgi xabarlar soni

// Xato matnlari (klient yuborgan "lang" bo'yicha tanlanadi)
const ERR = {
  uz: { rate: "Juda ko'p so'rov. Bir daqiqadan keyin urinib ko'ring.", limit: "Hozir so'rovlar ko'p yoki limit tugagan. Birozdan keyin urinib ko'ring.", slow: "AI xizmati kech javob berdi. Qayta urinib ko'ring.", net: "AI xizmatiga ulanib bo'lmadi. Qayta urinib ko'ring.", fail: "AI xizmati javob bermadi (kod", down: "Serverga ulanishda xatolik.", nokey: "Serverda GEMINI_API_KEY sozlanmagan.", empty: "Xabar topilmadi.", last: "Oxirgi xabar foydalanuvchidan bo'lishi kerak.", none: "Javob olinmadi, qayta urinib ko'ring." },
  ru: { rate: "Слишком много запросов. Повторите через минуту.", limit: "Сейчас много запросов или лимит исчерпан. Повторите позже.", slow: "ИИ-сервис отвечает слишком долго. Повторите попытку.", net: "Не удалось подключиться к ИИ-сервису. Повторите попытку.", fail: "ИИ-сервис не ответил (код", down: "Ошибка соединения с сервером.", nokey: "На сервере не задан GEMINI_API_KEY.", empty: "Сообщение не найдено.", last: "Последнее сообщение должно быть от пользователя.", none: "Ответ не получен, повторите попытку." },
  en: { rate: "Too many requests. Try again in a minute.", limit: "Too many requests right now or the limit is reached. Try again later.", slow: "The AI service is responding slowly. Please try again.", net: "Could not reach the AI service. Please try again.", fail: "The AI service did not respond (code", down: "Server connection error.", nokey: "GEMINI_API_KEY is not set on the server.", empty: "No message found.", last: "The last message must be from the user.", none: "No answer received, please try again." },
};
const langOf = (l) => (["uz", "ru", "en"].includes(l) ? l : "uz");

// Rasmiy manba domenlari (ishonchlilik belgisi shu bo'yicha qo'yiladi)
const OFFICIAL = /(^|\.)(lex\.uz|gov\.uz|president\.uz)$/i;
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };

// Prompt: qidiruv yoqilgan va o'chirilgan holat uchun alohida (qidiruvsiz aniq raqam keltirish taqiqlanadi)
// "Mening holatim" rejimi: bot savollar berib vaziyatni aniqlashtiradi, keyin yo'l xaritasi tuzadi
const CASE_RULES = `
Rejim "Mening holatim": foydalanuvchi o'z vaziyatini yozadi. Darhol xulosa chiqarma. Har xabarda faqat BITTA aniqlashtiruvchi savol ber (jami 3-5 ta): kim/qaysi tashkilot, aynan nima bo'lgan, qachon, qanday hujjat yoki dalil bor, foydalanuvchi qanday natija xohlaydi. Yetarli ma'lumot yig'ilgach (yoki foydalanuvchi "yetarli" desa) yo'l xaritasini tuz: 1) Vaziyat xulosasi 2) Sizning huquqlaringiz 3) Qadamlar (tartib bilan) 4) Qaysi organga murojaat qilish 5) Muddatlar 6) Tayyorlash kerak hujjatlar. Ma'lumot yetishmasa, taxmin qilma. Aniqlashtiruvchi savol berayotganda oxirgi eslatma jumlasini yozma: faqat qisqa izoh va savol.`;

function buildPrompt(searchOn, mode) {
  const today = new Date().toISOString().slice(0, 10);
  const base = `Sen "AI Advocate" — O'zbekiston Respublikasi qonunchiligi bo'yicha fuqarolarga yordam beradigan yordamchisan. Bugungi sana: ${today}.
Til: foydalanuvchi qaysi tilda yozsa (o'zbek, rus yoki ingliz), javobning HAMMASINI shu tilda yoz: sarlavhalar, qat'iy jumlalar va oxirgi eslatma ham. Tillarni aralashtirma. Huquqiy terminlarni o'sha tilning rasmiy atamalari bilan yoz.
Vaziyat noaniq bo'lsa (kim, nima bo'lgan, qachon, qanday hujjat bor), darhol javob berma: avval 2-4 ta aniqlashtiruvchi savol ber va to'xta.
Aniq savolga sodda tilda, shu tuzilishda javob ber (sarlavhalarni foydalanuvchi tiliga tarjima qil):
**Qisqa javob:** ...
**Tegishli norma:** kodeks/qonun nomi, modda, band
**Izoh:** oddiy tilda
**Qayerga murojaat qilish mumkin:** tegishli davlat organi
**Manba:** ...
Ishonchli asos topa olmasang, taxmin qilma va shu jumlani ishlat (foydalanuvchi tilidagisini):
uz: "Bu savol bo'yicha yetarlicha ishonchli huquqiy asos topilmadi. Aniqlik uchun yurist bilan maslahatlashish tavsiya etiladi."
ru: "По этому вопросу не найдено достаточно надёжного правового основания. Для точности рекомендуется обратиться к юристу."
en: "No sufficiently reliable legal basis was found for this question. Consulting a lawyer is recommended."
Murakkab yoki oqibati katta vaziyatda (sud, katta pul, jinoyat) malakali yuristga murojaat qilishni tavsiya et.
Oxirida foydalanuvchi tilida bir qisqa jumla: bu ma'lumot, yuridik maslahat emas.`;
  const full = searchOn
    ? base + "\nMa'lumotni internetdan qidir. Birinchi navbatda lex.uz va rasmiy davlat saytlariga (.gov.uz) tayan. Moddaning amaldagi tahririni va oxirgi o'zgarish sanasini ko'rsat. Manbalar zid bo'lsa, rasmiy manbani tanla."
    : base + `
MUHIM: hozir internetdan qidira olmaysan. Qaror/qonun raqami, sanasi va modda raqamini KELTIRMA: xotiradan yozsang noto'g'ri bo'lishi mumkin. Faqat umumiy tamoyilni tushuntir. 'Tegishli norma' va 'Manba' o'rniga shu jumlani yoz (foydalanuvchi tilidagisini):
uz: "Aniq normani lex.uz'dan tekshiring."
ru: "Точную норму проверьте на lex.uz."
en: "Please verify the exact provision on lex.uz."`;
  return mode === "case" ? full + CASE_RULES : full;
}

app.set("trust proxy", 1);                         // Render proxy orqasida IP to'g'ri aniqlansin
app.use(express.json({ limit: "20kb" }));          // katta so'rovlarni rad etadi
app.use(express.static("public"));                 // sayt fayllari

// Himoya: bitta IP daqiqasiga 15 tadan ko'p so'rov yubora olmaydi
app.use("/api/", rateLimit({
  windowMs: 60_000, max: 15,
  handler: (req, res) => res.status(429).json({ error: ERR[langOf(req.body?.lang)].rate }),
}));

// Geminiga BITTA so'rov. useSearch=true bo'lsa internetdan jonli qidirish yoqiladi.
async function askGemini(model, contents, useSearch, mode, timeoutMs) {
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildPrompt(useSearch, mode) }] },
          contents,
          ...(useSearch ? { tools: [{ google_search: {} }] } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    return { r, data: await r.json().catch(() => ({})) };      // JSON bo'lmasa bo'sh obyekt
  } catch (err) {                                              // tarmoq xatosi yoki vaqt tugashi: 504 yoki 0
    return { r: { ok: false, status: err.name === "TimeoutError" ? 504 : 0 }, data: { error: { message: `${err.name}: ${err.message}` } } };
  }
}

// Har model uchun: avval qidiruv bilan; limit yoki kechikishda qidiruvsiz; u ham bo'lmasa keyingi modelga.
async function generate(contents, mode) {
  const deadline = Date.now() + 55_000;                      // umumiy vaqt chegarasi
  let last;
  for (const model of MODELS) {
    for (const searched of [true, false]) {
      const left = deadline - Date.now();
      if (last && left < 3000) return last;
      const { r, data } = await askGemini(model, contents, searched, mode, Math.min(20_000, left));
      last = { r, data, model, searched };
      if (r.ok) return last;
      console.error(`Gemini xatosi [${model}, qidiruv=${searched}]:`, r.status, JSON.stringify(data));
      if (![0, 429, 504].includes(r.status)) break;          // qidiruvsiz qayta urinish faqat limit/kechikishda
    }
    if (![0, 404, 429, 503, 504].includes(last.r.status)) break;   // kalit/so'rov xatosida boshqa model yordam bermaydi
  }
  return last;
}

app.post("/api/chat", async (req, res) => {
  const { messages, mode, lang } = req.body || {};
  const E = (k) => ERR[langOf(lang)][k];
  if (!API_KEY) return res.status(500).json({ error: E("nokey") });
  if (!Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: E("empty") });

  // Xabarlarni Gemini formatiga o'tkazamiz va uzunligini cheklaymiz
  const contents = messages.filter((m) => m && typeof m === "object").slice(-MAX_HISTORY).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.text || "").slice(0, MAX_CHARS) }],
  }));
  while (contents.length && contents[0].role === "model") contents.shift();   // ro'yxat foydalanuvchidan boshlansin
  if (contents.length === 0 || contents.at(-1).role !== "user")
    return res.status(400).json({ error: E("last") });

  try {
    const { r, data, model, searched } = await generate(contents, mode === "case" ? "case" : "");
    if (!r.ok) {
      const detail = DEBUG ? ` | ${data?.error?.message || ""}`.slice(0, 300) : "";
      const msg = r.status === 429 ? E("limit") : r.status === 504 ? E("slow") : r.status === 0 ? E("net") : `${E("fail")} ${r.status}).`;
      return res.status(502).json({ error: msg + detail });
    }
    console.log(`Javob: ${model}, ${searched ? "qidiruv bilan" : "qidiruvsiz"}`);

    const cand = data.candidates?.[0];
    let text = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
    // Gemini qidiruvda foydalangan saytlar (takrorlarsiz)
    const seen = new Set();
    const sources = (cand?.groundingMetadata?.groundingChunks || [])
      .map((c) => c.web).filter((w) => w?.uri && !seen.has(w.uri) && seen.add(w.uri))
      .map((w) => ({ title: w.title || w.uri, url: w.uri }));

    // Ishonchlilik belgisi kodda hisoblanadi (modelga ishonib bo'lmaydi): rasmiy manba topildimi?
    const official = sources.some((x) => OFFICIAL.test(x.title) || OFFICIAL.test(hostOf(x.url)));
    // Qisqa aniqlashtiruvchi savol (manbasiz, "?" bilan tugaydi) uchun belgi kerak emas
    const isQuestion = !sources.length && text.length < 700 && /\?\s*$/.test(text);
    const trust = isQuestion ? "" : !searched ? "nosearch" : official ? "official" : "unverified";
    const date = new Date().toISOString().slice(0, 10);

    res.json({ text: text || E("none"), sources, trust, date });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: E("down") });
  }
});

app.listen(PORT, () => console.log(`Server ishga tushdi: http://localhost:${PORT}`));
