# EAD UNIVERSITY — University Management Portal

## Project Overview

EAD University Management Portal is a modern, responsive, role-based university management **frontend prototype** developed to demonstrate key academic and administrative workflows in a single web application.

The system provides separate interfaces for:

- **Administrator**
- **Teacher / Instructor**
- **Student**

The application is built using **HTML5, CSS3, and Vanilla JavaScript**. For the current frontend prototype, application data is managed in the browser through JavaScript and persistent **LocalStorage**. No external backend server or production database is required to demonstrate the included frontend functionality.

> **Presentation note:** This project should be presented as a functional frontend prototype with browser-based data persistence. A server-side backend and production database can be added as a future deployment phase.

---

## Key Features

### Authentication and Role Access

- Role-based login for Admin, Teacher, and Student users
- Clickable demo credentials for quick access
- Password field hidden by default with visibility control where available
- Login validation and error handling
- Session handling in the frontend
- Role-based page access and logout functionality

### Admin Portal

The administrative area includes pages and interfaces for managing:

- Dashboard and statistics
- Students
- Teachers
- Departments
- Programs
- Subjects / Courses
- Classes and sections
- Timetable
- Attendance
- Assignments
- Examinations
- Results
- Fees
- Announcements
- Messages
- Notifications
- Reports
- Settings
- Profile

### Teacher Portal

Teachers can access interfaces related to:

- Dashboard
- Profile
- Subjects
- Classes
- Students
- Timetable
- Attendance
- Assignments
- Examinations
- Results and grades
- Announcements
- Messages
- Notifications

### Student Portal

Students can access interfaces for:

- Dashboard
- Profile
- Courses
- Teachers
- Timetable
- Attendance
- Assignments and submissions
- Examinations
- Results and grades
- Fees
- Announcements
- Messages
- Notifications

---

## Technology Stack

| Layer | Technology |
|---|---|
| Structure | HTML5 |
| Styling | CSS3 |
| Application Logic | Vanilla JavaScript |
| Data Persistence | Browser LocalStorage |
| Charts / Dashboard Visuals | Frontend CSS, SVG, Canvas, or JavaScript implementation where included |
| Responsive Design | CSS media queries and mobile-first layouts |

---

## Design and User Experience

The EAD University interface uses a professional academic visual identity based on:

- Dark olive and olive green
- Brown and dark brown
- Warm beige and cream backgrounds
- Muted gold accents
- Accessible status colors

The design includes responsive cards, navigation sidebars, forms, tables, modals, notifications, status badges, dashboard elements, and mobile-friendly layouts.

The application is designed to adapt across mobile, tablet, laptop, and desktop screen sizes.

---

## Data Persistence

The current project uses a centralized JavaScript data layer with browser LocalStorage.

This means that supported changes made through the application can remain available after a page refresh in the same browser.

Examples of data handled by the frontend data system include, depending on the implemented page and workflow:

- Users
- Students
- Teachers
- Departments
- Programs
- Subjects
- Classes
- Attendance records
- Assignments
- Results
- Fees
- Announcements
- Messages
- Notifications

### Important Limitation

Because this is a frontend-only implementation, LocalStorage data belongs to the browser where the application is running. Clearing browser site data or LocalStorage may remove saved application data.

---

## Project Structure

```text
EAD-University-Portal
│
├── index.html
├── login.html
├── README.md
├── RUN.md
│
├── admin/                 # Administrator portal pages
├── teacher/               # Teacher portal pages
├── student/               # Student portal pages
│
├── css/                   # Stylesheets and responsive design
│   ├── variables.css
│   ├── style.css
│   ├── dashboard.css
│   ├── forms.css
│   ├── tables.css
│   ├── modals.css
│   ├── floating-widgets.css
│   └── responsive.css
│
├── js/                    # Application JavaScript modules
│   ├── auth.js
│   ├── database.js
│   ├── seed-data.js
│   ├── layout.js
│   ├── app.js
│   ├── assignments.js
│   ├── attendance.js
│   ├── results.js
│   ├── fees.js
│   ├── announcements.js
│   ├── messages.js
│   ├── notifications.js
│   ├── reports.js
│   ├── validation.js
│   └── utilities.js
│
└── assets/                # Images, icons, and supporting assets
```

---

## Demo Accounts

