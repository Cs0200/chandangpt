# Free deployment: GitHub + Cloudflare

GitHub keeps the source code. Cloudflare runs the application and database. This application cannot run on GitHub Pages because it needs server-side code; GitHub Pages also prohibits commercial SaaS hosting.

There is no cost incurred by running the app locally. Cloudflare's free plan is subject to usage limits; confirm the plan and current terms during signup. Do not enable paid Workers plans, paid add-ons or overage billing for this pilot. A free `workers.dev` address is sufficient; no domain purchase is needed.

## 1. Save the source on GitHub

Create a **private** repository called `clinicsync`. Add a README to initialize its `main` branch. Upload the project source; exclude `node_modules`, `.data`, `.wrangler` and any credentials. The code is portable; you own the repository.

## 2. Create your Cloudflare account

Open https://dash.cloudflare.com/sign-up, create a free account and verify your email yourself. Do not share your password or verification code with the assistant. We can walk through this together after the application is ready.

## 3. Install the deployment tool and sign in

In the project folder:

```sh
npm ci
npx wrangler login
```

Wrangler opens a browser. Review and authorize the required Cloudflare permissions yourself. This is your hosting account; no Cloudflare secret belongs in source code or chat.

## 4. Create the database

```sh
npx wrangler d1 create clinicsync-db
```

Copy the returned `database_id`. It is an identifier, not a password. Configure it:

```sh
npm run configure -- YOUR_RETURNED_DATABASE_ID
npm run db:migrate
```

The configure command updates `wrangler.jsonc`; commit that change. Do not invent the database ID. If the database already exists, reuse its ID instead of creating another one.

## 5. Create your first owner account

In `wrangler.jsonc`, temporarily change `ALLOW_SIGNUP` from `"false"` to `"true"`.

```sh
npm run check
npm test
npm run deploy
```

Wrangler prints the deployed URL. Open it, select **Create clinic**, and create your owner account with a unique password. No email is sent by this application. Initially use fictional patients.

Then change `ALLOW_SIGNUP` back to `"false"` and deploy again:

```sh
npm run deploy
```

Existing users can sign in; new clinic registration is now closed. You may temporarily reopen registration for a controlled pilot signup. This switch does not affect a clinic's patient-booking setting.

## 6. Enable your platform administration screen

After you have registered, find your own user ID using the CLI:

```sh
npx wrangler d1 execute clinicsync-db --remote --command "SELECT id, name, email, role FROM users WHERE role='owner';"
```

Identify your own account. Add `PLATFORM_ADMIN_USER_ID` to the `vars` object in `wrangler.jsonc`, using that exact ID, and redeploy. Do not set it to an email address or an arbitrary clinic owner. The **Platform** screen then lets that account view clinic counts and update subscription records. This does not collect payments or enforce automatic subscription suspension.

## 7. Test using separate devices

1. Owner: set branding and add doctors.
2. Create receptionist and doctor accounts; privately share their initial credentials.
3. Sign in on another device using a staff account.
4. Book a fictional appointment, check it in and start the session.
5. Open its private patient link on your phone.
6. Open the cabin display link on another screen.
7. Tap Complete & Next and allow up to 10 seconds for other visible screens to sync.
8. Test a break, priority patient, no-show and recall.
9. Test a second clinic account to verify isolation.
10. Disconnect a device; confirm the connection warning appears.

Public booking pages show clinic branding; patient links show one appointment. Display links show token numbers but no patient names. No app installation is required.

## 8. Optional deployment from GitHub Actions

The repository includes `Deploy to Cloudflare`, triggered manually from GitHub's **Actions** tab. It does not deploy automatically on every commit.

Before enabling it:

- Save a correctly configured `database_id` in `wrangler.jsonc`.
- In GitHub, create a `production` environment and add any deployment review rules you want.
- Create a Cloudflare API token restricted to the relevant account with the permissions required for Workers deployment and D1 migrations.
- Store the token as GitHub Actions secret `CLOUDFLARE_API_TOKEN` and your account identifier as `CLOUDFLARE_ACCOUNT_ID`.
- Never paste either into a committed file.
- Run the workflow manually. Verify its success and open the exact URL it returns.

The workflow runs tests, applies migrations, then deploys. Future migrations must be appended rather than editing an already applied migration.

## Backups

Local: run `npm run backup`. The consistent SQLite snapshot is written under `.data/backups/`. Copy backups to a private location. Test restoration using a separate copy of the application before relying on it.

Hosted: use Cloudflare D1's supported export/restore tools and retention features. Export a private backup before schema changes:

```sh
npx wrangler d1 export clinicsync-db --remote --output /YOUR/PRIVATE/PATH/clinicsync-backup.sql
```

This file contains sensitive records. Do not commit or upload it to the repository. Establish and test a recovery procedure before using real patient data.

## If something fails

- `REPLACE_WITH_YOUR_D1_DATABASE_ID`: finish step 4.
- “Registration is closed”: temporarily enable signup for onboarding, then close it again.
- “Please sign in”: sessions expire after 12 hours; sign in again.
- “Queue changed on another device”: review the new current patient; do not blindly repeat the action.
- “No next patient”: check in a waiting patient first.
- A free-tier limit is reached: stop and assess usage; do not switch to a paid plan automatically.
- Forgotten owner password: stop and contact the operator for identity-checked database recovery. Self-service email recovery is not part of this pilot.

Official references:

- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/workers/wrangler/commands/
