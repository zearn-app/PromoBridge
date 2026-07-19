# PromoConnect — Influencer/Brand Promotion Marketplace

A middleman platform connecting influencers and brands: brands browse influencers or post
campaigns, send paid promotion requests, pay via Razorpay, and an admin manually verifies
delivery and releases payouts.

**Stack:** vanilla HTML/CSS/JS + Tailwind (frontend) · Node.js/Express (backend API) ·
Firebase Auth + Firestore + Storage · Razorpay · deployed on Vercel, free tier only.

---

## 1. What's included

- Email/password + Google sign-in, with role selection (influencer / brand). Admins are
  assigned by email allowlist, not self-signup.
- Influencer & brand profile CRUD, influencer gallery.
- Campaign posting and browsing, with filters (niche/location/followers for influencers;
  industry/budget for campaigns).
- Promotion request flow: brand → influencer, accept/decline, in-app + FCM notifications.
- Razorpay payment flow: order creation, signature verification, commission split held by
  the platform, admin-controlled release, influencer withdrawal requests.
- Admin dashboard: platform totals, payment verification/release, withdrawal
  approval/rejection, commission rate control, user activate/deactivate/delete.
- Firestore & Storage security rules, input sanitization (`xss`), rate limiting, `helmet`.

## 2. What you still need to do before going live

This is a complete, working codebase, not a hosted product — you own the last mile:

- **Create the Firebase project** and paste real config into
  `public/js/firebase-config.js` (client keys) and `.env` (Admin SDK service account).
- **Create a Razorpay account**, get test/live keys, put them in `.env`.
- **Set `ADMIN_EMAILS`** in `.env` to the email(s) that should get the admin role on signup.
- **Deploy Firestore/Storage rules** (`firestore.rules`, `storage.rules`) via the Firebase CLI.
- **Test the full flow end-to-end** with Razorpay test mode before accepting real payments.
- Optionally wire up an FCM service worker (`firebase-messaging-sw.js`) for background push
  notifications when the tab isn't open — the current setup sends foreground pushes plus
  reliable in-app notifications stored in Firestore, which covers the core requirement
  without the extra service-worker plumbing.

## 3. Local setup

```bash
git clone <your-repo-url>
cd influencer-platform
npm install
cp .env.example .env   # then fill in real values
npm run dev             # starts the API on http://localhost:5000
```

Open `public/index.html` with a static server (e.g. the VS Code "Live Server" extension, or
`npx serve public`) — the frontend calls `/api/...`, so either proxy it to your Express
server on port 5000, or just run everything through `vercel dev` (see below) which handles
both together.

```bash
npm install -g vercel
vercel dev
```

## 4. Firebase setup

1. Create a project at https://console.firebase.google.com (free "Spark" plan is enough).
2. **Authentication** → Sign-in method → enable **Email/Password** and **Google**.
3. **Firestore Database** → Create database → start in production mode → deploy
   `firestore.rules` (see below).
4. **Storage** → Get started → deploy `storage.rules`.
5. **Project Settings → General → Your apps** → add a Web app → copy the config object into
   `public/js/firebase-config.js`.
6. **Project Settings → Service accounts** → Generate new private key → use the three values
   (`project_id`, `client_email`, `private_key`) to fill `FIREBASE_PROJECT_ID`,
   `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` in `.env`.

Deploy security rules with the Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase init firestore storage   # point at your existing project, keep default file names
firebase deploy --only firestore:rules,storage:rules
```

## 5. Razorpay setup

1. Sign up at https://dashboard.razorpay.com (test mode works with no business verification).
2. **Settings → API Keys** → generate a Key ID + Key Secret → put them in `.env`.
3. The checkout flow in `brand-dashboard.html` uses Razorpay's hosted Checkout.js, so no PCI
   scope touches your server — card data never hits your backend.

## 6. Deploying to Vercel

```bash
npm install -g vercel
vercel login
vercel link
vercel env add FIREBASE_PROJECT_ID
vercel env add FIREBASE_CLIENT_EMAIL
vercel env add FIREBASE_PRIVATE_KEY
vercel env add FIREBASE_STORAGE_BUCKET
vercel env add RAZORPAY_KEY_ID
vercel env add RAZORPAY_KEY_SECRET
vercel env add DEFAULT_COMMISSION_PERCENT
vercel env add ADMIN_EMAILS
vercel env add CORS_ORIGIN
vercel --prod
```

Then connect the same GitHub repo in the Vercel dashboard for automatic deploys on every
push to `main`. `vercel.json` already routes `/api/*` to the Express app and everything else
to the static `public/` folder.

**Note on `FIREBASE_PRIVATE_KEY`:** when pasting into Vercel's env var UI, keep it as one line
with literal `\n` sequences (exactly as it appears in the downloaded JSON) — `firebaseAdmin.js`
converts those back into real newlines at runtime.

## 7. Data model (Firestore)

| Collection      | Purpose                                                             |
|------------------|----------------------------------------------------------------------|
| `users`          | `{uid, email, displayName, role, active}` — role is influencer/brand/admin |
| `influencers`    | Public profile: bio, niche, followerCount, location, gallery[]      |
| `brands`         | Public profile: companyName, industry, budget, logoUrl              |
| `campaigns`      | Brand-posted campaigns: title, description, budget, timeline, status |
| `requests`       | Brand → influencer promotion requests: amount, status, campaignId    |
| `payments`       | Razorpay orders: amount, commissionAmount, influencerShare, status   |
| `withdrawals`    | Influencer payout requests: amount, status                          |
| `notifications`  | In-app notifications per user                                       |
| `settings/commission` | Platform-wide commission percentage                            |

## 8. Payment & payout flow

1. Brand sends a request → influencer accepts.
2. Brand clicks **Pay now** → backend creates a Razorpay order for the full amount and a
   `payments` doc capturing the current commission split.
3. Razorpay Checkout collects payment → backend verifies the HMAC signature → payment
   marked `paid`. Money sits with the platform's Razorpay account.
4. Admin reviews the delivered promotion in the admin dashboard and clicks
   **Verify & Release** → payment marked `released`, influencer notified.
5. Influencer requests a withdrawal → admin approves/rejects in the dashboard → admin
   manually transfers funds outside the app (bank transfer, UPI, etc.) — this project
   intentionally does not automate payouts, per the spec.

## 9. Security notes

- All Firestore access happens server-side via the Admin SDK; `firestore.rules` denies the
  client SDK entirely, so there's one enforcement point (the API) for every role check.
- All string input is run through `xss()` before being stored.
- `helmet` + `express-rate-limit` are enabled on every `/api` route.
- Razorpay payment signatures are verified server-side with HMAC-SHA256 — the client-supplied
  "success" callback is never trusted on its own.
- Admin role is granted only via the `ADMIN_EMAILS` allowlist at registration time, not
  self-selectable in the signup form.

## 10. Project structure

```
influencer-platform/
├── public/                  # static frontend
│   ├── index.html
│   ├── login.html
│   ├── signup.html
│   ├── css/style.css
│   ├── js/firebase-config.js
│   ├── js/api.js
│   └── pages/
│       ├── influencer-dashboard.html
│       ├── brand-dashboard.html
│       ├── admin-dashboard.html
│       ├── search-influencers.html
│       └── browse-campaigns.html
├── server/
│   ├── server.js
│   ├── routes/{auth,influencers,brands,campaigns,requests,payments,admin}.js
│   ├── middleware/auth.js
│   └── utils/{firebaseAdmin,notify,sanitize}.js
├── firestore.rules
├── storage.rules
├── vercel.json
├── package.json
└── .env.example
```