Use the following credentials to access the role-based portals:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@ead.edu` | `admin123` |
| Teacher | `teacher@ead.edu` | `teacher123` |
| Student | `student@ead.edu` | `student123` |

The login page also provides clickable demo credential options for convenient testing.

---

## How to Run the Project

For the simplest method, follow the instructions in **RUN.md**.

In summary:

1. Extract the project ZIP file.
2. Open the project folder.
3. Open `index.html` or run the project using a local static server.
4. Open the application in a modern web browser.
5. Use one of the demo accounts to begin testing.

For the best development and presentation experience, a local static server such as VS Code Live Server is recommended.

---

## Recommended Testing Areas

For a focused demonstration or partial testing cycle, the following workflows are recommended:

1. Login as Admin and test navigation.
2. Test student management functions.
3. Login as Teacher and test assignments or attendance.
4. Login as Student and verify academic information.
5. Test logout and role-based access.
6. Test the interface on a mobile-sized viewport.

These workflows provide practical coverage of the main roles and core application features.

---

## Browser Requirements

For the best experience, use the latest version of one of the following browsers:

- Google Chrome
- Microsoft Edge
- Mozilla Firefox

JavaScript must be enabled because the application's interactive functionality depends on JavaScript.

---

## Future Enhancement Opportunities

The current implementation provides a frontend foundation that can be extended into a production system by adding:

- Node.js / Express backend
- REST or GraphQL API
- MySQL or PostgreSQL database
- Server-side authentication
- Password hashing
- Production-grade authorization
- Cloud file storage
- Email and push notifications
- Online payment gateway integration
- Automated backups and audit logs

---

## Conclusion

EAD University Management Portal demonstrates a comprehensive role-based frontend approach to university administration and academic management. The project combines modern responsive design with dynamic JavaScript functionality and browser-based data persistence, providing a practical prototype for demonstrations, testing, and future full-stack development.


# PostgreSQL Cloud Integration (Supabase)

This version adds a Supabase PostgreSQL integration while preserving the existing frontend interface and JavaScript workflow. Supabase was selected because the project is a browser-based Vanilla JavaScript application and Supabase provides a PostgreSQL database, browser client, Data API, and Row Level Security support.

## Integration files
- `js/supabase-config.js` — project URL and browser-safe publishable/anon key configuration
- `js/supabase-db.js` — LocalStorage-to-PostgreSQL synchronization bridge
- `supabase/schema.sql` — PostgreSQL table and prototype RLS policies
- `SUPABASE_SETUP.md` — exact setup and verification instructions

The current implementation keeps LocalStorage as an immediate cache so the previously working frontend remains responsive. After configuration, supported data changes are synchronized to the Supabase PostgreSQL `ead_app_state` row. If cloud configuration is missing or the network is unavailable, the application continues in LocalStorage fallback mode.

> Security note: Never place a Supabase service-role or secret key in frontend JavaScript. The included prototype schema uses demonstration policies for the shared state row. Production deployment requires Supabase Auth and strict Row Level Security policies.


---

## 2026 Interface Enhancements

The latest update adds a **Teal + Black dark mode**, a persistent theme switcher, collapsible dashboard activity scaffolding, collapsible navigation groups, a notification bell dropdown with unread-state controls, a route loading overlay, profile-picture upload with LocalStorage persistence, and table/board scheduling views. The EAD branding remains unchanged and the existing role-based university workflows continue to use the same frontend data flow and Supabase bridge.

### Optional Authentication Providers

The login screen now includes Google and passkey entry points. These are intentionally configuration-aware: **Google OAuth must be enabled in Supabase Auth before it can authenticate users**, and **production passkeys require a backend WebAuthn challenge endpoint**. The standard Admin, Teacher and Student login flow remains available without additional provider configuration.

## Latest Interaction Updates
- The portal now shows an EAD loading screen over the main content area during initial loading and page navigation, while the persistent sidebar/topbar scaffold remains visible.
- The standalone sidebar arrow has been removed. Click the EAD University brand area to collapse or expand the navigation scaffold.
- Generic data tables now use a compact Table / Board dropdown positioned at the top-right. Board cards show only the primary name and academic summary, and clicking a card opens the remaining record details in a dialog. Timetable retains its dedicated weekly board and table controls.
- Google sign-in uses Supabase Auth and completes the callback by mapping an authorized EAD email to the appropriate portal role. Google must be enabled in the connected Supabase project.
- Passkeys use the WebAuthn API and the included Node/Express backend. Set up a passkey from Profile → Set Up Passkey, then use Sign in with Passkey on the login page. Run the project with `npm install` followed by `npm start` for passkey functionality.


## Final Integration Status
The presentation build includes the frontend implementation for dark mode, EAD clickable scaffolding, table/board views, profile image selection, notification dropdowns, page-transition loading, Google OAuth controls, and WebAuthn passkeys. Real Google OAuth requires a Supabase project with Google enabled and the correct Google Cloud redirect URI. Real passkeys require the included Node.js server and registration of a passkey on the user's device. These are normal external-service setup requirements and do not change the portal's frontend design.
