# Care: roles, doctors, patients and medical memory (AutoSage)

IRIS keeps a **medical memory for every patient**: a private AutoSage knowledge base filled with their doctors' notes, reports and documents. When someone talks to the patient (a nurse asks "what did your last report say?"), the suggested replies are grounded in that memory. Doctors can also ask questions about a patient directly.

This doc covers:

1. Role-based access (patient / doctor)
2. Doctor dashboard and doctor–patient relations
3. Notes and files that sync to AutoSage automatically
4. Replies from AutoSage's fast query instead of GLM
5. One AutoSage chat per conversation

Speech-to-text and the console flow are documented in [talk.md](./talk.md).

---

## 1. Roles (RBAC)

| | |
|---|---|
| Where | `user.role` column: `"patient"`, `"doctor"`, or `null` until chosen |
| When | Right after sign-up (email or Google), `/` redirects to **`/onboarding`**, which shows two cards: *I'm a patient* / *I'm a doctor* |
| How | `POST /api/me/role { role }`. It can be set **once**; changing it later returns `409`, because switching roles would silently move medical access |
| Session | Better Auth `user.additionalFields.role` (`input: false`, so it can't be injected at sign-up). Every session carries the role, so checks need no extra query |
| Routing | `/` → no session: `/login` · no role: `/onboarding` · doctor: `/doctor` · patient: the gaze console |
| Server | `requireSession` + `requireRole("doctor" \| "patient")` middleware (`apps/server/src/rbac.ts`). `/api/doctor/*` is doctor-only, `/api/talk/*` patient-only. Otherwise `401 UNAUTHORIZED`, `403 ROLE_REQUIRED` or `403 FORBIDDEN` |

> **Hackathon limitation:** anyone can choose "doctor". A real deployment needs doctor verification (licence check or an admin invite) before granting the role.

---

## 2. Doctors and patients

**Relation model:** `care_relation (doctor_id, patient_id)` is **many-to-many** and unique per pair. A patient can have several doctors (care team), and a doctor has many patients.

**Assigning:** on `/doctor` the doctor types the patient's email → `POST /api/doctor/patients`.
- `404` if no account uses that email.
- `409` if the account isn't a patient (it's a doctor, or hasn't picked a role yet).
- Otherwise the patient is linked, and a `patient_profile` row is created.

**Every patient route checks the relation** (`treats(doctorId, patientId)`). A doctor only ever sees their own patients; anyone else gets `404`.

### Doctor UI

| Page | What it shows |
|---|---|
| `/doctor` | Patient cards (name, email, record count, last update). An *Add patient* email field. Empty state explains the patient must sign up as "Patient" first |
| `/doctor/patients/[id]` | **Write a note** (Medication / Progress / Diagnosis / General) · **Medical history** timeline with a sync badge per record (Uploading → Indexing → **In memory**, or Sync failed + reason) · **Upload a report or document** (drag & drop, up to 25 MB) · **Ask about \<patient\>**: grounded Q&A over their records · care team, memory status, *Remove* patient |

The page polls every 4 s while something is still indexing.

Doctors use mouse and keyboard, so these pages use the same palette, clay cards, and flat inputs.

---

## 3. Medical memory in AutoSage

### Layout (decision)

```
AutoSage environment (from the API key)
  └── Tenant "IRIS"  (external_id "iris")           one tenant for the whole app
        ├── Knowledge base: Patient A                ← one KB per patient
        │     ├── documents: notes (.md), reports (.pdf…)
        │     └── chats: one per conversation, external_subject_id = patient id
        └── Knowledge base: Patient B
```

**Why one KB per patient:** the knowledge base is AutoSage's *retrieval boundary*. Putting each patient in their own KB guarantees that one patient's records can never ground another patient's answers, even with a bad prompt. The tenant is the app (credits and quotas). This follows AutoSage's [tenancy guide](https://docs.autosage.ai/developers/concepts/tenancy): tenant per customer, `external_subject_id` per end user.

**Provisioning** (`apps/server/src/autosage/provision.ts`):
- **Tenant:** `AUTOSAGE_TENANT_ID`, else find the tenant with `external_id "iris"`, else create it in the key's environment (`GET /users/me`). The result is cached.
- **Patient KB:** created when the user picks "Patient" (in the background), or lazily on the first note, upload or reply. The KB id is stored in `patient_profile.autosage_kb_id`. Concurrent calls share one creation. The KB `instructions` tell AutoSage to use only facts from the records and never invent results, doses or diagnoses.
- **Model:** `AUTOSAGE_MODEL` (default **`deepseek/deepseek-v4.1-flash`**, see §4), else the first "Economic" model from `GET /chats/models`.

> **Current tenant (2026-11-04):** the org has **0 unallocated credits**; all 100 sit on the existing tenant **"work"**. Creating a dedicated "IRIS" tenant failed with `Insufficient org credits`. So `AUTOSAGE_TENANT_ID` points at "work" (`782d2f42-…`) for now. Patients are still isolated, because each has their own knowledge base. Watch out: "work" has a **100 MB storage cap with ~90 MB used**, which is fine for notes but tight for PDFs. When credits are available, allocate some to a new tenant in the dashboard (or `POST /tenants` with `credits_pool`) and switch `AUTOSAGE_TENANT_ID`.

### Notes → documents (automatic)

When a doctor saves a note it's stored in `medical_record` and **turned into a Markdown document** (`apps/server/src/autosage/records.ts`):

```markdown
# Medication: Started baclofen 10 mg twice daily…
- **Patient:** Asha Verma
- **Type:** Medication change
- **Date:** 2026-11-04
- **Written by:** Dr. Meera Rao

## Note
Started baclofen 10 mg twice daily for spasticity. Review in two weeks.
```

The patient, type, date and author header is repeated in every document, so retrieved chunks still carry their context.

**Upload flow (AutoSage presigned upload):**
1. `POST /documents/presign` (`text/markdown`).
2. `PUT` the bytes to `upload_url`.
3. Status becomes `queued`.
4. AutoSage processes it on its own. `GET /documents/status` moves the record to `processing` and then `processed` (shown as "In memory").

**Files** (PDF, Word, Excel, text, CSV, JSON, images) take the same path with their own MIME type.

### Reliability

| Situation | Behaviour |
|---|---|
| AutoSage down / unreachable | Record saved anyway → *Sync failed: "AutoSage is unreachable right now. This will sync automatically when it's back."* |
| File upload fails | The bytes are kept in `pending_upload` (Postgres) **until AutoSage accepts them**, then deleted, so the doctor never has to upload again |
| Recovery | **Auto-resync:** opening a patient re-tries every record that never reached AutoSage (max once per 2 min per patient). There's also a manual **Sync again** button per record |
| Server restarted mid-upload | Records stuck in "uploading" > 3 min are marked failed and retried |
| Delete | Removes the document from AutoSage first, then from IRIS |

---

## 4. Replies from AutoSage fast query

"Say something" replies now come from **AutoSage `POST /chats/fast-query`** (one KB retrieval + answer, the fast path) on **the patient's knowledge base**, instead of GLM.

- **Prompt** (`apps/server/src/talk/replies.ts`) contains:
  - what was heard, and what the patient said since the last turn;
  - rules: 3 replies, ≤ 12 words, first person, different from each other;
  - **"if it's about their health, reports, medicines or progress, use the facts in their records; never invent; if the records don't say, say you're not sure"**;
  - replies already shown, so "New replies" doesn't repeat them;
  - strict JSON output `{ "replies": [...], "unclear": bool }`.
- **Response:** fast-query returns `{ success, final_answer, sources[], responseParts, usedKnowledgeBase, processingTimeMs, tokens }`. IRIS reads `final_answer` (`pickAnswer()` in `client.ts`).
- **Parsing** is lenient: JSON, fenced JSON, or a numbered list. Fewer than 3 usable replies counts as a failure.
- **Model:** `deepseek/deepseek-v4.1-flash`. Timed with the real reply prompt on a real patient KB (2026-11-04):

  | Model (inside AutoSage) | Server time | Notes |
  |---|---|---|
  | **deepseek/deepseek-v4.1-flash** | **2.3 s** | Cheapest per token, accurate facts, good variety |
  | anthropic/claude-haiku-4.5 | 2.4 s | Good, ~10× the token price, wraps JSON in a code fence (the parser handles it) |
  | google/gemini-3.5-flash-lite | 2.4 s | A bit generic |
  | openai/gpt-6-luna | 4.7 s | Replies too similar |
  | z-ai/glm-5.3-flash | 16.4 s | ~1,800 reasoning tokens; AutoSage has no switch to turn thinking off |

  End-to-end through IRIS (chat + retrieval + answer) a round takes **3–5 s**.
- **Fallback:** if AutoSage isn't configured, errors or times out (30 s), the same request goes to OpenRouter (`z-ai/glm-5.3-flash`, then `deepseek/deepseek-v4-flash`) without records, so the patient is never left without replies. The response's `source` field says which path answered (`"autosage"` / `"openrouter"`), and the browser console logs it.
- **Speech-to-text** stays on OpenRouter Whisper. AutoSage's `/transcriptions` uses Deepgram at 5× markup, so it costs more.

The nurse example: *"How are you? What were the results of your current report?"*. The fast query retrieves the latest report document from the patient's KB, and one suggestion becomes something like *"MRI showed no new lesions, same as June."*

---

## 5. One AutoSage chat per conversation

| | |
|---|---|
| Conversation | `conversation` row. Starts on the first utterance after the patient opens **Say something** |
| AutoSage chat | Created on the conversation's first reply request (`POST /chats`, `agent_mode: "quick"`, `external_subject_id` = patient id, **chat id = conversation id**). **Every** later utterance and reply of that conversation is sent with that `chat_id`, so the whole exchange lives in one chat |
| What goes in | Each turn's query carries what was heard and anything the patient said since the last query (`conversation_turn.sent_to_autosage` tracks this) |
| Ends when | The patient leaves conversation mode (**Ignore**, **Cancel**, back to home), via `POST /api/talk/conversations/:id/end`, or after **10 min** of silence. The next *Say something* opens a new conversation and a new chat |
| Local copy | `conversation_turn` keeps heard/spoken turns (also used as context by the OpenRouter fallback) |

---

## 6. Data model

```
user (+ role)
 ├─ care_relation        doctor_id ⇄ patient_id   (unique pair)
 ├─ patient_profile      user_id → autosage_kb_id
 ├─ medical_record       patient_id, author_id, kind note|file, category, title, body,
 │                       file_name, mime_type, size_bytes, autosage_document_id,
 │                       sync_status pending|uploading|queued|processing|processed|failed, sync_error
 │    └─ pending_upload  record_id → bytes   (only until synced)
 └─ conversation         patient_id, autosage_chat_id, shown_replies, started_at, last_activity_at, ended_at
      └─ conversation_turn  role heard|spoken, text, sent_to_autosage
```

The schema lives in `packages/db/src/schema/care.ts` (+ `role` in `auth.ts`) and was applied with `drizzle-kit push`. The push only added tables and one nullable column; nothing was dropped.

---

## 7. API

### Me
| Method | Path | |
|---|---|---|
| GET | `/api/me` | `{ id, name, email, role }` |
| POST | `/api/me/role` | `{ role: "patient" \| "doctor" }`, once |

### Doctor (doctor role, relation-checked)
| Method | Path | |
|---|---|---|
| GET | `/api/doctor/patients` | Patients with record counts |
| POST | `/api/doctor/patients` | `{ email }` → assign |
| DELETE | `/api/doctor/patients/:patientId` | Unassign (records stay) |
| GET | `/api/doctor/patients/:patientId` | Profile, care team, KB status, records (statuses refreshed) |
| POST | `/api/doctor/patients/:patientId/notes` | `{ category, title?, body }` |
| POST | `/api/doctor/patients/:patientId/files` | multipart `file`, `category`, `title?` |
| POST | `/api/doctor/patients/:patientId/ask` | `{ question }` → `{ answer, ms }` (fast-query on the patient's KB) |
| POST | `/api/doctor/records/:recordId/retry` | Re-sync |
| GET | `/api/doctor/records/:recordId/download` | `{ url }` (AutoSage temporary link) |
| DELETE | `/api/doctor/records/:recordId` | Delete from AutoSage + IRIS |

### Talk (patient role). Changes vs talk.md
| Method | Path | |
|---|---|---|
| POST | `/api/talk/utterance` | multipart `audio` + **`conversationId?`** → also returns `conversationId`, `source` |
| POST | `/api/talk/transcript` | New: `{ text, conversationId? }`, same as utterance but for already-transcribed text (phone's on-device STT fallback, testing without a mic) |
| POST | `/api/talk/replies` | **`{ conversationId }`** |
| POST | `/api/talk/spoken` | **`{ conversationId, text }`** |
| POST | `/api/talk/conversations/:id/end` | New: end the conversation |
| ~~POST~~ | ~~`/api/talk/reset`~~ | Removed (conversations replace it) |

---

## 8. Configuration (`apps/server/.env`)

| Variable | Default | |
|---|---|---|
| `AUTOSAGE_API_KEY` | (none) | `sk_live_…` / `sk_test_…`. **Set** (git-ignored `.env`) |
| `AUTOSAGE_BASE_URL` | `https://beta-api.autosage.ai` | Where this key lives (`api.` returns 503, `alpha-` rejects the key). Swagger: <https://beta-api.autosage.ai/swagger> |
| `AUTOSAGE_TENANT_ID` | (auto) | **Set to the "work" tenant** in `.env` for now (see §3). Empty → find/create `external_id "iris"` |
| `AUTOSAGE_MODEL` | `deepseek/deepseek-v4.1-flash` | Any id from `GET /chats/models` |

---

## 9. Status and what's verified

Verified **live against `beta-api.autosage.ai`** on 2026-11-04 with two test accounts (`packages/db/seed/*.json`, git-ignored).

**Roles and relations**
- New account → role `null` → `/onboarding`. The role is set once (`409` on change). Doctor → `/doctor`, patient → console.
- `403` across roles; `ROLE_REQUIRED` before choosing.
- Assign by email: unknown `404`, doctor email `409`, patient `201`.

**Medical memory**
- The first sync **created the patient's knowledge base** automatically.
- A note (→ Markdown) and two reports went **uploading → queued → processing → processed** in about 10 s.
- When AutoSage was unreachable, records showed a plain-language "Sync failed". **Auto-resync** and **Sync again** both pushed them through once it was reachable. Files were re-sent from the kept bytes.
- Fixed while testing: auto-resync and a manual retry could upload the same record twice. Uploads now **claim the record atomically** (only one sync wins). The two duplicate documents this created were deleted from the KB.

**Replies grounded in records** (`POST /api/talk/transcript`)
- *"How are you feeling? What did your last MRI show?"* → "I'm okay, thanks. My last MRI was stable, no new lesions."
- Follow-up *"Are you taking the new medicine twice a day?"* → "Yes, baclofen 10 mg twice daily, started on November third."
- **New replies** gave a different set. Replies say "I'm not sure, ask my doctor" when the records don't cover something.

**Chats**
- All turns of a conversation (heard + what the patient said + replies) are in **one AutoSage chat** (`GET /chats/:id/messages` shows them in order).
- Ending it and talking again opened a **new chat**.

**Doctor "Ask"** answers from the records and cites the note and report dates (~3.6 s).

**UI** checked in the browser: onboarding, patient list, patient profile with sync badges.

**Not verified yet**
- The full **microphone → Whisper → replies** loop. Speech-to-text still needs `OPENROUTER_API_KEY`; `/api/talk/transcript` covers everything after transcription.
- Deleting a patient's knowledge base when an account is deleted. Not implemented; KBs stay in AutoSage.
