# resume-autofill-extension
Chrome extension for creating a profile that can be used to autofill resume questions when applying for jobs.

# Job Application Autofill (Chrome extension)

Save your details once, then fill common job-application questions with one click.

## Install (about 1 minute)
1. Unzip this folder somewhere you'll keep it.
2. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `job-autofill` folder.
4. Pin the extension (puzzle-piece icon → pin) so it's one click away.

## Use
1. Click the extension → **Edit my profile**. Fill in what you want auto-filled and click **Save**. Shortcut: click **First name** or **Street address** and pick one of Chrome's saved address suggestions. That fills your name, email, phone, address, company and job title across every section in one go. Every other text field (links, school, salary, ...) offers the values you've saved there before. Click the field or press ↓ to see them. Then click **Save**. Chrome has no saved data for the yes/no and EEO dropdowns or the long-answer boxes, so pick or type those yourself.
2. Open a job application, click the extension → **Fill this page**.
3. Filled fields are outlined in green. Review them, attach your resume, and submit yourself. The extension never submits anything.

**Custom questions:** in the profile, add pairs like `active security clearance` → `No`. Any field whose label contains those words, or most of them ("Do you currently hold a security clearance?"), gets that answer.

**Ask before filling (auto-detect):** tick **Ask to autofill when an application is detected** in the popup. Chrome will ask for access to the sites you visit, which the extension needs to look for application questions. When a page has at least 3 questions your profile can answer, a small prompt appears in the corner: **Fill**, **Not now**, or **Never on this site**. Nothing is filled until you click Fill. It asks again on the next step of a multi-page form. To undo "Never on this site", open the popup on that site and click **Turn back on**. Untick the box to stop it entirely.

**Overwrite option:** by default, fields that already have text are left alone. Tick the box in the popup to replace them.

**Practice:** open `test-form.html` in Chrome to try it out. To make this work on local files, open the extension's **Details** and turn on **Allow access to file URLs**.

**Backup / move to another computer:** use **Export** / **Import** on the profile page.

## What it handles
- Text boxes, text areas, normal dropdowns, and Yes/No radio buttons
- Styled custom dropdowns (Workday-style buttons, Greenhouse/React-Select, Ashby and other ARIA comboboxes, select2/chosen): it opens the menu, types to search if the answer isn't listed, and clicks the matching option. If nothing matches, it leaves the field empty and closes the menu
- Smart option matching: "USA" picks "United States of America", "CA" picks "California", "Bachelor's" picks "Bachelor's Degree", 5 years picks "4-6 years", and "Decline to self-identify" picks "I don't wish to answer"
- Fuzzy question matching: when no built-in rule fits, a question still matches if it contains most of the words of a known question ("Highest level of education completed" → degree, "racial background" → race). Word endings, British spellings and small typos are tolerated
- Name, contact, address, links, work history, education, work authorization and sponsorship, 18+, relocation, salary, start date, "how did you hear", cover letter, and the voluntary EEO questions (gender, race, veteran, disability)
- Works on most sites. Also has built-in access to forms embedded from Greenhouse, Lever, Workday, Ashby, SmartRecruiters, iCIMS, Jobvite, Workable and BambooHR, so it works when a company embeds one of those forms on its own careers page

## Limits
- Custom dropdowns are filled one at a time (each needs its menu opened), so pages with many of them take a few seconds. A few unusual widgets may still need to be picked by hand.
- It doesn't upload files. Attach your resume yourself.
- Your data is stored only in this browser (`chrome.storage.local`) and is never sent anywhere.

## Adding a new rule
Rules live in `core.js`. `RULES` holds exact patterns, `[profileKey, /regex matched against the field label/]`, with more specific rules first. `PHRASES` holds typical wordings of each question for fuzzy matching. To add a new profile field, also add it to `fields.js`.
