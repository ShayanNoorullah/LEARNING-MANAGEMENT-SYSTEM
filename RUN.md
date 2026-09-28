# RUN GUIDE — EAD UNIVERSITY MANAGEMENT PORTAL

This guide explains how to run and demonstrate the current **functional EAD University Management Portal**, including the optional WebAuthn passkey flow.

## 1. Extract the Project

1. Right-click the project ZIP file.
2. Select **Extract All** or use your preferred extraction tool.
3. Open the extracted `ead-university` project folder.

---

## 2. Recommended Method: Run the Express server (required for Passkeys)

This is the recommended method for development, testing, and presentations.

### Step 1: Open the Project

Open **Visual Studio Code** and select the extracted `EAD_University_Final` folder.

### Step 2: Install dependencies

Open a terminal in the project root and run:

```bash
npm install
```

### Step 3: Start the portal

```bash
npm start
```

Open:

```text
http://localhost:3000
```

This is the recommended way to test the complete project because the Express server also provides the WebAuthn passkey API.

---

## 3. Alternative Method: VS Code Live Server (frontend-only)

For a quick demonstration:

1. Open the extracted project folder.
2. Double-click `index.html`.

The website should open in your default browser.

> This frontend-only method is suitable for normal portal navigation, but **passkey setup/sign-in requires `npm start`** because WebAuthn registration and verification use the Express API.

---

## 4. Demo Login Credentials

The login page contains clickable demo credential options. You can click the appropriate role to automatically populate the login fields.

### Administrator

```text
Email: admin@ead.edu
Password: admin123
```

### Teacher

```text
Email: teacher@ead.edu
Password: teacher123
```

### Student

```text
Email: student@ead.edu
Password: student123
```

After selecting a demo account, click **Login**.

---

## 5. Passkey Setup and Sign-In

Passkeys are implemented with WebAuthn and are functional when the portal is opened through the Express server.

1. Run `npm install` and `npm start`.
2. Open `http://localhost:3000`.
3. Sign in with a demo account.
4. Open **Profile → Passkey Sign-In → Set Up Passkey**.
5. Confirm the current portal password when prompted.
6. Complete the browser/device passkey prompt (Windows Hello, fingerprint, face recognition, or device screen lock).
7. Return to the login page and choose **Sign in with Passkey**.
8. Select the same role/email when needed and complete the device verification.

For production HTTPS hosting, configure `PUBLIC_URL`/`WEBAUTHN_ORIGIN` and `WEBAUTHN_RP_ID` in the environment. Do not use a static `file://` page for passkeys.

## 6. Quick Demonstration Flow

For a short presentation, use this sequence:

```text
1. Open the login page
        ↓
2. Demonstrate clickable demo credentials
        ↓
3. Login as Administrator
        ↓
4. Show the Admin Dashboard and management pages
        ↓
5. Login as Teacher
        ↓
6. Show assignments and attendance
        ↓
7. Login as Student
        ↓
8. Show courses, assignments, attendance, and results
        ↓
9. Demonstrate responsive mobile view
```

---

## 7. How Data Is Saved

The portal uses browser LocalStorage for the frontend demo data, while the included Express backend provides server APIs and WebAuthn passkey verification.

This means:

- Changes can remain available after refreshing the page.
- Data is stored locally in the browser.
- Data is not shared automatically with other computers or browsers.

### Resetting Browser Data

If you need a clean testing environment, use your browser's developer tools or site settings to clear LocalStorage/site data for the application, then refresh the page.

**Warning:** Clearing site data may remove changes made during testing.

---

## 8. Recommended Browser

Use one of the following modern browsers:

- Google Chrome (recommended)
- Microsoft Edge
- Mozilla Firefox

Make sure JavaScript is enabled.

---

## 9. Mobile Testing

To test the responsive design in Google Chrome:

