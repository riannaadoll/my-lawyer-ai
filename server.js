// server.js — backend. Ikki ish qiladi: (1) public/ papkadagi saytni beradi,
// (2) /api/chat orqali savolni Gemini'ga yuborib, javobni qaytaradi.
const express = require("express");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;             // Render portni o'zi beradi
const API_KEY = process.env.GEMINI_API_KEY;        // kalit kodda EMAS, muhit o'zgaruvchisida
// Modellar ketma-ket sinaladi: birinchisi topilmasa (404), keyingisiga o'tadi
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.5-flash", "gemini-2.5-flash"].filter(Boolean);

const MAX_CHARS = 1500;   // bitta xabarning maksimal uzunligi
const MAX_HISTORY = 12;   // Geminiga yuboriladigan oxirgi xabarlar soni

const SYSTEM_PROMPT = `Sen "AI Advocate" — O'zbekiston fuqarolariga huquqlari va qonunlar haqida yordam beradigan yordamchisan.
- Foydalanuvchi tilida (asosan o'zbekcha) qisqa va aniq javob ber, faqat matn.
- Ma'lumotni internetdan qidir. Birinchi navbatda lex.uz va boshqa rasmiy davlat saytlariga tayan.
- Har javobda manbani ko'rsat: qonun/qaror nomi, modda, band, yil va (bilsang) oxirgi tahrir sanasi.
- Manbalar bir-biriga zid bo'lsa, rasmiy manbani tanla. Aniq bilmasang, taxmin qilma: "aniq ma'lumot topa olmadim" de.
- Oxirida bir qisqa jumla: bu ma'lumot, yuridik maslahat emas.`;

app.set("trust proxy", 1);                         // Render proxy orqasida IP to'g'ri aniqlansin
app.use(express.json({ limit: "20kb" }));          // katta so'rovlarni rad etadi
app.use(express.static("public"));                 // sayt fayllari

// Himoya: bitta IP daqiqasiga 15 tadan ko'p so'rov yubora olmaydi
app.use("/api/", rateLimit({
  windowMs: 60_000, max: 15,
  message: { error: "Juda ko'p so'rov. Bir daqiqadan keyin urinib ko'ring." },
}));

app.post("/api/chat", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "Serverda GEMINI_API_KEY sozlanmagan." });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: "Xabar topilmadi." });

  // Xabarlarni Gemini formatiga o'tkazamiz va uzunligini cheklaymiz
  const contents = messages.slice(-MAX_HISTORY).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.text || "").slice(0, MAX_CHARS) }],
  }));
  while (contents[0].role === "model") contents.shift();   // ro'yxat foydalanuvchidan boshlansin
  if (contents.length === 0 || contents.at(-1).role !== "user")
    return res.status(400).json({ error: "Oxirgi xabar foydalanuvchidan bo'lishi kerak." });

    try {
    let r, data;
    for (const model of MODELS) {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents,
            tools: [{ google_search: {} }],
          }),
          signal: AbortSignal.timeout(45_000),
        }
      );
      data = await r.json();
      if (r.status !== 404) break;               // faqat "model topilmadi" bo'lsa keyingisini sinaymiz
      console.error("Model topilmadi:", model);
    }
    if (!r.ok) {
      console.error("Gemini xatosi:", r.status, JSON.stringify(data));
      return res.status(502).json({ error: `AI xizmati javob bermadi (kod ${r.status}).` });
    }

    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
    // Gemini qidiruvda foydalangan saytlar (takrorlarsiz)
    const seen = new Set();
    const sources = (cand?.groundingMetadata?.groundingChunks || [])
      .map((c) => c.web).filter((w) => w?.uri && !seen.has(w.uri) && seen.add(w.uri))
      .map((w) => ({ title: w.title || w.uri, url: w.uri }));

    res.json({ text: text || "Javob olinmadi, qayta urinib ko'ring.", sources });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Serverga ulanishda xatolik." });
  }
});

app.listen(PORT, () => console.log(`Server ishga tushdi: http://localhost:${PORT}`));
