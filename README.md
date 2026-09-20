# AI Advocate — Mening advokatim

Papkalar: `server.js` (backend + Gemini), `public/` (sayt: `index.html` tuzilma, `style.css` ko'rinish, `app.js` mantiq, `sw.js` + `manifest.json` PWA).

## Kompyuterda ishga tushirish
    npm install
    GEMINI_API_KEY=kalitingiz npm start     # keyin http://localhost:3000

## Render'da
Environment bo'limiga `GEMINI_API_KEY` qo'shing. Build: `npm install`, Start: `npm start`.
Model nomini o'zgartirish uchun `GEMINI_MODEL` qo'shing (standart: gemini-2.5-flash).

## Qo'shimcha sozlamalar (Render → Environment)
- `DEBUG_ERRORS=1` — Google'ning xato xabari ekranda ko'rinadi (faqat tekshirish uchun, keyin o'chiring).
- `GEMINI_MODEL` — birinchi sinaladigan model. Bo'lmasa server o'zi ro'yxatdan sinaydi (server.js → MODELS).