1. Open the website.
2. Press `F12` to open Developer Tools.
3. Click the **Toggle Device Toolbar** icon.
4. Test common widths such as:

```text
320px
375px
414px
768px
1024px
```

Check that navigation, cards, forms, tables, and buttons remain usable.

---

## 10. Basic Troubleshooting

### Problem: The page does not work correctly

**Solution:** Run the project through a local static server such as VS Code Live Server instead of opening the HTML file directly.

### Problem: Login does not work

**Solution:** Use the exact demo credentials shown above and ensure JavaScript is enabled.

### Problem: Changes disappear

**Solution:** Check whether browser site data or LocalStorage has been cleared. The current frontend prototype stores supported data locally in the browser.

### Problem: The design looks incorrect

**Solution:** Use an up-to-date version of Chrome, Edge, or Firefox and confirm all project folders remain in their original locations.

---

## 11. Presentation Checklist

Before presenting the project:

- [ ] Extract the project completely.
- [ ] Open the project through a local server.
- [ ] Confirm the login page loads.
- [ ] Test Admin login.
- [ ] Test Teacher login.
- [ ] Test Student login.
- [ ] Confirm the main navigation works.
- [ ] Prepare a few realistic demonstration records.
- [ ] Test the website on a mobile-sized viewport.
- [ ] Keep this RUN guide available for reference.

---

## Important Project Scope

This version is designed as a **functional frontend university management prototype** built with HTML, CSS, and Vanilla JavaScript. It uses browser LocalStorage for client-side data persistence.

The frontend can be demonstrated without Node.js, but the included backend is required for the complete passkey flow.

For a production deployment, a separate backend, secure authentication system, and server-side database should be implemented.

---

## Ready to Begin

Open the project using your preferred method, navigate to the EAD University login page, select one of the clickable demo accounts, and begin exploring the Admin, Teacher, or Student portal.


# Optional Cloud PostgreSQL Setup (Supabase)

The portal still runs immediately as a frontend application. To activate the new PostgreSQL cloud persistence:

1. Create a Supabase project.
2. Open the Supabase SQL Editor and run `supabase/schema.sql`.
3. Open `js/supabase-config.js`.
4. Enter the Supabase Project URL and publishable/anon key.
5. Start the portal using VS Code Live Server.
6. Add or update a record and refresh the page to verify persistence.

If Supabase credentials are not configured, the website automatically continues using LocalStorage, so the existing frontend remains functional.


---

## New Interface Features to Demonstrate

1. Use the moon/sun button in a portal dashboard to switch between the standard interface and the Teal + Black dark mode.
2. Open the notification bell to view notifications and use **Mark all read**.
3. Open a dashboard and click **Active Schedules**, **Pending Actions**, or **Completed Activity** to expand or collapse activity logs.
4. Open **My Profile** and upload a profile image (maximum 2 MB) to test the image preview and browser persistence.
5. Open the timetable and switch between **Board** and **Table** views.
6. The Google and Passkey buttons are optional integrations. Configure Google OAuth in Supabase and a WebAuthn backend challenge before presenting them as production authentication methods.

## For Google Sign-In and Passkeys
For the complete authentication experience, run the project with the included Node server:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

- **Google:** Enable Google in Supabase Authentication → Providers and add the local redirect URL permitted by your Supabase configuration.
- **Passkey:** Log in normally, open **My Profile**, select **Set Up Passkey**, and confirm the current password. Then log out and use **Sign in with Passkey**. Passkeys require the Node server and a secure browser context (`localhost` works for development).


## Presentation Quick Test
1. Run `npm install` once.
2. Run `npm start`.
3. Open `http://localhost:3000`.
4. Test page loading, dark mode, EAD sidebar scaffolding, notification dropdown, Table/Board switching, profile image selection, and the white AK profile mark.
5. For real Google login, complete the Supabase + Google Cloud OAuth setup. For real passkeys, register a passkey from a profile page and then use the Passkey button on the login page.
