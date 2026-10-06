# KHFM — one app, one login

KHFM Report, KHFM Tracker and KHFM Tender Tracker in **one Render service**,
with one sign-in page for everyone.

| Address | What it is |
|---|---|
| `/login` | Sign in (User or Admin) |
| `/` | Home: the apps you can open. Admins also get **Users & access** |
| `/report/` | KHFM Report |
| `/tracker/` | KHFM Tracker (Housekeeping & Pest Control) |
| `/tenders/` | KHFM Tender Tracker |

All data is kept in your existing Postgres database
(`khfm-tender-tracker-db-prod`): tenders and price bids (already there),
Report and Tracker data, bill PDFs, logins. **No Render disk is needed.**

## Who can do what

Each person gets their own username and password. On the home page an admin
picks, per person and per app:

- **Report:** No access, Full access, Payroll, or Procurement (same sections as before)
- **Tracker:** No access, Full access, Housekeeping, or Pest Control
- **Tenders:** No access, Admin (can delete), or Entry (add/edit)
- **Admin** tick box: full access to everything, plus managing logins

## Deploy on Render

**1. Put this code on GitHub**
- On github.com click **+ → New repository**, name it `khfm-hub`, click **Create repository**.
- Click **uploading an existing file**, drag in everything from this folder
  (`server.js`, `db.js`, `store.js`, `auth.js`, `package.json`,
  `package-lock.json`, `seed_data.json`, `README.md`, `.gitignore`, and the
  `apps` and `public` folders), then **Commit changes**.

**2. Create the new service**
- Render → **New + → Web Service** → pick `khfm-hub`.
- Build Command `npm install`, Start Command `npm start`, instance type **Starter**.
- Under **Environment Variables** add:

| Key | Value |
|---|---|
| `DATABASE_URL` | Copy it from your **khfm-tender-tracker** service → Environment (or from the database's **Internal Database URL**) |
| `SESSION_SECRET` | Click **Generate** |
| `ADMIN_USERNAME` | The username for your first admin login, e.g. `admin` |
| `ADMIN_PASSWORD` | A strong password for that login |

- Click **Create Web Service** and wait for the log line `KHFM running on port …`.

**3. Copy your data over (once)**
- Open the new address (e.g. `https://khfm-hub.onrender.com`), choose **Admin**, sign in.
- Under **Move data from the old apps**, enter the old Report app's
  full-access password and click **Copy Report data**. Do the same for the
  Tracker with its Dashboard password. Bill PDFs come across too.
- Tenders need no copying: they're read straight from the same database.

**4. Add your team** under **Users & access**, check everything looks right,
then share the new address.

**5. Switch off the old services** (this is where the saving starts)
- Delete the web services `khfm-report`, `khfm-tracker` and `khfm-tender-tracker`
  (their disks go with them).
- **Do NOT delete the database `khfm-tender-tracker-db-prod`**: the new app uses it.

Expected cost: one Starter service (~$7/month) + the existing database
(~$10.50/month) ≈ **$17.50/month**, down from about $31.

## Backups
Report and Tracker each still have **Access & backup → Download backup**
(admins). The database itself is backed up by Render.

## Running locally
```
npm install
DATABASE_URL=postgres://… SESSION_SECRET=anything ADMIN_PASSWORD=… npm start
```
