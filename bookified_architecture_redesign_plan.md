# Bookified: Architecture Redesign & Free-Tier Plan

---

## 1. Ye Project Asal Me Karta Kya Hai? (What is Bookified?)

**Bookified** ka basic concept bohot simple aur powerful hai:  
> **"Aap kisi bhi PDF Book ko upload karein, aur uske saath real-time voice me baat karein — jaise book ek insaan ban kar aapse discuss kar rahi ho."**

```
┌─────────────────┐       ┌────────────────────┐       ┌──────────────────────┐
│  1. Upload PDF   │  ──►  │ 2. Text Chunks &   │  ──►  │ 3. Voice Companion   │
│  (Book file)    │       │    Search Index    │       │ (Mic se baat karein) │
└─────────────────┘       └────────────────────┘       └──────────────────────┘
```

### Iske Core Features:
1. **Interactive Library:** Upload ki gayi books ki shelf jahan cover image, title, author aur voice character dikhte hain.
2. **Instant In-Browser PDF Processing:** Browser me hi PDF ka text extract hota hai aur first page se book cover photo banti hai.
3. **Smart Book Search (RAG):** Book ke lambe text ko 500-word ke chote segments me baanta jata hai taki sawal puchte hi relevant page ka content turant mil sake.
4. **Voice Conversation & Live Transcripts:** User mic par bolta hai, AI book me se answer dhoondh kar voice me bolta hai, aur screen par live captions/transcript aate hain.

---

## 2. Abhi Problem Kya Hai? (Why are you confused right now?)

Right now, codebase me bohot saare **third-party cloud services** aapas me uljhe hue hain:

| Component | Current Tool | Problem / Kyu Error Aa Raha Hai |
| :--- | :--- | :--- |
| **PDF & Cover Storage** | **Vercel Blob** | Store "Private" mode me hai, isliye browser ko **CORS 400 Bad Request** de raha hai. |
| **Database** | **MongoDB Atlas** | IP Whitelisting aur strict OpenSSL/TLS 1.3 ki wajah se **SSL alert 80** connection drops de raha hai. |
| **Voice AI & LLM** | **Vapi + ElevenLabs** | ⚠️ **Sabse bada hidden trap**: Vapi ek cloud service hai jo book search ke liye aapke server (`/api/vapi/search-book`) par webhook bhejti hai. **`localhost:3001` par Vapi ka webhook kabhi pahuchega hi nahi** jab tak aap Ngrok tunnel setup na karein! Aur free credits khatam hone par billing mangta hai. |
| **Subscriptions** | **Clerk Billing** | Free plan user ko sirf 1 book upload karne deta hai aur paid Stripe pricing table expect karta hai. |

---

## 3. Proposed Simplified Architecture (100% Free & Transparent)

Hum isko ek aisi architecture me convert kar sakte hain jisme **har step aapki screen aur code ke control me ho**, bina kisi payment ya complicated cloud webhooks ke:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             SIMPLIFIED ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────────┘

  [ USER BROWSER ]
       │
       ├─► 1. PDF Upload ──► Server API (/api/upload) ──► Saves to /public/uploads
       │                                                  (0 CORS, 0 Tokens)
       │
       ├─► 2. Text Chunks ──► MongoDB / Local DB
       │                      (BookSegment collection me text store hota hai)
       │
       └─► 3. Voice Companion (Chat Mode):
             │
             ├─ Step A: User speaks ──► Web Speech API (Browser native STT - 100% Free)
             │
             ├─ Step B: Search Book ──► MongoDB $text search (Relevant context nikalo)
             │
             ├─ Step C: AI Answer   ──► Google Gemini 2.0 Flash (Free API, no credit card)
             │
             └─ Step D: Speak Back  ──► SpeechSynthesis (Browser native TTS - 100% Free)
```

---

## 4. Current vs Proposed Comparison

| Feature | Current Architecture (Complex & Paid) | New Proposed Architecture (100% Free & Clean) |
| :--- | :--- | :--- |
| **File Storage** | Vercel Blob (Cloud, Token, CORS issues) | **Local Server Storage (`/public/uploads`)**<br>Direct Next.js route handler. Fast, works offline, zero CORS. |
| **Voice Input (STT)** | Vapi Cloud WebRTC | **Browser Web Speech API (`webkitSpeechRecognition`)**<br>Chrome/Safari/Edge me built-in, zero cost, instant transcription. |
| **AI LLM Brain** | Vapi managed assistant | **Google Gemini 2.0 Flash** (Free via Google AI Studio)<br>15 requests/min free, super fast, full control over prompt. |
| **Voice Output (TTS)** | ElevenLabs (via Vapi) | **Browser `window.speechSynthesis`**<br>Dozens of high-quality natural voices built into macOS/Windows. |
| **Search Engine** | MongoDB text search | **MongoDB text search** (already working, keep it). |
| **Subscription Limits** | Clerk Billing (1 book limit) | **Unlocked Dev Mode** (Unlimited books & sessions). |

---

## 5. Isko Implement Karne Ke Liye Code Me Kya Changes Honge?

### Change 1: File Upload ([app/api/upload/route.ts](file:///Users/amitsaraswat/Desktop/Projects/bookified/app/api/upload/route.ts))
- Vercel Blob SDK hata kar ek standard Next.js `FormData` handler banayenge jo files ko `/public/uploads/` me save karega.
- [UploadForm.tsx](file:///Users/amitsaraswat/Desktop/Projects/bookified/components/UploadForm.tsx) me `@vercel/blob/client` ka `upload()` function standard `fetch('/api/upload', { method: 'POST', body: formData })` se replace ho jayega.

### Change 2: Voice Hook ([hooks/useVapi.ts](file:///Users/amitsaraswat/Desktop/Projects/bookified/hooks/useVapi.ts) ➔ `hooks/useVoiceCompanion.ts`)
- Vapi ka heavy SDK hata kar ek lightweight custom hook banayenge:
  1. `startListening()`: Microphone on karta hai aur user ki aawaz ko text me convert karta hai.
  2. `askBook(userText)`: Server par `/api/chat` ko bhejta hai. Server MongoDB se book segments search karke Gemini ko prompt bhejta hai:  
     *"You are the book '[Title]'. Answer the user's question using this excerpt: [Segments]"*
  3. `speak(aiAnswer)`: Browser ke speaker se book ke voice character me bol kar sunata hai aur transcript update karta hai.

### Change 3: Unlock Limits ([lib/subscription.server.ts](file:///Users/amitsaraswat/Desktop/Projects/bookified/lib/subscription.server.ts))
- Default plan ko `PLANS.PRO` return karenge taki book count aur session timer ki koi artificial limit na lage.

---

## 6. Execution Roadmap

1. **Phase 1: Zero-CORS File Upload** — Switch upload to standard local server storage so PDFs & covers save immediately.
2. **Phase 2: Database Stability** — Whitelist IP in Atlas or connect local Mongo so book segments save smoothly.
3. **Phase 3: Browser Voice Companion** — Replace Vapi with Web Speech API + Gemini Flash for unlimited, free conversational voice companion.
