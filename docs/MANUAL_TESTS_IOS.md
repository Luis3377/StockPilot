# Manual tests on a real iPhone (Safari and Home Screen app)

The automated tests run in Chromium with an iPhone-sized screen and an iPhone browser identity. That checks layout, wording and logic, but **it is not Safari and not iOS**. These behaviours can only be confirmed on a real device:

- how iOS stores, keeps or removes website data;
- that the Home Screen app keeps its data separate from Safari;
- Safari's zoom-on-tap for small text fields;
- downloading and picking files with the Files app;
- camera capture;
- VoiceOver.

Use a test copy (the Cloudflare preview site, or the live site for non-scanner checks), not real business data. Write down the iPhone model, the iOS version and the date for each run.

---

## A. First run in Safari

1. Open StockPilot in Safari. Choose a mode and tap **Continue**.
   - [ ] The second screen is titled **"Where your inventory is saved"** and says it's only on this device, in this browser.
   - [ ] It lists what could make inventory go missing: deleting website data, switching browser or device, Safari's automatic clean-up after about a week of not opening StockPilot, and deleting the Home Screen icon.
   - [ ] An **"On iPhone or iPad? Add StockPilot to your Home Screen first"** box appears, with the Share → Add to Home Screen steps.
   - [ ] Nothing promises permanent storage, and the box says it isn't a guarantee.
2. Tap **Start with my own inventory**. Add one item with a photo.
   - [ ] A **"Back up your inventory"** reminder appears on Overview and Inventory.

## B. Backup to Files

1. On the reminder, tap **Back up now** (or **Settings → Backup & restore → Download backup**).
   - [ ] Safari offers to download or save the file. Choose **Save to Files** and pick **iCloud Drive** (or On My iPhone).
   - [ ] The reminder disappears. Settings shows **Last backup: … (today) · up to date**.
2. Open the Files app.
   - [ ] The `stockpilot-backup-….json` file is there and isn't empty.

## C. Install as a Home Screen app

1. In Safari: tap **Share**, then **Add to Home Screen**, then **Add**. Open StockPilot from the new icon.
   - [ ] It opens full-screen, without Safari's address bar.
   - [ ] **Expected on current iOS:** the app starts at the welcome screen, empty. The Home Screen app keeps its own data, separate from Safari. If your Safari inventory does appear, write that down; it means this iOS version shares storage.
2. On the welcome screen, tap **Restore a backup**, then **Choose backup file**, and pick the file from Files.
   - [ ] The dialog shows the item, sale and photo counts. Tap **Replace my data**.
   - [ ] The app opens with the same item and photo, and Settings → Last backup shows the backup's date.
3. Go back to Safari.
   - [ ] Safari still has its own copy, unchanged.
4. In the Home Screen app, open **Settings → Your data**.
   - [ ] It says the data is saved "only in this Home Screen app on this device".
   - [ ] Note what **Browser protection** says ("Protected from automatic cleanup" or "Not granted…"). WebKit decides this itself, and Home Screen apps are more likely to be granted it.

## D. Data survives normal use

1. In the Home Screen app, add an item, then fully close the app (swipe it away) and reopen it.
   - [ ] The item and photo are still there.
2. Restart the iPhone and open the app.
   - [ ] The data is still there.
3. *(Optional, slow)* Don't open StockPilot in Safari for 8+ days while using Safari normally.
   - [ ] Record whether Safari's copy is still there (WebKit documents that it may be removed).
   - [ ] Check that the Home Screen app's copy is unaffected.

## E. Deleting data (do this last, with a backup)

1. **Settings → Safari → Clear History and Website Data**, then open Safari StockPilot.
   - [ ] Expected: Safari's copy is gone (back to the welcome screen). Write down whether the Home Screen app's copy was also affected.
2. Delete the Home Screen icon, then add it again.
   - [ ] Expected: the app starts empty.
   - [ ] Restoring the backup brings everything back.

## F. Layout on the phone (the issues found in testing)

1. **AI scanner:** on the preview site, open **Inventory → Scan with AI**, take a photo, tap the invite-code field and type the code.
   - [ ] The page does **not** zoom in when the field is tapped.
   - [ ] There's no sideways scrolling in the scanner panel or the page, before or after typing.
   - [ ] Try the other fields (item name, cost, search) too: no zoom on any of them.
2. Scan an item with a long name (e.g. a Stanley Quencher tumbler).
   - [ ] "Suggested details" shows the full name, wrapped onto several lines.
   - [ ] After saving, the inventory card shows up to three lines. Tapping it opens the item page with the full name.
3. Rotate to landscape and back.
   - [ ] No sideways scrolling.

## G. VoiceOver (accessibility)

Turn on VoiceOver (Settings → Accessibility → VoiceOver), then fully close StockPilot and reopen it, so you begin at the welcome screen.

- [ ] Each mode card is read as "Reseller Mode, radio button, 1 of 3" (or similar), followed by its description.
- [ ] Swiping moves through the cards. Double-tap selects one.
- [ ] **Continue**, **Start with my own inventory**, **Explore with demo data** and **Restore a backup** are all read with their names.
- [ ] On Overview, the ⓘ buttons are read as "What is Inventory cost?" and reveal the definition.
- [ ] Icons aren't read out on their own.

## H. Financial labels (quick check with demo data)

- [ ] Overview shows **Inventory cost**, **Total asking price** and **Projected profit**. Each has a **Today** or **Projected** tag and a working ⓘ.
- [ ] "Slow-moving inventory" amounts are labeled **inventory cost**.
- [ ] Choosing **Last 90 days** on Overview, then opening Smart Insights, shows the same period selected and section tags reading **In the last 90 days**.

---

**Reporting:** for each failed box, note the step, what you saw, the iPhone model and the iOS version. Add a screenshot if possible.
