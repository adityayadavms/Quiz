# Quiz Backend API 
This guide covers everything the Flutter app needs to talk to the quiz backend: the base URL, both endpoints, every field in each request and response, every error the server can return, and the recommended quiz flow on the client.

> **TL;DR**
> - `GET /api/pool?subtopicId=<cuid>` returns **6 primary + up to 3 backup** questions. It **never** includes the correct answer.
> - `POST /api/submit` takes the user's answers and returns the score, the correct option, and an explanation for **each** answer.
> - Grading happens **only on the server**, so backup questions can't be re-queued mid-quiz. Show them in a **Review / Retry** phase after the first submit.

---

## Table of Contents

1. [Base URL & Environment Setup](#1-base-url--environment-setup)
2. [Core Concepts](#2-core-concepts)
3. [Data Model Reference](#3-data-model-reference)
4. [Endpoint: `GET /api/pool`](#4-endpoint-get-apipool)
5. [Endpoint: `POST /api/submit`](#5-endpoint-post-apisubmit)
6. [Error Handling](#6-error-handling)
7. [Recommended Quiz Flow (Client-Side)](#7-recommended-quiz-flow-client-side)
8. [Dart / Flutter Reference Code](#8-dart--flutter-reference-code)
9. [Testing with cURL / Postman](#9-testing-with-curl--postman)
10. [Gotchas & FAQ](#10-gotchas--faq)

---

## 1. Base URL & Environment Setup

The API runs on port **4000**, and every route lives under `/api`.

| Where the app runs | Base URL |
|---|---|
| Flutter Web / iOS Simulator / desktop | `http://localhost:4000/api` |
| Android Emulator | `http://10.0.2.2:4000/api` |
| Physical device on the same Wi-Fi | `http://<your-laptop-LAN-IP>:4000/api` (e.g. `http://192.168.1.20:4000/api`) |

**Server facts that affect the client:**

| Setting | Value | What it means for Flutter |
|---|---|---|
| CORS | Open (`cors()` with defaults) | Flutter Web works from any origin. |
| Body parser | `express.json({ limit: "50kb" })` | Always send `Content-Type: application/json`. Bodies over 50 KB are rejected. |
| Auth | None (yet) | No tokens or headers beyond `Content-Type`. |
| Protocol | Plain HTTP during local dev | See the cleartext note below. |

> **Cleartext HTTP note:** Android 9+ and iOS block plain `http://` by default.
> - **Android:** add `android:usesCleartextTraffic="true"` to `<application>` in `android/app/src/main/AndroidManifest.xml` (dev only).
> - **iOS:** add `NSAppTransportSecurity → NSAllowsLocalNetworking = YES` (or an exception domain) in `Info.plist` (dev only).

Keep the base URL in one config constant so it's easy to change per environment.

---

## 2. Core Concepts

### 2.1 Stateless server
The server doesn't remember anything between requests. There's no session, cookie, or "current quiz" on the backend.
- To **get** questions, send the `subtopicId`.
- To **grade** them, send the `subtopicId` along with the answers.
- The client tracks quiz progress: current question index, selected options, and retry state.

### 2.2 Server-side grading (no answers on the client)
`GET /api/pool` **never** returns the correct option or the explanation. Those fields don't exist in the response. The only way to find out if an answer is right is to call `POST /api/submit`.

### 2.3 Primary vs. backup questions (`role` + `familyId`)
- Every question has a `role`, which is either `"primary"` or `"backup"`.
- Every question also has a `familyId` (for example `"fam_value"`), which groups questions that test the **same concept**.
- A **backup** question is a second chance at a concept. If a user gets a primary question wrong, the backup with the **same `familyId`** is the one to show them next.
- **Not every family has a backup.** The pool returns at most 3 backups for 6 primaries, so some wrong primaries will have no backup. The client has to handle that case (see [§7](#7-recommended-quiz-flow-client-side)).

### 2.4 Batch submission
The user's answers go to the server **in one request**. The server grades them all, saves one "attempt" record per answer, and returns all the results together.

---

## 3. Data Model Reference

### 3.1 `Question` (as returned by `GET /api/pool`)

| Field | Type | Always present | Description |
|---|---|---|---|
| `id` | `String` (CUID) | ✅ | Unique question ID. Send this back as `questionId` when submitting. |
| `conceptTag` | `String` | ✅ | Machine-readable concept, e.g. `"biodiversity_threats"`. Useful for analytics and "topics to revise" screens. |
| `familyId` | `String` | ✅ | Groups a primary with its backup, e.g. `"fam_patterns"`. |
| `role` | `"primary"` \| `"backup"` | ✅ | Which list the question belongs to. |
| `difficultyScore` | `int` (0–100) | ✅ | Numeric difficulty. Primaries arrive sorted by this **ascending** (easy → hard). |
| `difficultyLabel` | `String` | ✅ | Human-readable difficulty. Seen values: `"easy"`, `"medium"`, `"hard"`. |
| `marks` | `int` | ✅ | Marks the question is worth. Currently `1` for every question. **The server score does not use this field** (see §5.4). |
| `content` | `QuestionContent` | ✅ | What gets rendered on screen. See below. |

### 3.2 `QuestionContent`

| Field | Type | Description |
|---|---|---|
| `questionText` | `String` | Plain-text question stem. Always render this. |
| `questionLatex` | `String` | LaTeX version of the question. **Often an empty string `""`**. Render it (e.g. with `flutter_math_fork`) only when it's non-empty. |
| `options` | `List<String>` | Answer choices. Currently always 4, but **use `options.length`, don't hard-code 4**. The user's choice is sent as a **0-based index** into this list. |

> ⚠️ **Don't shuffle `options` on the client** unless you map the index back. The server grades against the original index order.
>
> ⚠️ Key order inside `content` can vary (`options` may come before `questionText`). Parse by key, never by position.

### 3.3 `SubmitResultItem` (as returned by `POST /api/submit`)

| Field | Type | Description |
|---|---|---|
| `questionId` | `String` | The question that was graded. |
| `chosenOptionIndex` | `int` | Echo of what the user picked. |
| `isCorrect` | `bool` | Whether the pick was right. |
| `correctOptionIndex` | `int` | The index of the correct option. Use it to highlight the right answer. |
| `explanation` | `String` | Short explanation for the review screen. |

---

## 4. Endpoint: `GET /api/pool`

Fetches the question pool for one subtopic (chapter).

### 4.1 Request

```
GET /api/pool?subtopicId={subtopicId}
```

| Param | In | Type | Required | Rules |
|---|---|---|---|---|
| `subtopicId` | query | `String` | ✅ | Must be a CUID: starts with `c`, followed by 23–31 letters/digits (regex `^c[0-9a-z]{23,31}$`, case-insensitive). |

**Example:**
```
GET http://localhost:4000/api/pool?subtopicId=clx9k2p0b0000abcd1234efgh
```

### 4.2 Success response — `200 OK`

Here's an actual response from the server (Biodiversity & Conservation subtopic):

```json
{
    "subtopicId": "clx9k2p0b0000abcd1234efgh",
    "primary": [
        {
            "id": "cmwrzd9h60008igp57dgsk6xf",
            "conceptTag": "biodiversity_value",
            "familyId": "fam_value",
            "role": "primary",
            "difficultyScore": 22,
            "difficultyLabel": "easy",
            "marks": 1,
            "content": {
                "options": [
                    "Only aesthetic value.",
                    "Essential for ecological stability and human survival.",
                    "Only endangered animals matter.",
                    "Cannot coexist with development."
                ],
                "questionText": "Which statement best summarizes the chapter?",
                "questionLatex": ""
            }
        },
        {
            "id": "cmwrzd9h90009igp5q0jv5r6d",
            "conceptTag": "biodiversity_threats",
            "familyId": "fam_threats",
            "role": "primary",
            "difficultyScore": 30,
            "difficultyLabel": "easy",
            "marks": 1,
            "content": {
                "options": [
                    "Habitat loss, overexploitation, invasive species, co-extinctions.",
                    "Pollution, climate change, overpopulation, war.",
                    "Deforestation, mining, damming, grazing.",
                    "Hunting, fishing, logging, farming."
                ],
                "questionText": "The 'evil quartet' of biodiversity loss refers to which four threats?",
                "questionLatex": ""
            }
        },
        {
            "id": "cmwrzd9hb000aigp5buxh7q9u",
            "conceptTag": "biodiversity_patterns",
            "familyId": "fam_patterns",
            "role": "primary",
            "difficultyScore": 45,
            "difficultyLabel": "medium",
            "marks": 1,
            "content": {
                "options": ["S = cA^z", "S = cA", "S = c + A", "S = c/A"],
                "questionText": "Species-area relationship is described by which equation?",
                "questionLatex": ""
            }
        },
        {
            "id": "cmwrzd9hd000bigp59so6stuy",
            "conceptTag": "biodiversity_hotspots",
            "familyId": "fam_hotspots",
            "role": "primary",
            "difficultyScore": 58,
            "difficultyLabel": "medium",
            "marks": 1,
            "content": {
                "options": [
                    "High endemism",
                    "High threat of habitat loss",
                    "Maximum species richness",
                    "Island isolation"
                ],
                "questionText": "Which is NOT a biodiversity hotspot criterion?",
                "questionLatex": ""
            }
        },
        {
            "id": "cmwrzd9hf000cigp5mgfzjlmm",
            "conceptTag": "conservation_strategies",
            "familyId": "fam_conservation",
            "role": "primary",
            "difficultyScore": 72,
            "difficultyLabel": "hard",
            "marks": 1,
            "content": {
                "options": [
                    "Conserving species in their natural habitat.",
                    "Conserving species in zoos.",
                    "Conserving seeds in a bank.",
                    "Conserving species in botanical gardens."
                ],
                "questionText": "In-situ conservation means:",
                "questionLatex": ""
            }
        },
        {
            "id": "cmwrzd9hg000digp5euzxl6uw",
            "conceptTag": "conservation_treaties",
            "familyId": "fam_treaties",
            "role": "primary",
            "difficultyScore": 85,
            "difficultyLabel": "hard",
            "marks": 1,
            "content": {
                "options": [
                    "Wetlands and migratory birds.",
                    "Trade in endangered species.",
                    "Biodiversity at the genetic level.",
                    "Climate change mitigation."
                ],
                "questionText": "The Ramsar Convention focuses on:",
                "questionLatex": ""
            }
        }
    ],
    "backup": [
        {
            "id": "cmwrzd9hi000eigp5hr2nugoh",
            "conceptTag": "biodiversity_value",
            "familyId": "fam_value",
            "role": "backup",
            "difficultyScore": 18,
            "difficultyLabel": "easy",
            "marks": 1,
            "content": {
                "options": [
                    "Ecosystem services.",
                    "Food and medicine.",
                    "Climate regulation.",
                    "Nutrient cycling."
                ],
                "questionText": "Biodiversity provides which 'direct' economic benefit?",
                "questionLatex": ""
            }
        },
        {
            "id": "cmwrzd9hl000figp5qyfiqd04",
            "conceptTag": "biodiversity_patterns",
            "familyId": "fam_patterns",
            "role": "backup",
            "difficultyScore": 55,
            "difficultyLabel": "medium",
            "marks": 1,
            "content": {
                "options": [
                    "Lower endemism.",
                    "Faster species turnover with area.",
                    "No relationship.",
                    "Uniform distribution."
                ],
                "questionText": "In the species-area curve, a steeper slope z suggests:",
                "questionLatex": ""
            }
        },
        {
            "id": "cmwrzd9hm000gigp5qiu9co0i",
            "conceptTag": "conservation_strategies",
            "familyId": "fam_conservation",
            "role": "backup",
            "difficultyScore": 68,
            "difficultyLabel": "medium",
            "marks": 1,
            "content": {
                "options": [
                    "Biosphere reserve.",
                    "National park.",
                    "Cryopreservation of gametes.",
                    "Sacred grove."
                ],
                "questionText": "Which is an ex-situ conservation method?",
                "questionLatex": ""
            }
        }
    ]
}
```

### 4.3 What the client can rely on

| Guarantee | Detail |
|---|---|
| `primary.length == 6` | Always, on a `200`. If the subtopic has fewer than 6 primaries, the server returns `409 INSUFFICIENT_PRIMARIES` instead. |
| `primary` is sorted by `difficultyScore` ascending | It's a gentle easy → hard ramp. Show primaries **in the order received**. |
| `0 <= backup.length <= 3` | The list can be **empty**. |
| `backup` order is **not** guaranteed | Look backups up by `familyId`, never by index. |
| A family has **at most one** backup in practice | In the example, `fam_value`, `fam_patterns` and `fam_conservation` have backups. `fam_threats`, `fam_hotspots` and `fam_treaties` **don't**. |
| No `answer`, `correctOptionIndex` or `explanation` | These fields are deliberately left out of the pool response. |

**Primary ↔ backup mapping in the example above:**

| Primary (`familyId`) | Difficulty | Backup available? |
|---|---|---|
| `fam_value` | 22 · easy | ✅ `cmwrzd9hi000eigp5hr2nugoh` |
| `fam_threats` | 30 · easy | ❌ |
| `fam_patterns` | 45 · medium | ✅ `cmwrzd9hl000figp5qyfiqd04` |
| `fam_hotspots` | 58 · medium | ❌ |
| `fam_conservation` | 72 · hard | ✅ `cmwrzd9hm000gigp5qiu9co0i` |
| `fam_treaties` | 85 · hard | ❌ |

### 4.4 Possible errors

| Status | Code | When |
|---|---|---|
| `400` | `BAD_SUBTOPIC_ID` | `subtopicId` is missing, empty, or not CUID-shaped. |
| `404` | `SUBTOPIC_NOT_FOUND` | The ID looks valid but no subtopic exists with it. |
| `409` | `INSUFFICIENT_PRIMARIES` | The subtopic exists but has fewer than 6 primary questions (a content problem, not a client bug). |

---

## 5. Endpoint: `POST /api/submit`

Grades a batch of answers, stores them as attempts, and returns the score plus per-question feedback.

### 5.1 Request

```
POST /api/submit
Content-Type: application/json
```

```json
{
    "subtopicId": "clx9k2p0b0000abcd1234efgh",
    "sessionKey": "550e8400-e29b-41d4-a716-446655440000",
    "answers": [
        { "questionId": "cmwrzd9h60008igp57dgsk6xf", "chosenOptionIndex": 1 },
        { "questionId": "cmwrzd9h90009igp5q0jv5r6d", "chosenOptionIndex": 0 }
    ]
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `subtopicId` | `String` | ✅ | CUID. Must be the **same** subtopic the questions came from. |
| `sessionKey` | `String` \| `null` | ❌ Optional | Any string. Recommended: a UUID v4 generated once per app install or quiz session (use the `uuid` package). Used **only for analytics** to group attempts; it's not auth. If you send it, it must be a string or `null`. A number or object is rejected. |
| `answers` | `List<Answer>` | ✅ | Non-empty array. |
| `answers[].questionId` | `String` | ✅ | CUID. Must belong to `subtopicId`. **No duplicates within one request.** |
| `answers[].chosenOptionIndex` | `int` | ✅ | JSON integer (not a string, not `1.5`). Must satisfy `0 <= index < options.length` for that question. |

**Things that are allowed:**
- **Submitting a subset.** You don't have to send all 6 primaries. Any non-empty set of valid questions works (Test 2 below sends 6 answers, including one backup, with one primary left out).
- **Mixing primaries and backups** in the same request (Test 1 below sends all 9).
- **Any order.** The response mirrors whatever order you send.
- **Resubmitting a question in a later request.** The duplicate check only applies *within* a single request.

**Things that are not supported:**
- Marking a question as skipped or unanswered with `null`. If the user skipped a question, **leave it out** of `answers`.

### 5.2 Success response — `200 OK`

```json
{
    "subtopicId": "clx9k2p0b0000abcd1234efgh",
    "submissionId": "sub_9c4770fa-efd0-4b5f-8eb0-acc0d3436105",
    "score": {
        "correct": 1,
        "total": 2
    },
    "results": [
        {
            "questionId": "cmwrzd9h60008igp57dgsk6xf",
            "chosenOptionIndex": 1,
            "isCorrect": true,
            "correctOptionIndex": 1,
            "explanation": "The textbook emphasizes ecological stability and human survival as the core value."
        },
        {
            "questionId": "cmwrzd9h90009igp5q0jv5r6d",
            "chosenOptionIndex": 0,
            "isCorrect": true,
            "correctOptionIndex": 0,
            "explanation": "Habitat loss, overexploitation, alien species, and co-extinctions form the evil quartet."
        }
    ]
}
```

| Field | Type | Description |
|---|---|---|
| `subtopicId` | `String` | Echo of the request. |
| `submissionId` | `String` | Unique ID for this graded batch, formatted `sub_<uuid>`. **A new one is generated on every call.** Store it if you want to reference this attempt later. |
| `score.correct` | `int` | Number of answers that were correct. |
| `score.total` | `int` | Number of answers **you submitted** (not always 6). |
| `results` | `List<SubmitResultItem>` | One entry per submitted answer, **in the same order as your `answers` array**. |

### 5.3 Real test outputs from the server

These are three actual runs against the sample subtopic. They show the behaviour the client can depend on.

<details>
<summary><b>Test 1: all 9 questions (6 primary + 3 backup) → 5 / 9</b></summary>

```json
{
    "subtopicId": "clx9k2p0b0000abcd1234efgh",
    "submissionId": "sub_9c4770fa-efd0-4b5f-8eb0-acc0d3436105",
    "score": { "correct": 5, "total": 9 },
    "results": [
        { "questionId": "cmwrzd9h60008igp57dgsk6xf", "chosenOptionIndex": 1, "isCorrect": true,  "correctOptionIndex": 1, "explanation": "The textbook emphasizes ecological stability and human survival as the core value." },
        { "questionId": "cmwrzd9h90009igp5q0jv5r6d", "chosenOptionIndex": 2, "isCorrect": false, "correctOptionIndex": 0, "explanation": "Habitat loss, overexploitation, alien species, and co-extinctions form the evil quartet." },
        { "questionId": "cmwrzd9hb000aigp5buxh7q9u", "chosenOptionIndex": 0, "isCorrect": true,  "correctOptionIndex": 0, "explanation": "S = cA^z, where z is the slope (0.1–0.2 within a region)." },
        { "questionId": "cmwrzd9hd000bigp59so6stuy", "chosenOptionIndex": 1, "isCorrect": false, "correctOptionIndex": 3, "explanation": "Hotspots need high endemism and high threat; island isolation is not a criterion." },
        { "questionId": "cmwrzd9hf000cigp5mgfzjlmm", "chosenOptionIndex": 0, "isCorrect": true,  "correctOptionIndex": 0, "explanation": "In-situ = in the natural habitat. Ex-situ = outside it." },
        { "questionId": "cmwrzd9hg000digp5euzxl6uw", "chosenOptionIndex": 1, "isCorrect": false, "correctOptionIndex": 0, "explanation": "Ramsar (1971) protects wetlands, especially as waterfowl habitat." },
        { "questionId": "cmwrzd9hi000eigp5hr2nugoh", "chosenOptionIndex": 1, "isCorrect": true,  "correctOptionIndex": 1, "explanation": "Direct benefits include food, medicine, and industrial products." },
        { "questionId": "cmwrzd9hl000figp5qyfiqd04", "chosenOptionIndex": 1, "isCorrect": true,  "correctOptionIndex": 1, "explanation": "Higher z means species richness grows faster with area, typical of islands." },
        { "questionId": "cmwrzd9hm000gigp5qiu9co0i", "chosenOptionIndex": 1, "isCorrect": false, "correctOptionIndex": 2, "explanation": "Cryopreservation is ex-situ: it preserves genetic material outside the natural habitat." }
    ]
}
```
</details>

<details>
<summary><b>Test 2: 6 answers, custom order, one primary left out, one backup included → 5 / 6</b></summary>

What this run shows: (a) results come back in **request order** (the threats question was sent first, so it's returned first), (b) `total` counts submitted answers, and (c) primaries can be left out and backups mixed in.

```json
{
    "subtopicId": "clx9k2p0b0000abcd1234efgh",
    "submissionId": "sub_4283f6b3-0398-4b10-9a34-9a6a96ec205b",
    "score": { "correct": 5, "total": 6 },
    "results": [
        { "questionId": "cmwrzd9h90009igp5q0jv5r6d", "chosenOptionIndex": 0, "isCorrect": true,  "correctOptionIndex": 0, "explanation": "Habitat loss, overexploitation, alien species, and co-extinctions form the evil quartet." },
        { "questionId": "cmwrzd9h60008igp57dgsk6xf", "chosenOptionIndex": 0, "isCorrect": false, "correctOptionIndex": 1, "explanation": "The textbook emphasizes ecological stability and human survival as the core value." },
        { "questionId": "cmwrzd9hb000aigp5buxh7q9u", "chosenOptionIndex": 0, "isCorrect": true,  "correctOptionIndex": 0, "explanation": "S = cA^z, where z is the slope (0.1–0.2 within a region)." },
        { "questionId": "cmwrzd9hd000bigp59so6stuy", "chosenOptionIndex": 3, "isCorrect": true,  "correctOptionIndex": 3, "explanation": "Hotspots need high endemism and high threat; island isolation is not a criterion." },
        { "questionId": "cmwrzd9hf000cigp5mgfzjlmm", "chosenOptionIndex": 0, "isCorrect": true,  "correctOptionIndex": 0, "explanation": "In-situ = in the natural habitat. Ex-situ = outside it." },
        { "questionId": "cmwrzd9hi000eigp5hr2nugoh", "chosenOptionIndex": 1, "isCorrect": true,  "correctOptionIndex": 1, "explanation": "Direct benefits include food, medicine, and industrial products." }
    ]
}
```
</details>

<details>
<summary><b>Test 3: all 9 wrong → 0 / 9</b></summary>

```json
{
    "subtopicId": "clx9k2p0b0000abcd1234efgh",
    "submissionId": "sub_41ccc816-29d1-45de-b0a5-5508708bc30c",
    "score": { "correct": 0, "total": 9 },
    "results": [
        { "questionId": "cmwrzd9h60008igp57dgsk6xf", "chosenOptionIndex": 0, "isCorrect": false, "correctOptionIndex": 1, "explanation": "The textbook emphasizes ecological stability and human survival as the core value." },
        { "questionId": "cmwrzd9h90009igp5q0jv5r6d", "chosenOptionIndex": 1, "isCorrect": false, "correctOptionIndex": 0, "explanation": "Habitat loss, overexploitation, alien species, and co-extinctions form the evil quartet." },
        { "questionId": "cmwrzd9hb000aigp5buxh7q9u", "chosenOptionIndex": 1, "isCorrect": false, "correctOptionIndex": 0, "explanation": "S = cA^z, where z is the slope (0.1–0.2 within a region)." },
        { "questionId": "cmwrzd9hd000bigp59so6stuy", "chosenOptionIndex": 0, "isCorrect": false, "correctOptionIndex": 3, "explanation": "Hotspots need high endemism and high threat; island isolation is not a criterion." },
        { "questionId": "cmwrzd9hf000cigp5mgfzjlmm", "chosenOptionIndex": 1, "isCorrect": false, "correctOptionIndex": 0, "explanation": "In-situ = in the natural habitat. Ex-situ = outside it." },
        { "questionId": "cmwrzd9hg000digp5euzxl6uw", "chosenOptionIndex": 2, "isCorrect": false, "correctOptionIndex": 0, "explanation": "Ramsar (1971) protects wetlands, especially as waterfowl habitat." },
        { "questionId": "cmwrzd9hi000eigp5hr2nugoh", "chosenOptionIndex": 0, "isCorrect": false, "correctOptionIndex": 1, "explanation": "Direct benefits include food, medicine, and industrial products." },
        { "questionId": "cmwrzd9hl000figp5qyfiqd04", "chosenOptionIndex": 0, "isCorrect": false, "correctOptionIndex": 1, "explanation": "Higher z means species richness grows faster with area, typical of islands." },
        { "questionId": "cmwrzd9hm000gigp5qiu9co0i", "chosenOptionIndex": 0, "isCorrect": false, "correctOptionIndex": 2, "explanation": "Cryopreservation is ex-situ: it preserves genetic material outside the natural habitat." }
    ]
}
```
</details>

### 5.4 Scoring notes

- `score.correct` is a **count of correct answers**, not a marks total. Every question is currently worth `marks: 1`, so the two are the same today. If weighted marks are needed later, compute `sum(marks where isCorrect)` on the client by joining `results` with the pool.
- If you send primaries and backups together, `total` includes both. For a clean "score out of 6" on the main quiz, **submit the 6 primaries on their own first** (see §7).

### 5.5 All-or-nothing behaviour

Validation runs **before** anything is saved. If even one answer is invalid, the **whole request fails**: no results come back and **no attempts are stored**. Fix the payload and resend the whole batch.

### 5.6 Possible errors

The server checks in this order and returns the **first** failure it hits:

| # | Status | Code | Trigger |
|---|---|---|---|
| 1 | `400` | `BAD_SUBTOPIC_ID` | `subtopicId` is missing, not a string, or not CUID-shaped. **Also happens if you forget `Content-Type: application/json`**, because the body arrives empty. |
| 2 | `400` | `BAD_SESSION_KEY` | `sessionKey` is present but isn't a string or `null` (e.g. a number). |
| 3 | `400` | `EMPTY_ANSWERS` | `answers` is missing, not an array, or `[]`. |
| 4 | `400` | `BAD_ANSWER_ITEM` | An item is `null`, `questionId` isn't a CUID string, or `chosenOptionIndex` isn't an integer number (e.g. `"1"`, `1.5`, `null`). |
| 5 | `400` | `DUPLICATE_QUESTION_ID` | The same `questionId` appears twice in this request. |
| 6 | `404` | `SUBTOPIC_NOT_FOUND` | Valid ID, but the subtopic doesn't exist. |
| 7 | `404` | `QUESTION_NOT_IN_SUBTOPIC` | At least one `questionId` doesn't exist or belongs to a different subtopic. |
| 8 | `400` | `INDEX_OUT_OF_RANGE` | `chosenOptionIndex < 0` or `>= options.length`. The message names the first offending question, e.g. `"chosenOptionIndex out of range for question cmwrzd9h60008igp57dgsk6xf"`. |

---

## 6. Error Handling

### 6.1 Standard error envelope

Every **known** error (the codes in §4.4 and §5.6) comes back as JSON in this shape:

```json
{
    "error": {
        "code": "ERROR_CODE",
        "message": "Human readable description of the error"
    }
}
```

**Branch on `error.code`, never on `message`.** The message text may change.

### 6.2 Master error table

| Code | HTTP | Endpoint(s) | Meaning | What the Flutter app should do |
|---|---|---|---|---|
| `BAD_SUBTOPIC_ID` | 400 | pool, submit | `subtopicId` is malformed or missing. | Developer bug: log it. Show a generic "Something went wrong" screen. |
| `SUBTOPIC_NOT_FOUND` | 404 | pool, submit | No such chapter. | Show a **"Quiz not found"** screen with a back button. |
| `INSUFFICIENT_PRIMARIES` | 409 | pool | Chapter has fewer than 6 primary questions. | Show **"This quiz isn't ready yet"** and report it to the content team. |
| `BAD_SESSION_KEY` | 400 | submit | `sessionKey` has the wrong type. | Developer bug: send a `String` or leave it out. |
| `EMPTY_ANSWERS` | 400 | submit | No answers sent. | Disable the Submit button until there's at least 1 answer. |
| `BAD_ANSWER_ITEM` | 400 | submit | Payload shape is wrong. | Developer bug: check `questionId` is a String and `chosenOptionIndex` is an `int`. |
| `DUPLICATE_QUESTION_ID` | 400 | submit | Same question twice. | Store answers in a `Map<questionId, index>` so this can't happen. |
| `QUESTION_NOT_IN_SUBTOPIC` | 404 | submit | Question is from another chapter or the ID is stale. | Only submit IDs from the pool you fetched for **this** `subtopicId`. If content was re-seeded, refetch the pool. |
| `INDEX_OUT_OF_RANGE` | 400 | submit | Option index is out of bounds. | Only ever send indices `0 … options.length - 1`. |

### 6.3 Non-standard failures (also handle these)

Some failures **won't** use the JSON envelope above:

| Situation | What you'll see | How to handle it |
|---|---|---|
| Malformed JSON body (syntax error) | `400`, usually an **HTML/text** body from Express | Treat any non-JSON body as a generic error. Wrap `jsonDecode` in try/catch. |
| Body larger than 50 KB | `413 Payload Too Large`, non-JSON | Shouldn't happen with normal quizzes. Generic error. |
| Unexpected server/DB error | `500` with a non-JSON body, **or the request may hang** | Always set a **timeout** (e.g. 15 s) on HTTP calls and show a retry option. |
| Server down / wrong IP / cleartext blocked | `SocketException` / `ClientException` | Show "Can't reach server. Check your connection" plus a Retry button. |

> **Retrying `POST /submit`:** each call creates a new `submissionId` and new attempt rows. If a submit timed out but actually reached the server, retrying will **record the attempt twice** (fine for the user, but it slightly skews analytics). Retry only on explicit user action, not in a silent loop.

---

## 7. Recommended Quiz Flow (Client-Side)

The server grades only on submit, so the client **can't know mid-quiz** whether an answer was wrong. Backup questions therefore can't be spliced in during the first pass. Use this two-phase flow instead.

```
┌──────────────────────────┐
│ 1. GET /api/pool          │  store primary[6] + backup[0..3]
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│ 2. MAIN QUIZ              │  show primary[0..5] in order received
│    (6 primary questions)  │  record { questionId → chosenIndex } locally
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│ 3. POST /api/submit       │  send ONLY the 6 primary answers
│    (primaries only)       │  → score "x / 6" + results[]
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│ 4. RESULTS SCREEN         │  per question: ✓/✗, highlight
│                           │  correctOptionIndex, show explanation
└────────────┬─────────────┘
             ▼
     For each WRONG primary:
     does backup[] contain the same familyId?
        │                         │
       YES                        NO
        ▼                         ▼
┌──────────────────────┐   ┌───────────────────────────┐
│ 5. RETRY PHASE        │   │ Show explanation only     │
│ show matching backups │   │ ("Revise this concept")   │
└──────────┬───────────┘   └───────────────────────────┘
           ▼
┌──────────────────────────┐
│ 6. POST /api/submit       │  send ONLY the backup answers
│    (backups only)         │  → separate score + explanations
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│ 7. FINAL SUMMARY          │  e.g. "Main: 4/6 · Retry: 2/2"
└──────────────────────────┘
```

### Step-by-step

1. **Fetch the pool.** Call `GET /api/pool?subtopicId=…` and keep `primary` and `backup` in state.
2. **Build a backup lookup.** `Map<String familyId, Question> backupByFamily`.
3. **Run the main quiz.** Present `primary` in the order received (easy → hard). On each tap, save `answers[q.id] = tappedIndex`. Don't reveal right or wrong yet, because the client doesn't know.
4. **Submit primaries.** Send the 6 answers and keep `submissionId`, `score`, and `results`.
5. **Show the results.** For each result, look up the original question by `questionId` to show its text and options. Mark `chosenOptionIndex` red or green and `correctOptionIndex` green, and show `explanation`.
6. **Work out the retry set.**
   ```
   retry = results
       .where((r) => !r.isCorrect)
       .map((r) => primaryById[r.questionId]!.familyId)
       .where(backupByFamily.containsKey)
       .map((fam) => backupByFamily[fam]!)
   ```
   - If `retry` is empty, skip straight to the summary (all correct, or no backups for the missed concepts).
   - For wrong primaries **without** a backup, show the explanation and the `conceptTag` as "concept to revise".
7. **Retry phase.** Present the backup questions, collect answers, and `POST /api/submit` again with **only** those backups.
8. **Final summary.** Combine both submissions for the user, e.g. "Main quiz 4/6 · Second chance 2/2", and list concepts to revise by `conceptTag`.

> **Why submit primaries and backups separately?** It keeps the main score cleanly "out of 6", gives you two `submissionId`s (first try vs. second chance) for analytics, and the backend supports it with no extra work.

> **Dynamic mid-quiz re-queueing** (instantly inserting a backup right after a wrong answer) isn't possible with this backend. The old per-answer `/api/answer` endpoint has been **removed**. If product needs that behaviour, talk to the backend team. One option is to submit **one answer at a time** to `/api/submit` (it accepts a 1-item array), which gives instant feedback but creates one `submissionId` per answer.

---

## 8. Dart / Flutter Reference Code

This is a minimal, dependency-light reference. It uses the `http` package and the `uuid` package for `sessionKey`.

```yaml
# pubspec.yaml
dependencies:
  http: ^1.2.0
  uuid: ^4.0.0
```

### 8.1 Models

```dart
// lib/quiz/models.dart

class QuestionContent {
  final String questionText;
  final String questionLatex; // may be ""
  final List<String> options;

  QuestionContent({
    required this.questionText,
    required this.questionLatex,
    required this.options,
  });

  bool get hasLatex => questionLatex.trim().isNotEmpty;

  factory QuestionContent.fromJson(Map<String, dynamic> j) => QuestionContent(
        questionText: j['questionText'] as String? ?? '',
        questionLatex: j['questionLatex'] as String? ?? '',
        options: (j['options'] as List).map((e) => e as String).toList(),
      );
}

class Question {
  final String id;
  final String conceptTag;
  final String familyId;
  final String role; // "primary" | "backup"
  final int difficultyScore;
  final String difficultyLabel; // "easy" | "medium" | "hard"
  final int marks;
  final QuestionContent content;

  Question({
    required this.id,
    required this.conceptTag,
    required this.familyId,
    required this.role,
    required this.difficultyScore,
    required this.difficultyLabel,
    required this.marks,
    required this.content,
  });

  bool get isPrimary => role == 'primary';

  factory Question.fromJson(Map<String, dynamic> j) => Question(
        id: j['id'] as String,
        conceptTag: j['conceptTag'] as String,
        familyId: j['familyId'] as String,
        role: j['role'] as String,
        difficultyScore: (j['difficultyScore'] as num).toInt(),
        difficultyLabel: j['difficultyLabel'] as String,
        marks: (j['marks'] as num).toInt(),
        content: QuestionContent.fromJson(j['content'] as Map<String, dynamic>),
      );
}

class QuizPool {
  final String subtopicId;
  final List<Question> primary; // always 6
  final List<Question> backup;  // 0..3, unordered

  QuizPool({required this.subtopicId, required this.primary, required this.backup});

  /// familyId -> backup question (look up by family, never by index)
  Map<String, Question> get backupByFamily =>
      {for (final b in backup) b.familyId: b};

  factory QuizPool.fromJson(Map<String, dynamic> j) => QuizPool(
        subtopicId: j['subtopicId'] as String,
        primary: (j['primary'] as List)
            .map((e) => Question.fromJson(e as Map<String, dynamic>))
            .toList(),
        backup: (j['backup'] as List)
            .map((e) => Question.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class SubmittedAnswer {
  final String questionId;
  final int chosenOptionIndex;

  SubmittedAnswer(this.questionId, this.chosenOptionIndex);

  Map<String, dynamic> toJson() =>
      {'questionId': questionId, 'chosenOptionIndex': chosenOptionIndex};
}

class SubmitResultItem {
  final String questionId;
  final int chosenOptionIndex;
  final bool isCorrect;
  final int correctOptionIndex;
  final String explanation;

  SubmitResultItem({
    required this.questionId,
    required this.chosenOptionIndex,
    required this.isCorrect,
    required this.correctOptionIndex,
    required this.explanation,
  });

  factory SubmitResultItem.fromJson(Map<String, dynamic> j) => SubmitResultItem(
        questionId: j['questionId'] as String,
        chosenOptionIndex: (j['chosenOptionIndex'] as num).toInt(),
        isCorrect: j['isCorrect'] as bool,
        correctOptionIndex: (j['correctOptionIndex'] as num).toInt(),
        explanation: j['explanation'] as String? ?? '',
      );
}

class SubmitResponse {
  final String subtopicId;
  final String submissionId;
  final int correct;
  final int total;
  final List<SubmitResultItem> results; // same order as request

  SubmitResponse({
    required this.subtopicId,
    required this.submissionId,
    required this.correct,
    required this.total,
    required this.results,
  });

  factory SubmitResponse.fromJson(Map<String, dynamic> j) => SubmitResponse(
        subtopicId: j['subtopicId'] as String,
        submissionId: j['submissionId'] as String,
        correct: (j['score']['correct'] as num).toInt(),
        total: (j['score']['total'] as num).toInt(),
        results: (j['results'] as List)
            .map((e) => SubmitResultItem.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}
```

### 8.2 API client with error mapping

```dart
// lib/quiz/api_client.dart
import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'models.dart';

class ApiException implements Exception {
  final int? status;
  final String code;    // e.g. "SUBTOPIC_NOT_FOUND", or "NETWORK" / "UNKNOWN"
  final String message;
  ApiException(this.status, this.code, this.message);
  @override
  String toString() => 'ApiException($status, $code): $message';
}

class QuizApiClient {
  // Android emulator: http://10.0.2.2:4000/api
  final String baseUrl;
  final http.Client _http;
  final Duration timeout;

  QuizApiClient({
    this.baseUrl = 'http://localhost:4000/api',
    http.Client? client,
    this.timeout = const Duration(seconds: 15),
  }) : _http = client ?? http.Client();

  Future<QuizPool> fetchPool(String subtopicId) async {
    final uri = Uri.parse('$baseUrl/pool')
        .replace(queryParameters: {'subtopicId': subtopicId});
    final res = await _send(() => _http.get(uri));
    return QuizPool.fromJson(res);
  }

  Future<SubmitResponse> submit({
    required String subtopicId,
    required List<SubmittedAnswer> answers,
    String? sessionKey,
  }) async {
    final body = jsonEncode({
      'subtopicId': subtopicId,
      if (sessionKey != null) 'sessionKey': sessionKey,
      'answers': answers.map((a) => a.toJson()).toList(),
    });
    final res = await _send(() => _http.post(
          Uri.parse('$baseUrl/submit'),
          headers: {'Content-Type': 'application/json'}, // required!
          body: body,
        ));
    return SubmitResponse.fromJson(res);
  }

  Future<Map<String, dynamic>> _send(Future<http.Response> Function() call) async {
    http.Response res;
    try {
      res = await call().timeout(timeout);
    } on TimeoutException {
      throw ApiException(null, 'TIMEOUT', 'Server took too long to respond');
    } catch (e) {
      throw ApiException(null, 'NETWORK', 'Cannot reach server: $e');
    }

    dynamic decoded;
    try {
      decoded = jsonDecode(res.body);
    } catch (_) {
      decoded = null; // non-JSON body (e.g. Express HTML error page)
    }

    if (res.statusCode >= 200 && res.statusCode < 300 && decoded is Map<String, dynamic>) {
      return decoded;
    }

    if (decoded is Map && decoded['error'] is Map) {
      final err = decoded['error'] as Map;
      throw ApiException(
        res.statusCode,
        err['code']?.toString() ?? 'UNKNOWN',
        err['message']?.toString() ?? 'Unknown error',
      );
    }
    throw ApiException(res.statusCode, 'UNKNOWN', 'Unexpected server response');
  }
}
```

### 8.3 Using it (two-phase flow)

```dart
import 'package:uuid/uuid.dart';

final api = QuizApiClient(baseUrl: 'http://10.0.2.2:4000/api');
final sessionKey = const Uuid().v4(); // generate once per session/install

// 1. Fetch
final pool = await api.fetchPool(subtopicId);

// 2. Main quiz: collect answers in a Map to avoid DUPLICATE_QUESTION_ID
final Map<String, int> mainAnswers = {}; // questionId -> chosen index
// ...on tap: mainAnswers[question.id] = tappedIndex;

// 3. Submit primaries only
final mainResult = await api.submit(
  subtopicId: pool.subtopicId,
  sessionKey: sessionKey,
  answers: mainAnswers.entries.map((e) => SubmittedAnswer(e.key, e.value)).toList(),
);

// 4. Figure out which backups to offer
final primaryById = {for (final q in pool.primary) q.id: q};
final backupByFamily = pool.backupByFamily;

final retryQuestions = mainResult.results
    .where((r) => !r.isCorrect)
    .map((r) => primaryById[r.questionId]!.familyId)
    .where(backupByFamily.containsKey)
    .map((fam) => backupByFamily[fam]!)
    .toList();

final conceptsToRevise = mainResult.results
    .where((r) => !r.isCorrect)
    .map((r) => primaryById[r.questionId]!.conceptTag)
    .toSet();

// 5. Retry phase (only if retryQuestions.isNotEmpty)
final Map<String, int> retryAnswers = {};
// ...collect answers for retryQuestions...
if (retryAnswers.isNotEmpty) {
  final retryResult = await api.submit(
    subtopicId: pool.subtopicId,
    sessionKey: sessionKey,
    answers: retryAnswers.entries.map((e) => SubmittedAnswer(e.key, e.value)).toList(),
  );
  // show "Second chance: ${retryResult.correct}/${retryResult.total}"
}
```

### 8.4 Mapping errors to UI

```dart
try {
  final pool = await api.fetchPool(subtopicId);
  // ...
} on ApiException catch (e) {
  switch (e.code) {
    case 'SUBTOPIC_NOT_FOUND':
      showQuizNotFound();
      break;
    case 'INSUFFICIENT_PRIMARIES':
      showQuizNotReady();
      break;
    case 'NETWORK':
    case 'TIMEOUT':
      showOfflineWithRetry();
      break;
    default:
      // BAD_* / DUPLICATE_* / INDEX_OUT_OF_RANGE / QUESTION_NOT_IN_SUBTOPIC
      // are client bugs: log e and show a generic error.
      showGenericError();
  }
}
```

---

## 9. Testing with cURL / Postman

**Fetch the pool:**
```bash
curl "http://localhost:4000/api/pool?subtopicId=clx9k2p0b0000abcd1234efgh"
```

**Submit answers:**
```bash
curl -X POST "http://localhost:4000/api/submit" \
  -H "Content-Type: application/json" \
  -d '{
    "subtopicId": "clx9k2p0b0000abcd1234efgh",
    "sessionKey": "550e8400-e29b-41d4-a716-446655440000",
    "answers": [
      { "questionId": "cmwrzd9h60008igp57dgsk6xf", "chosenOptionIndex": 1 },
      { "questionId": "cmwrzd9h90009igp5q0jv5r6d", "chosenOptionIndex": 0 }
    ]
  }'
```

**Edge cases to try, with the responses the server actually returned:**

| Test | Payload change | Response |
|---|---|---|
| Empty answers | `"answers": []` | `400 {"error":{"code":"EMPTY_ANSWERS","message":"answers must be a non-empty array"}}` |
| Duplicate question | Same `questionId` twice | `400 {"error":{"code":"DUPLICATE_QUESTION_ID","message":"answers contain duplicate questionId"}}` |
| Bad index | `"chosenOptionIndex": 7` | `400 {"error":{"code":"INDEX_OUT_OF_RANGE","message":"chosenOptionIndex out of range for question cmwrzd9h60008igp57dgsk6xf"}}` |
| Foreign question | `questionId` from another subtopic, or a non-existent valid-looking CUID | `404 {"error":{"code":"QUESTION_NOT_IN_SUBTOPIC","message":"One or more questionIds do not exist in this subtopic"}}` |
| Bad item shape | `"chosenOptionIndex": "1"` or a non-CUID `questionId` | `400 {"error":{"code":"BAD_ANSWER_ITEM","message":"each answer needs a cuid questionId and integer chosenOptionIndex"}}` |
| Bad subtopic | `"subtopicId": "abc"` | `400 {"error":{"code":"BAD_SUBTOPIC_ID","message":"subtopicId must be a cuid"}}` |


### Endpoint summary

| Method | Path | Purpose | Success | Error codes |
|---|---|---|---|---|
| `GET` | `/api/pool?subtopicId=` | Fetch 6 primary + ≤3 backup questions (no answers) | `200` | `BAD_SUBTOPIC_ID`, `SUBTOPIC_NOT_FOUND`, `INSUFFICIENT_PRIMARIES` |
| `POST` | `/api/submit` | Grade a batch, store attempts, return score and explanations | `200` | `BAD_SUBTOPIC_ID`, `BAD_SESSION_KEY`, `EMPTY_ANSWERS`, `BAD_ANSWER_ITEM`, `DUPLICATE_QUESTION_ID`, `SUBTOPIC_NOT_FOUND`, `QUESTION_NOT_IN_SUBTOPIC`, `INDEX_OUT_OF_RANGE` |
