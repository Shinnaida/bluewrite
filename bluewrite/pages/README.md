# Static pages (SUPERSEDED — design reference only)

> These mockups are **not the app and are no longer maintained**. The running
> frontend is the server-rendered PHP module set in `../modules/` (see its
> README); `officer/home.html` and friends were the design sketch that the Home,
> Reports and Admin modules now implement for real. Kept so the visual intent is
> still reviewable.

Standalone HTML mockups of the BlueWrite UI, split by role. The real app is
the React SPA in `../src/` (served from `../public/`); nothing here is routed
or tested — open the files directly in a browser to preview the design.

```
pages/
  README.md            this file
  shared/
    pages.css          base: variables, header/nav, layout, buttons,
                       tables, forms, footer — used by BOTH roles
  officer/
    home.html          Officer home + action cards
    write-report.html  Officer incident form
    my-reports.html    Officer report list
    officer.css        officer-only: hero, action cards, form, status pills
  admin/
    dashboard.html     Station totals + breakdowns
    users.html         Accounts + pending requests
    audits.html        Audit log
    station.html       Station settings form
    admin.css          admin-only: stat cards, role/state pills, audit
                       markers, settings layout
```

Rules:

- A page loads exactly two stylesheets: `../shared/pages.css` first, then its
  role sheet (`officer.css` / `admin.css`).
- Shared components (header, nav, buttons, tables, footer) go in
  `shared/pages.css`. Role-specific components stay in the role sheet.
- Nav links stay within the role folder. Officer pages link to officer pages;
  admin pages link to admin pages.
- Sample content is placeholder text. Live data comes from the React app.
