<div align="center">

<img src="assets/brand/sdc-lockup.png" alt="Skill Development Council Karachi" height="96">

# SDC Learn

**The online learning platform of Skill Development Council Karachi**

Live Zoom classes · recorded sessions · resources · assignments · certificates — in one place.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/Vanilla_JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js_20+-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-optional-3FCF8E?style=flat-square&logo=supabase&logoColor=white)
![Tests](https://img.shields.io/badge/UI_workflows-29_passing-2EA44F?style=flat-square)
![No build](https://img.shields.io/badge/build_step-none-0F3D6E?style=flat-square)

[Quick start](#-quick-start) · [Features](#-features) · [Screenshots](#-screenshots) · [Architecture](#-architecture) · [Roles & permissions](#-roles--permissions) · [Docs](#-documentation)

</div>

---

## ✨ Overview

SDC Learn turns SDC Karachi's training programmes — diplomas, certificates, workshops and short courses — into a modern online experience. It follows the [Business Requirements Document](docs/BRD_SDC_Online_Learning_Platform.md) and is built with plain HTML, CSS and JavaScript plus a small Express server, so it runs anywhere with no build step.

| 🎓 Learners | 🧑‍🏫 Instructors | 🛡️ Coordinators |
|---|---|---|
| Attend live classes, rewatch recordings, download resources, submit assignments, track progress and earn verifiable certificates | Build courses session by session, share material, grade submissions, take attendance and publish results | Run the catalogue, enrollments, people, **roles & permissions**, fees, certificates, reports and every platform setting |

---

## 🚀 Quick start

```bash
npm install
```

```bash
npm start
```

Open **http://localhost:3000** and use a demo account (password `Demo@123`):

| Role | Email | What you'll see |
|---|---|---|
| 🛡️ Coordinator | `admin@sdclearn.demo` | Full console and settings |
| 🧑‍🏫 Instructor | `instructor@sdclearn.demo` | Their courses, grading, attendance |
| 🎓 Learner | `learner@sdclearn.demo` | My Courses — one class is live today |
| 💼 Accounts Officer | `accounts@sdclearn.demo` | A custom role limited to fees |

Live: **https://ead-university-portal-ten.vercel.app** · Full setup, Google sign-in, environment variables and deployment: **[SETUP.md](SETUP.md)** · Walkthroughs and troubleshooting: **[RUN.md](RUN.md)**

---

## 🧩 Features

<table>
<tr>
<td width="50%" valign="top">

### 🎓 Learning experience
- **My Courses** with progress, "Live today" and "Due soon" cards
- Sessions grouped by module with status badges — *Upcoming · Today · Available · Completed · Locked*
- Embedded recordings (YouTube, Vimeo, Google Drive, MP4)
- Downloadable resources, prev/next, **mark as complete**
- **Zoom** panel (join link, meeting ID, passcode, copy) and **Help** panel on every course page
- Course outline with outcomes and module roadmap
- Drag-and-drop **assignment submission**, replace until graded
- Calendar, attendance, results, certificates, fees, messages

</td>
<td width="50%" valign="top">

### 🛠️ Teaching & administration
- **Course builder** — sessions, recordings, resources, per-session Zoom, assignments, reordering
- Grading with marks, quick feedback and notifications
- Attendance per session with bulk marking
- Weighted results with configurable grade bands
- Enrollments with **full or per-session access**
- Certificates with **public verification** page
- Fees, announcements, messaging, reports & CSV exports
- Backup, restore and demo reset

</td>
</tr>
<tr>
<td valign="top">

### 🔐 Roles & permissions
- **Sign in with Google** (via Supabase Auth) or email & password
- Create unlimited roles; full create / edit / duplicate / delete
- **20 modules × view · create · edit · delete · publish**
- **Course access**: all, assigned, enrolled or hand-picked courses
- Menus, pages and buttons adapt automatically

</td>
<td valign="top">

### 🎨 Configurable without code
- Branding, logos, contact details, colours, light/dark theme
- **Terminology** — rename Learner, Course, Session, Batch…
- Upload limits & file types, late policy, attendance threshold
- Result weights, pass mark, certificate rules
- Program types, levels, delivery modes, fee types
- Feature toggles for every optional module

</td>
</tr>
</table>

---

## 📸 Screenshots

| Sign in | My Courses |
|---|---|
| ![Sign in](docs/screenshots/login.png) | ![My Courses](docs/screenshots/learner-courses.png) |
| **Course home** | **Session page** |
| ![Course home](docs/screenshots/course-home.png) | ![Session](docs/screenshots/session.png) |
| **Assignment submission** | **Coordinator dashboard** |
| ![Submit assignment](docs/screenshots/submit.png) | ![Dashboard](docs/screenshots/admin-dashboard.png) |
| **Course builder** | **Roles & permissions** |
| ![Course builder](docs/screenshots/course-builder.png) | ![Roles](docs/screenshots/roles.png) |
| **Dark mode** | **Mobile** |
| ![Dark mode](docs/screenshots/dark-mode.png) | <img src="docs/screenshots/mobile-course.png" width="48%" alt="Mobile course"> <img src="docs/screenshots/mobile-login.png" width="48%" alt="Mobile sign in"> |

---

## 🏗️ Architecture

```mermaid
flowchart TB
    subgraph Users["👥 Users"]
        direction LR
        L["🎓 Learner"]
        I["🧑‍🏫 Instructor"]
        C["🛡️ Coordinator"]
    end

    subgraph Browser["🌐 Browser app — Vanilla JS, no build step"]
        direction LR
        P["📄 Pages<br/>login · app · verify"]
        S["🧭 shell.js<br/>router · menu · top bar"]
        PG["🧩 pages-*.js<br/>learn · manage · users · ops"]
        CORE["⚙️ core.js<br/>store · settings · permissions<br/>auth · domain rules · UI kit"]
        LS[("💾 localStorage<br/>sdcLearnDB_v1")]
        P --> S --> PG --> CORE --> LS
    end

    subgraph Server["🖥️ Express server"]
        direction LR
        ST["Static pages"]
        UP["POST /api/lms/uploads<br/>type & size validation"]
        FS[("📁 backend/uploads")]
        UP --> FS
    end

    subgraph Cloud["☁️ External services"]
        direction LR
        SB[("Supabase<br/>shared state row")]
        ZM["🎥 Zoom"]
        VID["▶️ YouTube · Vimeo · Drive"]
    end

    Users --> P
    P -. served by .-> ST
    PG -- uploads --> UP
    CORE <-- "cloud-sync.js" --> SB
    PG -. join links .-> ZM
    PG -. embeds .-> VID

    classDef user fill:#FFF7E0,stroke:#C9A227,color:#3B2F00
    classDef app fill:#E8F0FA,stroke:#0F3D6E,color:#0B2545
    classDef data fill:#E6F4F1,stroke:#0F766E,color:#063B36
    classDef ext fill:#F3F4F6,stroke:#9CA3AF,color:#1F2937
    class L,I,C user
    class P,S,PG,CORE,ST,UP app
    class LS,FS,SB data
    class ZM,VID ext
    style Users fill:#FFFDF5,stroke:#E5D7A3
    style Browser fill:#F7FAFD,stroke:#B9CBE3
    style Server fill:#F7FAFD,stroke:#B9CBE3
    style Cloud fill:#F9FAFB,stroke:#D1D5DB
```

**Key design choices**

| | Choice | Why |
|---|---|---|
| ⚡ | **Browser-first data** — one JSON state in `localStorage` | Instant UI, works offline and from any static host |
| ☁️ | **Optional Supabase mirror** | Shared data across devices without writing an API |
| 🧱 | **No framework, no bundler** | Easy to host, audit and hand over; matches the original stack |
| 📁 | **Server only for files** | Browsers can't store shared uploads; everything else stays client-side |
| 🔐 | **One permission function (`can`)** | Menus, routes and buttons all ask the same question |

### Page structure

```mermaid
flowchart TB
    A["app.html"] --> SH["App shell<br/>sidebar · top bar · notifications"]
    SH --> R{"#/route"}
    R --> LRN["🎓 Learn<br/>/courses · /course/:id<br/>/session · /outline · /submit"]
    R --> MAN["📚 Catalogue<br/>/manage/courses · /programs<br/>/divisions · /batches"]
    R --> PPL["👥 People<br/>/learners · /instructors · /users<br/>/enrollments · /roles"]
    R --> DEL["📋 Delivery<br/>/submissions · /attendance<br/>/results · /certificates · /fees"]
    R --> SYS["⚙️ System<br/>/dashboard · /reports · /settings<br/>/announcements · /messages"]

    classDef shell fill:#0F3D6E,stroke:#0F3D6E,color:#FFFFFF
    classDef area fill:#E8F0FA,stroke:#0F3D6E,color:#0B2545
    class A,SH shell
    class LRN,MAN,PPL,DEL,SYS area
```

---

## 🔐 Roles & permissions

Every role combines an **experience**, a **course access scope** and a **permission matrix**. The same check decides what appears in the menu, which pages open and which buttons show.

```mermaid
flowchart LR
    U["👤 User"] --> RO["Role"]
    RO --> EX["Experience<br/>staff · instructor · learner portal"]
    RO --> SC["Course access<br/>all · assigned · enrolled · selected"]
    RO --> PM["Permissions<br/>module × view/create/edit/delete/publish"]
    EX --> LAYOUT["Layout & home page"]
    SC --> VIS["Visible courses →<br/>sessions · learners · submissions<br/>attendance · results · announcements"]
    PM --> GATE{"can(module, action)?"}
    GATE -- yes --> SHOW["Menu item · page · button"]
    GATE -- no --> HIDE["Hidden / 'Page not available'"]

    classDef role fill:#E8F0FA,stroke:#0F3D6E,color:#0B2545
    classDef ok fill:#E6F4F1,stroke:#0F766E,color:#063B36
    classDef no fill:#FDECE6,stroke:#C2410C,color:#5A1E05
    class U,RO,EX,SC,PM role
    class SHOW,LAYOUT,VIS ok
    class HIDE no
```

| Built-in role | Experience | Course access | Highlights |
|---|---|---|---|
| 🛡️ Coordinator | Staff console | All | Full access — locked so no one can be locked out |
| 🧑‍🏫 Instructor | Instructor console | Assigned | Edit own courses, grade, attendance, results |
| 🎓 Learner | Learner portal | Enrolled | Learn, submit, view own progress |
| 💼 Accounts Officer *(example custom)* | Staff console | All | Fees, read-only learners, reports |

---

## 🔄 Key flow — submitting an assignment

```mermaid
sequenceDiagram
    autonumber
    actor L as 🎓 Learner
    participant UI as Submit page
    participant API as Express /api/lms/uploads
    participant DB as Store (localStorage ⇄ Supabase)
    actor I as 🧑‍🏫 Instructor

    L->>UI: Choose assignment, confirm email, drop file
    UI->>UI: Check email, file type & size, deadline / late policy
    UI->>API: POST file
    API->>API: Validate extension & size, save with random name
    API-->>UI: { url, fileName, size }
    UI->>DB: Save submission (previous version kept in history)
    UI->>DB: Notify course instructors
    UI-->>L: Confirmation receipt
    I->>DB: Grade with marks & feedback
    DB-->>L: "Assignment graded" notification
```

---

## 🗂️ Data model

```mermaid
erDiagram
    ROLE ||--o{ USER : assigns
    DIVISION ||--o{ PROGRAM : owns
    PROGRAM ||--o{ COURSE : groups
    COURSE ||--o{ SESSION : contains
    COURSE ||--o{ BATCH : runs
    COURSE ||--o{ ASSIGNMENT : sets
    SESSION ||--o{ ASSIGNMENT : "linked to"
    USER ||--o{ ENROLLMENT : "learner in"
    COURSE ||--o{ ENROLLMENT : has
    BATCH ||--o{ ENROLLMENT : seats
    ASSIGNMENT ||--o{ SUBMISSION : receives
    USER ||--o{ SUBMISSION : uploads
    SESSION ||--o{ ATTENDANCE : records
    USER ||--o{ PROGRESS : tracks
    USER ||--o{ RESULT : earns
    USER ||--o{ CERTIFICATE : holds
    USER ||--o{ FEE : owes

    ROLE {
        string base "admin | teacher | student"
        string courseScope
        object permissions
    }
    COURSE {
        string title
        string programType
        string delivery
        string status
        object zoom
        string helpUrl
    }
    SESSION {
        int order
        string moduleName
        date date
        string videoUrl
        array resources
    }
    ENROLLMENT {
        string accessMode "full | restricted"
        array allowedSessionIds
        string status
    }
    SUBMISSION {
        string fileUrl
        string status
        number grade
        array history
    }
```

Full field reference: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md#data-model)

---

## 📁 Project structure

```
📦 SDC Learn
├── 📄 login.html · app.html · verify.html · index.html
├── 🎨 css/app.css                 design system — tokens, light/dark, responsive
├── 📜 js/
│   ├── core.js                    store · settings · roles & permissions · auth · UI kit
│   ├── shell.js                   router · permission-aware menu · top bar
│   ├── pages-learn.js             learner course delivery
│   ├── pages-manage.js            courses · sessions · enrollments · catalogue
│   ├── pages-users.js             accounts · roles & permissions
│   ├── pages-ops.js               dashboards · grading · attendance · results · fees · settings
│   ├── seed.js                    demo catalogue (dates relative to today)
│   ├── login.js                   animated sign-in
│   └── cloud-config.js · cloud-sync.js   optional Supabase sync
├── 🖥️ backend/server.js           Express — static pages · validated uploads · health
├── 🖼️ assets/brand · assets/resources
├── 🧪 tests/core.test.js · tests/e2e.browser.js
└── 📚 docs/IMPLEMENTATION.md · BRD · screenshots
```

---

## 🧪 Testing

| Suite | Command | Covers |
|---|---|---|
| Logic | `npm test` | Permissions, course scoping, grading, restricted access, password hashing |
| Syntax | `npm run check` | Every script parses |
| UI workflows | browser console — see [RUN.md](RUN.md#tests) | **29 end-to-end workflows** across every module and role, driving real clicks and forms |

---

## 🔒 Security notes

- Passwords are stored only as **salted, iterated SHA-256 hashes**.
- Uploads are validated **on the server** (extension + size), stored under random names and served as downloads with `nosniff`.
- Permission checks run in the browser: they control the experience but are **not a server-side boundary**. For public deployments, follow [supabase/PRODUCTION_SECURITY_NOTES.md](supabase/PRODUCTION_SECURITY_NOTES.md) and the [production checklist](SETUP.md#9-production-checklist).

---

## 📚 Documentation

| | Document | Contents |
|---|---|---|
| ⚙️ | [SETUP.md](SETUP.md) | Install, environment variables, Settings, Supabase, Neon, deploy to Render / Vercel, production checklist |
| ▶️ | [RUN.md](RUN.md) | Running, demo walkthroughs per role, tests, troubleshooting |
| 🏗️ | [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) | Architecture, file map, data model, permission engine, routes, extending |
| 📋 | [docs/BRD](docs/BRD_SDC_Online_Learning_Platform.md) | Business requirements |

---

<div align="center">

<img src="assets/brand/sdc-logo.png" alt="SDC" height="40">

**Skill Development Council Karachi**
Est. 1995 · National Training Ordinance 1980 / 2002 · MoFEPT, Government of Pakistan

📞 (021) 99334387, 99334388 · ✉️ sdckar@sdckarachi.org.pk · 🌐 [sdckarachi.org.pk](https://sdckarachi.org.pk/)

</div>
